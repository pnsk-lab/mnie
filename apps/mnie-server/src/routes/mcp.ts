import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import type { AppBindings } from '../context'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import type { AdminRpcService } from '../rpc/admin'
import { closeOpenProvider, handleRpc, RPC_METHODS, type RpcSocketState } from '../rpc/handler'

export const createMcpRoutes = (db: Db, providers: ProviderRegistry, admin: AdminRpcService) => {
  const app = new Hono<AppBindings>()
  app.all('/', async (c) => {
    const config = c.get('config')
    const origin = c.req.header('Origin')
    if (origin && origin !== config.origin && origin !== config.corsOrigin) {
      return c.json({ error: 'invalid origin' }, 403)
    }
    const auth = c.get('auth')
    if (!auth.authenticated) {
      const metadata = new URL(`/.well-known/oauth-protected-resource${c.req.path}`, config.origin)
      c.header('WWW-Authenticate', `Bearer resource_metadata="${metadata.href}"`)
      return c.json({ error: 'unauthorized' }, 401)
    }
    const state: RpcSocketState = {
      owner: auth.type === 'session',
      apiKeyId: auth.type === 'apiKey' ? auth.apiKeyId : undefined,
      scopes: auth.type === 'apiKey' ? auth.scopes : undefined,
    }
    const server = new McpServer({ name: 'mnie', version: '0.3.0' })
    const methods: readonly string[] = RPC_METHODS
    for (const method of methods) {
      if (method.startsWith('admin.') && !state.owner) continue
      const inputSchema: Record<string, z.ZodType> = {}
      if (method.startsWith('account.')) inputSchema.accountId = z.string().min(1)
      if (method.startsWith('profile.')) inputSchema.profileId = z.string().min(1)
      if (method.endsWith('.invoke')) {
        inputSchema.operation = z.string().min(1)
        inputSchema.input = z.record(z.string(), z.unknown()).optional()
      }
      if (method.endsWith('.availability')) {
        inputSchema.operation = z.string().optional()
        inputSchema.input = z.record(z.string(), z.unknown()).optional()
      }
      if (method.endsWith('.connection.complete')) inputSchema.interactionId = z.string().min(1)
      server.registerTool(
        `mnie-${method.replaceAll('.', '-')}`,
        {
          description:
            `Calls Mnie ${method} with the same permissions as WebSocket RPC. ` +
            'Discover supported workspace operations with mnie-workspace-operations, and provider operations with the corresponding operations tool.',
          inputSchema,
        },
        async (params) => {
          const callState: RpcSocketState = { ...state }
          try {
            const result = await handleRpc(db, providers, admin, callState, {
              id: 1,
              method,
              params,
            })
            if ('error' in result) throw new Error(result.error.message)
            return { content: [{ type: 'text', text: JSON.stringify(result.result ?? null) }] }
          } catch (cause) {
            return {
              isError: true,
              content: [
                { type: 'text', text: cause instanceof Error ? cause.message : String(cause) },
              ],
            }
          } finally {
            await closeOpenProvider(callState)
          }
        },
      )
    }
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
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
