import { invokePortfolio } from '../rpc/portfolio'
import type { ProviderRegistry } from '../providers/registry'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { AppBindings } from '../context'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import {
  accountProfiles,
  financialAccounts,
  apiKeys,
  apiKeyTradeUsage,
  apiKeyVirtualAccounts,
  oauthClients,
  oauthAuthorizationCodes,
} from '../db/schema'
import { createVirtualAccount, listVirtualAccounts } from '../virtual-accounts'
import { createApiKey, normalizeApiKeySettings, verifyApiKey } from './api-keys'
import { createOAuthAuthorizationCode, createOAuthServerProvider } from './oauth-provider'
import { authenticateRequest } from './http-auth'
import { createOAuthRoutes } from '../routes/oauth'

const config: ServerConfig = {
  port: 0,
  databasePath: ':memory:',
  origin: 'http://localhost',
  corsOrigin: 'http://localhost',
  sessionCookieName: 'mnie_session',
  rpId: 'localhost',
  rpName: 'test',
}
const client = {
  client_id: 'client',
  client_name: 'test client',
  redirect_uris: ['http://localhost/callback'],
}
const setup = async () => {
  const db = createDb(':memory:')
  const now = new Date()
  await db.insert(accountProfiles).values({
    id: 'connection',
    provider: 'test',
    label: 'test',
    keyringAccount: 'unused',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(financialAccounts).values({
    id: 'physical',
    profileId: 'connection',
    providerAccountId: 'private',
    connectorTypeId: 'test',
    institutionId: 'test',
    kind: 'brokerage',
    createdAt: now,
    updatedAt: now,
  })
  const account = await createVirtualAccount(db, {
    physicalAccountId: 'physical',
    label: 'Agent',
    kind: 'agent',
  })
  await db.insert(oauthClients).values({ id: client.client_id, client, createdAt: now })
  const provider = createOAuthServerProvider(db, config)
  return { db, account, provider }
}

describe('account grants', () => {
  test('empty scopes and allowed methods remain an explicit denial', async () => {
    expect(normalizeApiKeySettings({ scopes: [], allowedMethods: [] })).toMatchObject({
      scopes: [],
      allowedMethods: [],
    })
    const { db } = await setup()
    const key = await createApiKey(db, 'no scopes', { scopes: [], allowedMethods: [] })
    const auth = await authenticateRequest(
      db,
      config,
      new Request(config.origin, { headers: { Authorization: `Bearer ${key.token}` } }),
    )
    expect(auth).toMatchObject({ scopes: [] })
    expect(await listVirtualAccounts(db, { owner: false, apiKeyId: key.id })).toEqual([])
  })
  test('an expired OAuth access key cannot authenticate or discover accounts', async () => {
    const { db, account } = await setup()
    const key = await createApiKey(db, 'expired', {
      scopes: ['read'],
      accountBindings: [{ accountId: account.id, role: 'read' }],
    })
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(apiKeys.id, key.id))
    expect(await verifyApiKey(db, key.token)).toBeUndefined()
    expect(await listVirtualAccounts(db, { owner: false, apiKeyId: key.id })).toEqual([])
  })
  test('refresh preserves account bindings, limits, method restrictions, and consumed quotas', async () => {
    const { db, account, provider } = await setup()
    const code = await createOAuthAuthorizationCode(db, {
      clientId: client.client_id,
      redirectUri: client.redirect_uris[0]!,
      codeChallenge: 'challenge',
      scopes: ['read', 'trade'],
      apiKeySettings: {
        accountBindings: [{ accountId: account.id, role: 'trade' }],
        allowedMethods: ['account.balances.list'],
        maxTradesPerHour: 2,
        maxOrderAmountJpy: 1000,
      },
    })
    const initial = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      client.redirect_uris[0],
    )
    const oldKey = (await verifyApiKey(db, initial.access_token))!
    await db.insert(apiKeyTradeUsage).values({
      apiKeyId: oldKey.id,
      window: '1h',
      hourBucket: 'test-bucket',
      tradeCount: 1,
      updatedAt: new Date(),
    })
    const refreshed = await provider.exchangeRefreshToken(client, initial.refresh_token!)
    const next = (await verifyApiKey(db, refreshed.access_token))!
    expect(next).toMatchObject({
      maxTradesPerHour: 2,
      maxOrderAmountJpy: 1000,
      allowedMethods: ['account.balances.list'],
      scopes: ['read', 'trade'],
    })
    expect(next.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    expect(await verifyApiKey(db, initial.access_token)).toBeUndefined()
    expect(
      db
        .select()
        .from(apiKeyVirtualAccounts)
        .where(eq(apiKeyVirtualAccounts.apiKeyId, next.id))
        .get(),
    ).toMatchObject({ virtualAccountId: account.id, role: 'trade' })
    expect(
      db.select().from(apiKeyTradeUsage).where(eq(apiKeyTradeUsage.apiKeyId, next.id)).get()
        ?.tradeCount,
    ).toBe(1)
    await expect(
      provider.exchangeAuthorizationCode(client, code, undefined, client.redirect_uris[0]),
    ).rejects.toThrow('authorization code expired')
    await expect(
      provider.exchangeRefreshToken(client, initial.refresh_token!, ['reconcile']),
    ).rejects.toThrow('refresh scope exceeds')
    await db.delete(apiKeyVirtualAccounts).where(eq(apiKeyVirtualAccounts.apiKeyId, next.id))
    await expect(provider.exchangeRefreshToken(client, initial.refresh_token!)).rejects.toThrow(
      'no assigned accounts',
    )
    await provider.revokeToken!(client, {
      token: initial.refresh_token!,
      token_type_hint: 'refresh_token',
    })
    expect(await verifyApiKey(db, refreshed.access_token)).toBeUndefined()
    await expect(provider.exchangeRefreshToken(client, initial.refresh_token!)).rejects.toThrow(
      'refresh token expired',
    )
  })
  test('owner consent grants only selected scopes and requires an account binding', async () => {
    const { db, account } = await setup()
    const app = new Hono<AppBindings>()
    app.use('*', async (c, next) => {
      c.set('db', db)
      c.set('config', config)
      c.set('auth', { type: 'session', authenticated: true, sessionId: 'owner' })
      await next()
    })
    app.route('/oauth', createOAuthRoutes())
    const request = {
      clientId: client.client_id,
      redirectUri: client.redirect_uris[0],
      codeChallenge: 'test',
      scope: 'read trade',
      settings: { scopes: ['read'], accountBindings: [{ accountId: account.id, role: 'read' }] },
    }
    const response = await app.request('/oauth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    expect(response.status).toBe(200)
    expect(db.select().from(oauthAuthorizationCodes).get()?.scopes).toEqual(['read'])
    const unbound = await app.request('/oauth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, settings: { scopes: ['read'], accountBindings: [] } }),
    })
    expect(unbound.status).toBe(400)
    const empty = await app.request('/oauth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, settings: { ...request.settings, scopes: [] } }),
    })
    expect(empty.status).toBe(400)
  })
  test('portfolio aliases cannot bypass an API key method allowlist', async () => {
    const { db, account } = await setup()
    const key = await createApiKey(db, 'restricted reader', {
      scopes: ['read'],
      allowedMethods: [],
      accountBindings: [{ accountId: account.id, role: 'read' }],
    })
    await expect(
      invokePortfolio(
        db,
        {} as ProviderRegistry,
        'portfolio.accounts.balances',
        { account: account.id },
        { owner: false, apiKeyId: key.id },
      ),
    ).rejects.toThrow('not allowed to call portfolio.accounts.balances')
    await expect(
      invokePortfolio(
        db,
        {} as ProviderRegistry,
        'portfolio.overview.get',
        {},
        { owner: false, apiKeyId: key.id },
      ),
    ).rejects.toThrow('not allowed to call portfolio.overview.get')
  })
})
