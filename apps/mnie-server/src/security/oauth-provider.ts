import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { ServerConfig } from '../config'
import type { AppBindings } from '../context'
import type { Db } from '../db'
import {
  apiKeys,
  apiKeyVirtualAccounts,
  virtualOrderQuotes,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
} from '../db/schema'
import { createApiKeySync, type ApiKeySettings, verifyApiKey } from './api-keys'
import { randomToken, sha256 } from './crypto'
import { hasUnscopedAdminPermission } from './admin-account-scope'

const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_SCOPES = ['read', 'trade', 'reconcile'] as const

export const createOAuthAuthorizationCode = async (
  db: Db,
  options: {
    clientId: string
    redirectUri: string
    codeChallenge: string
    scopes: string[]
    resource?: string
    apiKeySettings?: ApiKeySettings
  },
) => {
  const now = new Date()
  const code = `oauth_code_${randomToken()}`
  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    codeChallenge: options.codeChallenge,
    scopes: options.scopes,
    resource: options.resource,
    apiKeySettings: (options.apiKeySettings ?? null) as Record<string, unknown> | null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  })
  return code
}

export const createOAuthServerProvider = (db: Db, config: ServerConfig): OAuthServerProvider => ({
  get clientsStore() {
    return {
      getClient: async (clientId: string) => {
        const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId))
        const client = row?.client as OAuthClientInformationFull | undefined
        if (!client || client.scope !== undefined) return client
        // Apply the registration default to clients saved before scopes were recorded.
        const registered = { ...client, scope: DEFAULT_SCOPES.join(' ') }
        await db
          .update(oauthClients)
          .set({ client: registered as unknown as Record<string, unknown> })
          .where(eq(oauthClients.id, clientId))
        return registered
      },
      registerClient: async (
        client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
      ) => {
        const clientInfo = {
          ...client,
          // Registration declares requestable scopes; owner consent grants access.
          scope: client.scope === undefined ? DEFAULT_SCOPES.join(' ') : client.scope,
          client_id: randomToken(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        } satisfies OAuthClientInformationFull
        await db
          .insert(oauthClients)
          .values({
            id: clientInfo.client_id,
            client: clientInfo as unknown as Record<string, unknown>,
            createdAt: new Date(),
          })
          .onConflictDoUpdate({
            target: oauthClients.id,
            set: { client: clientInfo as unknown as Record<string, unknown> },
          })
        return clientInfo
      },
    }
  },

  authorize: async (client, params, c: Context<AppBindings>) => {
    const approvalUrl = new URL('/oauth/authorize', config.origin)
    approvalUrl.searchParams.set('client_id', client.client_id)
    approvalUrl.searchParams.set('redirect_uri', params.redirectUri)
    approvalUrl.searchParams.set('code_challenge', params.codeChallenge)
    if (params.state) approvalUrl.searchParams.set('state', params.state)
    if (params.scopes?.length) approvalUrl.searchParams.set('scope', params.scopes.join(' '))
    if (params.resource) approvalUrl.searchParams.set('resource', params.resource.href)

    const auth = c.get('auth')
    if (!auth?.authenticated || auth.type !== 'session') {
      approvalUrl.searchParams.set('login_required', '1')
      c.res = c.redirect(approvalUrl.toString(), 302)
      return
    }

    c.res = c.redirect(approvalUrl.toString(), 302)
  },

  challengeForAuthorizationCode: async (_client, authorizationCode) => {
    const [row] = await db
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.code, authorizationCode))
    if (!row || row.expiresAt <= new Date()) throw new Error('authorization code expired')
    return row.codeChallenge
  },

  exchangeAuthorizationCode: async (
    client,
    authorizationCode,
    _codeVerifier,
    redirectUri,
    resource,
  ) =>
    db.transaction((tx) => {
      const code = tx
        .select()
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.code, authorizationCode))
        .get()
      if (!code || code.expiresAt <= new Date()) throw new Error('authorization code expired')
      if (code.clientId !== client.client_id) throw new Error('authorization code client mismatch')
      if (redirectUri && code.redirectUri !== redirectUri) throw new Error('redirect_uri mismatch')
      if (resource && code.resource && resource.href !== code.resource)
        throw new Error('OAuth resource mismatch')
      tx.delete(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.code, authorizationCode))
        .run()
      const scopes = code.scopes
      const key = createApiKeySync(db, `OAuth: ${client.client_name ?? client.client_id}`, {
        ...((code.apiKeySettings ?? {}) as ApiKeySettings),
        scopes,
      })
      tx.update(apiKeys)
        .set({ expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000) })
        .where(eq(apiKeys.id, key.id))
        .run()
      const refreshToken = `mnie_refresh_${randomToken()}`
      const now = new Date()
      tx.insert(oauthRefreshTokens)
        .values({
          tokenHash: sha256(refreshToken),
          clientId: client.client_id,
          apiKeyId: key.id,
          scopes,
          resource: resource?.href ?? code.resource,
          createdAt: now,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        })
        .run()
      return {
        access_token: key.token,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: scopes.join(' '),
      } satisfies OAuthTokens
    }),

  exchangeRefreshToken: async (client, refreshToken, scopes, resource) => {
    const [token] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.tokenHash, sha256(refreshToken)),
          eq(oauthRefreshTokens.clientId, client.client_id),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      )
    if (!token || token.expiresAt <= new Date()) throw new Error('refresh token expired')

    const { newAccess, nextScopes } = db.transaction((tx) => {
      const grant = tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, token.tokenHash))
        .get()
      if (!grant || grant.revokedAt || grant.expiresAt <= new Date())
        throw new Error('OAuth grant has been revoked')
      const current = tx.select().from(apiKeys).where(eq(apiKeys.id, grant.apiKeyId)).get()
      if (!current || current.revokedAt) throw new Error('OAuth grant has been revoked')
      if (resource && resource.href !== grant.resource) throw new Error('OAuth resource mismatch')
      const allowedScopes = grant.scopes.filter(
        (scope) => current.scopes === null || current.scopes.includes(scope),
      )
      const nextScopes = scopes ?? allowedScopes
      if (!nextScopes.length || nextScopes.some((scope) => !allowedScopes.includes(scope)))
        throw new Error('refresh scope exceeds the current grant')
      const bindings = tx
        .select()
        .from(apiKeyVirtualAccounts)
        .where(eq(apiKeyVirtualAccounts.apiKeyId, current.id))
        .all()
      if (!bindings.length && !hasUnscopedAdminPermission(current.allowedMethods))
        throw new Error('OAuth grant has no assigned accounts or unscoped admin methods')
      const newAccess = createApiKeySync(db, current.label, {
        scopes: nextScopes,
        allowedMethods: current.allowedMethods,
        maxOrderPriceJpy: current.maxOrderPriceJpy,
        maxOrderAmountJpy: current.maxOrderAmountJpy,
        accountBindings: bindings.map((binding) => ({
          accountId: binding.virtualAccountId,
          role: binding.role,
          allowedMethods: binding.allowedMethods,
        })),
      })
      tx.update(apiKeys)
        .set({ expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000) })
        .where(eq(apiKeys.id, newAccess.id))
        .run()
      tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, current.id)).run()
      tx.update(oauthRefreshTokens)
        .set({ apiKeyId: newAccess.id })
        .where(eq(oauthRefreshTokens.tokenHash, grant.tokenHash))
        .run()
      return { newAccess, nextScopes }
    })
    return {
      access_token: newAccess.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: nextScopes.join(' '),
      refresh_token: refreshToken,
    } satisfies OAuthTokens
  },

  verifyAccessToken: async (token) => {
    const apiKey = await verifyApiKey(db, token)
    if (!apiKey) throw new Error('invalid access token')
    return {
      token,
      clientId: apiKey.id,
      scopes: apiKey.scopes ?? ['read', 'trade'],
      expiresAt: apiKey.expiresAt ? Math.floor(apiKey.expiresAt.getTime() / 1000) : undefined,
    } satisfies AuthInfo
  },

  revokeToken: async (client, request) => {
    db.transaction((tx) => {
      const hash = sha256(request.token)
      const access = tx.select().from(apiKeys).where(eq(apiKeys.tokenHash, hash)).get()
      const grant =
        tx
          .select()
          .from(oauthRefreshTokens)
          .where(
            and(
              eq(oauthRefreshTokens.clientId, client.client_id),
              eq(oauthRefreshTokens.tokenHash, hash),
            ),
          )
          .get() ??
        (access
          ? tx
              .select()
              .from(oauthRefreshTokens)
              .where(
                and(
                  eq(oauthRefreshTokens.clientId, client.client_id),
                  eq(oauthRefreshTokens.apiKeyId, access.id),
                ),
              )
              .get()
          : undefined)
      if (!grant) return
      tx.update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthRefreshTokens.tokenHash, grant.tokenHash))
        .run()
      tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, grant.apiKeyId)).run()
      tx.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.principal, grant.apiKeyId)).run()
    })
  },
})
