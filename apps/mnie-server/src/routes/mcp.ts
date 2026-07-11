import { Hono } from 'hono'
import type { Context } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { eq } from 'drizzle-orm'
import * as z from 'zod/v4'
import type { AppBindings, AuthContext } from '../context'
import { accountProfiles } from '../db/schema'
import { assertApiKeyMethodAllowed } from '../security/trade-limits'
import { connectSbi } from '../rpc/sbi-session'

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const requireMcpAuth = (auth: AuthContext) => {
  if (!auth.authenticated) throw new Error('unauthorized')
  if (auth.type === 'apiKey' && !auth.scopes.includes('mcp')) {
    throw new Error('missing OAuth scope: mcp')
  }
}

const connectProvider = async (c: Context<AppBindings>, profileId: string) => {
  const [profile] = await c
    .get('db')
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, profileId))
    .limit(1)
  if (!profile) throw new Error('profile not found')
  if (profile.provider !== 'sbisec') {
    throw new Error(`MCP provider connection is not implemented for ${profile.provider}`)
  }
  return connectSbi(c.get('db'), c.get('config'), profile.id)
}

const createMcpServer = (c: Context<AppBindings>) => {
  const auth = c.get('auth')
  const server = new McpServer({ name: 'mnie', version: '0.2.0' })

  server.registerTool(
    'mnie-profiles-list',
    {
      title: 'List financial profiles',
      description: 'Lists configured financial-provider profiles and their provider identifiers.',
      inputSchema: {},
    },
    async () => {
      requireMcpAuth(auth)
      const profiles = await c
        .get('db')
        .select({
          id: accountProfiles.id,
          provider: accountProfiles.provider,
          label: accountProfiles.label,
        })
        .from(accountProfiles)
        .orderBy(accountProfiles.createdAt)
      return textResult({ profiles })
    },
  )

  server.registerTool(
    'mnie-provider-invoke',
    {
      title: 'Invoke a financial provider operation',
      description:
        'Calls one operation advertised by a configured provider. Use accounts.list, balances.list, transactions.list, investments.positions.list, or investments.orders.list as supported by the selected provider.',
      inputSchema: {
        profileId: z.string().min(1),
        operation: z.string().min(1),
        input: z.unknown().optional(),
      },
    },
    async ({ profileId, operation, input }) => {
      requireMcpAuth(auth)
      const provider = await connectProvider(c, profileId)
      if (!provider.operations().includes(operation)) {
        throw new Error(`provider does not support operation: ${operation}`)
      }
      if (auth.type === 'apiKey') {
        if (!auth.scopes.includes('read')) throw new Error('missing OAuth scope: read')
        await assertApiKeyMethodAllowed(c.get('db'), auth.apiKeyId, operation)
      }
      return textResult(await provider.invoke(operation, input ?? {}))
    },
  )

  return server
}

export const createMcpRoutes = () => {
  const app = new Hono<AppBindings>()
  app.all('/', async (c) => {
    if (!c.get('authenticated')) {
      const resourceMetadata = new URL('/.well-known/oauth-protected-resource/api/mcp', c.req.url)
      c.header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata.toString()}"`)
      return c.json({ error: 'unauthorized' }, 401)
    }
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createMcpServer(c)
    try {
      await server.connect(transport)
      return await transport.handleRequest(c)
    } finally {
      await server.close()
      await transport.close()
    }
  })
  return app
}
