import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import type { AppBindings } from '../context'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import type { AdminRpcService } from '../rpc/admin'
import { callerMethods, handleRpc } from '../rpc/handler'
import { createRpcPrincipalStore } from '../rpc/principals'

export const createMcpRoutes = (db: Db, providers: ProviderRegistry, admin: AdminRpcService) => {
  const app = new Hono<AppBindings>()
  const store = createRpcPrincipalStore()
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
    const active = store.entry(auth)
    const server = new McpServer({ name: 'mnie', version: '0.3.0' })
    for (const method of callerMethods(active.state)) {
      server.registerTool(
        `mnie-${method.replaceAll('.', '-')}`,
        {
          description:
            `Calls Mnie ${method} with the same permissions as WebSocket RPC. ` +
            'Put the method parameters in "params". ' +
            'Discover accounts with portfolio.accounts.list, then discover account operations with account.operations and profile operations with profile.operations. ' +
            'history methods return only activity and statement rows visible to the selected accounts.',
          inputSchema: { params: z.record(z.string(), z.unknown()).optional() },
        },
        (args) =>
          store.runQueued(active, async () => {
            try {
              const result = await handleRpc(db, providers, admin, active.state, {
                id: 1,
                method,
                params: (args.params ?? {}) as Record<string, unknown>,
              })
              if ('error' in result) throw new Error(result.error.message)
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(result.result ?? null) }],
              }
            } catch (cause) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: cause instanceof Error ? cause.message : String(cause),
                  },
                ],
              }
            }
          }),
      )
    }
    server.registerTool(
      'mnie-account-invoke',
      {
        description:
          'Calls a dynamic account.* provider method with the same permissions as WebSocket RPC. method is a wire name like account.investments.orders.preview; put the method parameters (including account) in "params".',
        inputSchema: {
          account: z.string().min(1),
          method: z.string().min(1),
          params: z.record(z.string(), z.unknown()).optional(),
        },
      },
      (args) =>
        store.runQueued(active, async () => {
          try {
            const result = await handleRpc(db, providers, admin, active.state, {
              id: 1,
              method: args.method,
              params: { account: args.account, ...args.params },
            })
            if ('error' in result) throw new Error(result.error.message)
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result.result ?? null) }],
            }
          } catch (cause) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: cause instanceof Error ? cause.message : String(cause),
                },
              ],
            }
          }
        }),
    )
    server.registerTool(
      'mnie-profile-invoke',
      {
        description:
          'Calls a dynamic profile.* provider method with the same permissions as WebSocket RPC. method is a wire name like profile.balances.list; put the method parameters (including profile) in "params".',
        inputSchema: {
          profile: z.string().min(1),
          method: z.string().min(1),
          params: z.record(z.string(), z.unknown()).optional(),
        },
      },
      (args) =>
        store.runQueued(active, async () => {
          try {
            const result = await handleRpc(db, providers, admin, active.state, {
              id: 1,
              method: args.method,
              params: { profile: args.profile, ...args.params },
            })
            if ('error' in result) throw new Error(result.error.message)
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result.result ?? null) }],
            }
          } catch (cause) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: cause instanceof Error ? cause.message : String(cause),
                },
              ],
            }
          }
        }),
    )
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
  return Object.assign(app, { closeMcp: store.close })
}
