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
import { apiKeys, oauthAuthorizationCodes, oauthClients, oauthRefreshTokens } from '../db/schema'
import { createApiKey, type ApiKeySettings, verifyApiKey } from './api-keys'
import { randomToken, sha256 } from './crypto'

const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

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
  const code = `mcp_code_${randomToken()}`
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
        return row?.client as OAuthClientInformationFull | undefined
      },
      registerClient: async (
        client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
      ) => {
        const clientInfo = client as OAuthClientInformationFull
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
  ) => {
    const [code] = await db
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.code, authorizationCode))
    if (!code || code.expiresAt <= new Date()) throw new Error('authorization code expired')
    if (code.clientId !== client.client_id) throw new Error('authorization code client mismatch')
    if (redirectUri && code.redirectUri !== redirectUri) throw new Error('redirect_uri mismatch')
    await db
      .delete(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.code, authorizationCode))

    const key = await createApiKey(
      db,
      `OAuth: ${client.client_name ?? client.client_id}`,
      (code.apiKeySettings ?? {}) as ApiKeySettings,
    )
    const refreshToken = `csbie_refresh_${randomToken()}`
    const now = new Date()
    const scopes = code.scopes
    await db.insert(oauthRefreshTokens).values({
      tokenHash: sha256(refreshToken),
      clientId: client.client_id,
      apiKeyId: key.id,
      scopes,
      resource: resource?.href ?? code.resource,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    })

    return {
      access_token: key.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    } satisfies OAuthTokens
  },

  exchangeRefreshToken: async (client, refreshToken, scopes, _resource) => {
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

    const newAccess = await createApiKey(db, `OAuth: ${client.client_name ?? client.client_id}`)
    return {
      access_token: newAccess.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: (scopes ?? token.scopes).join(' '),
      refresh_token: refreshToken,
    } satisfies OAuthTokens
  },

  verifyAccessToken: async (token) => {
    const apiKey = await verifyApiKey(db, token)
    if (!apiKey) throw new Error('invalid access token')
    return {
      token,
      clientId: apiKey.id,
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
    } satisfies AuthInfo
  },

  revokeToken: async (_client, request) => {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.tokenHash, sha256(request.token)))
    await db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthRefreshTokens.tokenHash, sha256(request.token)))
  },
})
