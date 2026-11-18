import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  discoverOAuthMetadata,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { oauthClients, sessions } from '../db/schema'

describe('OAuth client registration scopes', () => {
  const db = createDb(':memory:')
  let runtime: ReturnType<typeof createServerApp>
  let server: ReturnType<typeof Bun.serve>
  let baseURL: string
  const sessionId = crypto.randomUUID()
  const clientMetadata = {
    client_name: 'MCP OAuth integration',
    redirect_uris: ['http://localhost/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none' as const,
  }

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
    })
    baseURL = server.url.origin
    const config: ServerConfig = {
      port: server.port!,
      databasePath: ':memory:',
      origin: baseURL,
      corsOrigin: baseURL,
      sessionCookieName: 'mnie_session',
      rpName: 'Mnie test',
      rpId: 'localhost',
    }
    runtime = createServerApp(db, config, { backgroundJobs: false })
    await db.insert(sessions).values({
      id: sessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
  })

  afterAll(async () => {
    server.stop(true)
    await runtime.close()
    db.$client.close()
  })

  const authorize = async (client: OAuthClientInformationFull, scope: string) => {
    const metadata = await discoverOAuthMetadata(baseURL)
    const authorization = await startAuthorization(baseURL, {
      metadata,
      clientInformation: client,
      redirectUrl: clientMetadata.redirect_uris[0]!,
      scope,
      resource: new URL('/api/mcp', baseURL),
    })
    const response = await fetch(authorization.authorizationUrl, { redirect: 'manual' })
    return { ...authorization, response, metadata }
  }

  test('omitted registration scope supports OAuth read consent, PKCE exchange, and MCP calls', async () => {
    const metadata = await discoverOAuthMetadata(baseURL)
    const client = await registerClient(baseURL, { metadata, clientMetadata })
    expect(client.scope).toBe('read trade reconcile')
    const authorization = await authorize(client, 'read')
    expect(authorization.response.status).toBe(302)
    const consent = new URL(authorization.response.headers.get('location')!)
    expect(consent.pathname).toBe('/oauth/authorize')
    expect(consent.searchParams.get('scope')).toBe('read')
    const approved = await fetch(new URL('/api/oauth/approve', baseURL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `mnie_session=${sessionId}` },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: clientMetadata.redirect_uris[0],
        codeChallenge: consent.searchParams.get('code_challenge'),
        scope: 'read',
        resource: new URL('/api/mcp', baseURL).href,
      }),
    })
    expect(approved.status).toBe(200)
    const { redirectTo } = (await approved.json()) as { redirectTo: string }
    const tokens = await exchangeAuthorization(baseURL, {
      metadata,
      clientInformation: client,
      authorizationCode: new URL(redirectTo).searchParams.get('code')!,
      codeVerifier: authorization.codeVerifier,
      redirectUri: clientMetadata.redirect_uris[0]!,
      resource: new URL('/api/mcp', baseURL),
    })
    expect(tokens.scope).toBe('read')
    const mcp = new Client({ name: 'oauth-test', version: '1.0.0' })
    try {
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), {
          requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        }),
      )
      const result = await mcp.callTool({ name: 'mnie-workspace-operations', arguments: {} })
      expect(result.isError).not.toBe(true)
    } finally {
      await mcp.close()
    }
  })

  test('repairs existing registrations with omitted scopes without re-registration', async () => {
    const client = { ...clientMetadata, client_id: crypto.randomUUID() }
    await db.insert(oauthClients).values({
      id: client.client_id,
      client,
      createdAt: new Date(),
    })
    const { response } = await authorize(client, 'read')
    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location')!).pathname).toBe('/oauth/authorize')
    const [stored] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, client.client_id))
    expect((stored!.client as { scope?: string }).scope).toBe('read trade reconcile')
  })

  test('preserves explicit registration scope restrictions, including empty scopes', async () => {
    const metadata = await discoverOAuthMetadata(baseURL)
    for (const scope of ['read', '']) {
      const client = await registerClient(baseURL, {
        metadata,
        clientMetadata: { ...clientMetadata, scope },
      })
      expect(client.scope).toBe(scope)
      const requested = scope === 'read' ? 'trade' : 'read'
      const { response } = await authorize(client, requested)
      expect(response.status).toBe(302)
      const redirect = new URL(response.headers.get('location')!)
      expect(redirect.searchParams.get('error')).toBe('invalid_scope')
      expect(redirect.searchParams.get('error_description')).toBe(
        `Client was not registered with scope ${requested}`,
      )
    }
  })
})
