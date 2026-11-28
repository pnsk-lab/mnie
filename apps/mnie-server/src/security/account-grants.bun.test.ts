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
import {
  createVirtualAccount,
  initializeVirtualAccounts,
  listVirtualAccounts,
} from '../virtual-accounts'
import { createApiKey, normalizeApiKeySettings, verifyApiKey } from './api-keys'
import { createOAuthAuthorizationCode, createOAuthServerProvider } from './oauth-provider'
import { authenticateRequest } from './http-auth'
import { createOAuthRoutes } from '../routes/oauth'
import { assertAccountTrade } from '../account-policy'
import { handleRpc } from '../rpc/handler'
import type { AdminRpcService } from '../rpc/admin'
import { physicalAccountAssets } from '../db/schema'
import { assertAdminAccountScope } from './admin-account-scope'
import { ProfileRpcService } from '../profile-service'

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
  })
  await db.insert(oauthClients).values({ id: client.client_id, client, createdAt: now })
  const provider = createOAuthServerProvider(db, config)
  return { db, account, provider }
}

describe('account grants', () => {
  test('one key can grant different methods to multiple accounts', async () => {
    const { db, account } = await setup()
    const other = await createVirtualAccount(db, {
      physicalAccountId: 'physical',
      label: 'Other',
    })
    const key = await createApiKey(db, 'scoped', {
      scopes: ['read', 'trade'],
      accountBindings: [
        {
          accountId: account.id,
          role: 'trade',
          allowedMethods: ['account.investments.orders.preview'],
        },
        {
          accountId: other.id,
          role: 'trade',
          allowedMethods: ['account.investments.orders.create'],
        },
      ],
    })
    const bindings = await db
      .select()
      .from(apiKeyVirtualAccounts)
      .where(eq(apiKeyVirtualAccounts.apiKeyId, key.id))
    expect(bindings).toHaveLength(2)
    expect(bindings.find((b) => b.virtualAccountId === account.id)?.allowedMethods).toEqual([
      'account.investments.orders.preview',
    ])
    expect(bindings.find((b) => b.virtualAccountId === other.id)?.allowedMethods).toEqual([
      'account.investments.orders.create',
    ])
    await db.insert(physicalAccountAssets).values({
      physicalAccountId: 'physical',
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      amount: '1000',
      version: 1,
      updatedAt: new Date(),
    })
    const access = { owner: false, apiKeyId: key.id }
    expect(() =>
      assertAccountTrade(db, account.id, access, {}, 'investments.orders.preview'),
    ).not.toThrow()
    expect(() =>
      assertAccountTrade(db, account.id, access, {}, 'investments.orders.create'),
    ).toThrow('not allowed')
    expect(() =>
      assertAccountTrade(db, other.id, access, {}, 'investments.orders.create'),
    ).not.toThrow()
    expect(() =>
      assertAccountTrade(db, other.id, access, {}, 'investments.orders.preview'),
    ).toThrow('not allowed')
  })
  test('portfolio methods respect each account grant, including aggregate requests', async () => {
    const { db, account } = await setup()
    const other = await createVirtualAccount(db, {
      physicalAccountId: 'physical',
      label: 'Other',
    })
    const key = await createApiKey(db, 'portfolio', {
      scopes: ['read'],
      accountBindings: [
        {
          accountId: account.id,
          role: 'read',
          allowedMethods: ['portfolio.accounts.balances', 'portfolio.overview.get'],
        },
        { accountId: other.id, role: 'read', allowedMethods: [] },
      ],
    })
    const access = { owner: false, apiKeyId: key.id }
    const providers = {} as ProviderRegistry
    expect(
      await invokePortfolio(
        db,
        providers,
        'portfolio.accounts.balances',
        { account: account.id },
        access,
      ),
    ).toEqual({ assets: [] })
    await expect(
      invokePortfolio(db, providers, 'portfolio.accounts.balances', { account: other.id }, access),
    ).rejects.toThrow('not allowed')
    await expect(
      invokePortfolio(db, providers, 'portfolio.overview.get', {}, access),
    ).rejects.toThrow('not allowed')
  })
  test('admin RPC requires an explicit grant and never treats legacy null as admin', async () => {
    const { db } = await setup()
    const legacy = await createApiKey(db, 'legacy', { scopes: ['read'], allowedMethods: null })
    const granted = await createApiKey(db, 'admin read', {
      scopes: ['read'],
      allowedMethods: ['admin.providers.list'],
    })
    const admin = {
      invoke: async (operation: string) => ({ operation }),
    } as unknown as AdminRpcService
    const providers = {} as ProviderRegistry
    const request = { id: 1, method: 'admin.providers.list', params: {} }
    await expect(
      handleRpc(db, providers, admin, { owner: false, apiKeyId: legacy.id }, request),
    ).rejects.toThrow('owner session is required')
    expect(
      await handleRpc(db, providers, admin, { owner: false, apiKeyId: granted.id }, request),
    ).toMatchObject({ result: { operation: 'providers.list' } })
    await expect(
      handleRpc(
        db,
        providers,
        admin,
        { owner: false, apiKeyId: granted.id },
        { ...request, method: 'admin.apiKeys.create' },
      ),
    ).rejects.toThrow('owner session is required')
  })
  test('global ledger methods require an explicit grant even when other methods are unrestricted', async () => {
    const { db } = await setup()
    const legacy = await createApiKey(db, 'legacy ledger', { scopes: ['read'] })
    const granted = await createApiKey(db, 'ledger read', {
      scopes: ['read'],
      allowedMethods: ['portfolio.ledger.observations.list'],
    })
    await expect(
      invokePortfolio(
        db,
        {} as ProviderRegistry,
        'portfolio.ledger.observations.list',
        {},
        { owner: false, apiKeyId: legacy.id },
      ),
    ).rejects.toThrow('owner session is required')
    expect(
      await invokePortfolio(
        db,
        {} as ProviderRegistry,
        'portfolio.ledger.observations.list',
        {},
        { owner: false, apiKeyId: granted.id },
      ),
    ).toBeDefined()
    await expect(
      invokePortfolio(
        db,
        {} as ProviderRegistry,
        'portfolio.ledger.events.list',
        {},
        { owner: false, apiKeyId: granted.id },
      ),
    ).rejects.toThrow('owner session is required')
  })
  test('profile discovery is controllable and the editor can request key-eligible methods', async () => {
    const { db, account } = await setup()
    const registry = {
      open: async () => ({
        profile: { id: 'connection' },
        provider: { methods: () => ['market.issue.chart', 'private.history'] },
        persist: async () => {},
        release: async () => {},
      }),
    } as unknown as ProviderRegistry
    const service = new ProfileRpcService(db, registry)
    const ownerMethods = (await service.dispatch(
      'profile.operations',
      { profile: 'connection', forApiKey: true },
      { owner: true },
    )) as string[]
    expect(ownerMethods).toContain('profile.market.issue.chart')
    expect(ownerMethods).not.toContain('profile.private.history')
    const allowed = await createApiKey(db, 'profile discovery', {
      scopes: ['read'],
      allowedMethods: ['profile.operations', 'profile.market.issue.chart'],
      accountBindings: [{ accountId: account.id, role: 'read', allowedMethods: [] }],
    })
    expect(
      await service.dispatch(
        'profile.operations',
        { profile: 'connection' },
        { owner: false, apiKeyId: allowed.id, scopes: ['read'] },
      ),
    ).toEqual(['profile.market.issue.chart'])
    const denied = await createApiKey(db, 'no profile discovery', {
      scopes: ['read'],
      allowedMethods: [],
      accountBindings: [{ accountId: account.id, role: 'read', allowedMethods: [] }],
    })
    await expect(
      service.dispatch(
        'profile.operations',
        { profile: 'connection' },
        { owner: false, apiKeyId: denied.id, scopes: ['read'] },
      ),
    ).rejects.toThrow('profile method not found')
    await service.close()
  })
  test('account administration requires a grant on every affected account', async () => {
    const { db, account } = await setup()
    const other = await createVirtualAccount(db, {
      physicalAccountId: 'physical',
      label: 'Other',
    })
    const key = await createApiKey(db, 'admin', {
      scopes: ['read'],
      accountBindings: [
        {
          accountId: account.id,
          role: 'read',
          allowedMethods: [
            'admin.accounts.freeze',
            'admin.accounts.reconciliation.approve',
            'admin.accounts.assets.transfer',
          ],
        },
        { accountId: other.id, role: 'read', allowedMethods: [] },
      ],
    })
    expect(() =>
      assertAdminAccountScope(db, key.id, 'admin.accounts.freeze', { accountId: account.id }),
    ).not.toThrow()
    expect(() =>
      assertAdminAccountScope(db, key.id, 'admin.accounts.freeze', { accountId: other.id }),
    ).toThrow('lacks this admin permission')
    expect(() =>
      assertAdminAccountScope(db, key.id, 'admin.accounts.reconciliation.approve', {
        physicalAccountId: 'physical',
      }),
    ).toThrow('lacks this admin permission')
    const { unallocated } = await initializeVirtualAccounts(db, 'physical')
    expect(() =>
      assertAdminAccountScope(db, key.id, 'admin.accounts.assets.transfer', {
        fromAccountId: unallocated.id,
        toAccountId: account.id,
      }),
    ).toThrow('lacks this admin permission')
    const transfer = 'admin.accounts.assets.transfer'
    const transferKey = await createApiKey(db, 'unallocated transfers', {
      scopes: ['read'],
      allowedMethods: [transfer],
      accountBindings: [
        { accountId: unallocated.id, role: 'read', allowedMethods: [transfer] },
        { accountId: account.id, role: 'read', allowedMethods: [transfer] },
      ],
    })
    expect(() =>
      assertAdminAccountScope(db, transferKey.id, transfer, {
        fromAccountId: unallocated.id,
        toAccountId: account.id,
      }),
    ).not.toThrow()
    expect(() => assertAdminAccountScope(db, key.id, 'admin.accounts.freeze', {})).toThrow(
      'could not be verified',
    )
    const scoped = await createApiKey(db, 'scoped admin', {
      scopes: ['read'],
      allowedMethods: ['admin.accounts.freeze'],
      accountBindings: [
        { accountId: account.id, role: 'read', allowedMethods: ['admin.accounts.freeze'] },
        { accountId: other.id, role: 'read', allowedMethods: [] },
      ],
    })
    const admin = {
      invoke: async (operation: string) => ({ operation }),
    } as unknown as AdminRpcService
    const state = { owner: false, apiKeyId: scoped.id }
    const request = { id: 1, method: 'admin.accounts.freeze', params: { accountId: account.id } }
    expect(await handleRpc(db, {} as ProviderRegistry, admin, state, request)).toMatchObject({
      result: { operation: 'accounts.freeze' },
    })
    await expect(
      handleRpc(db, {} as ProviderRegistry, admin, state, {
        ...request,
        params: { accountId: other.id },
      }),
    ).rejects.toThrow('lacks this admin permission')
  })
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
  test('refresh preserves account bindings, price limits and per-account method restrictions', async () => {
    const { db, account, provider } = await setup()
    const code = await createOAuthAuthorizationCode(db, {
      clientId: client.client_id,
      redirectUri: client.redirect_uris[0]!,
      codeChallenge: 'challenge',
      scopes: ['read', 'trade'],
      apiKeySettings: {
        accountBindings: [
          { accountId: account.id, role: 'trade', allowedMethods: ['account.balances.list'] },
        ],
        allowedMethods: ['account.balances.list'],
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
    ).toMatchObject({
      virtualAccountId: account.id,
      role: 'trade',
      allowedMethods: ['account.balances.list'],
    })
    expect(
      db.select().from(apiKeyTradeUsage).where(eq(apiKeyTradeUsage.apiKeyId, next.id)).get(),
    ).toBeUndefined()
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
