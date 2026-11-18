import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { sessions } from '../db/schema'
import { createApiKey } from '../security/api-keys'

describe('Streamable HTTP MCP', () => {
  const db = createDb(':memory:')
  const config: ServerConfig = {
    port: 0,
    databasePath: ':memory:',
    origin: 'http://localhost',
    corsOrigin: 'http://localhost',
    sessionCookieName: 'mnie_session',
    rpName: 'Mnie test',
    rpId: 'localhost',
  }
  const runtime = createServerApp(db, config, { backgroundJobs: false })
  let server: ReturnType<typeof Bun.serve>
  let baseURL: string
  let token: string

  const connect = async (path = '/api/mcp', authorization = `Bearer ${token}`) => {
    const client = new Client({ name: 'mnie-integration', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(path, baseURL), {
        requestInit: { headers: { Authorization: authorization } },
      }),
    )
    return client
  }

  beforeAll(async () => {
    ;({ token } = await createApiKey(db, 'MCP integration', { scopes: ['read'] }))
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
      websocket: runtime.websocket,
    })
    baseURL = `http://localhost:${server.port}`
  })

  afterAll(async () => {
    server.stop(true)
    await runtime.close()
    db.$client.close()
  })

  test('requires authentication and advertises matching OAuth resource metadata', async () => {
    for (const path of ['/api/mcp', '/mcp']) {
      const response = await fetch(new URL(path, baseURL))
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain(
        new URL(`/.well-known/oauth-protected-resource${path}`, config.origin).href,
      )
      const metadata = await fetch(new URL(`/.well-known/oauth-protected-resource${path}`, baseURL))
      expect(await metadata.json()).toMatchObject({
        resource: new URL(path, config.origin).href,
        scopes_supported: ['read', 'trade', 'reconcile'],
      })
    }
    const invalid = await fetch(new URL('/api/mcp', baseURL), {
      headers: { Authorization: 'Bearer invalid' },
    })
    expect(invalid.status).toBe(401)
  })

  test('MCP SDK initializes, discovers tools, and invokes the shared workspace on both paths', async () => {
    for (const path of ['/api/mcp', '/mcp']) {
      const client = await connect(path)
      try {
        const { tools } = await client.listTools()
        expect(tools.map((tool) => tool.name)).toContain('mnie-profile-invoke')
        expect(tools.some((tool) => tool.name.startsWith('mnie-admin-'))).toBe(false)
        const result = await client.callTool({
          name: 'mnie-workspace-invoke',
          arguments: { operation: 'profiles.list', input: {} },
        })
        expect(result.isError).not.toBe(true)
        expect(result.content).toEqual([{ type: 'text', text: '[]' }])
        const unavailable = await client.callTool({
          name: 'mnie-profile-invoke',
          arguments: { profileId: 'unbound', operation: 'balances.list' },
        })
        expect(unavailable.isError).toBe(true)
        const invalid = await client.callTool({
          name: 'mnie-workspace-invoke',
          arguments: { operation: 'nonexistent' },
        })
        expect(invalid.isError).toBe(true)
      } finally {
        await client.close()
      }
    }
  })

  test('preserves read, reconcile, and owner restrictions', async () => {
    const { token: limitedToken } = await createApiKey(db, 'no read', { scopes: ['trade'] })
    const limited = await connect('/api/mcp', `Bearer ${limitedToken}`)
    const reader = await connect()
    try {
      const denied = await limited.callTool({ name: 'mnie-workspace-operations', arguments: {} })
      expect(denied.isError).toBe(true)
      expect(denied.content).toEqual([{ type: 'text', text: 'missing OAuth scope: read' }])
      const reconcile = await reader.callTool({
        name: 'mnie-workspace-invoke',
        arguments: { operation: 'reconciliation.confirm', input: { proposalId: 'test' } },
      })
      expect(reconcile.isError).toBe(true)
      expect(reconcile.content).toEqual([{ type: 'text', text: 'missing OAuth scope: reconcile' }])
      const admin = await reader.callTool({ name: 'mnie-admin-invoke', arguments: {} })
      expect(admin.isError).toBe(true)
    } finally {
      await limited.close()
      await reader.close()
    }
  })

  test('allows owner sessions and rejects cross-origin requests', async () => {
    const sessionId = crypto.randomUUID()
    await db.insert(sessions).values({
      id: sessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    const client = new Client({ name: 'owner', version: '1.0.0' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), {
          requestInit: { headers: { Cookie: `${config.sessionCookieName}=${sessionId}` } },
        }),
      )
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
        'mnie-admin-invoke',
      )
      const result = await client.callTool({ name: 'mnie-admin-operations', arguments: {} })
      expect(result.isError).not.toBe(true)
    } finally {
      await client.close()
    }
    const response = await fetch(new URL('/api/mcp', baseURL), {
      headers: { Origin: 'https://untrusted.invalid', Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(403)
  })
})
