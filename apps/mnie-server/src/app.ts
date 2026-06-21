import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { mcpAuthRouter } from '@hono/mcp'
import type { ServerConfig } from './config'
import type { AppBindings } from './context'
import type { Db } from './db'
import { createOAuthServerProvider } from './security/oauth-provider'
import { authenticateRequest } from './security/http-auth'
import { createAdminRoutes } from './routes/admin'
import { createAuthRoutes } from './routes/auth'
import { createMcpRoutes } from './routes/mcp'
import { createOAuthRoutes } from './routes/oauth'
import { createRpcWebSocket } from './rpc/ws'

export const createServerApp = (db: Db, config: ServerConfig) => {
  const app = new Hono<AppBindings>()
  const rpcWebSocket = createRpcWebSocket(db, config)
  const oauthProvider = createOAuthServerProvider(db, config)

  app.use('*', async (c, next) => {
    const auth = await authenticateRequest(db, config, c.req.raw)
    c.set('db', db)
    c.set('config', config)
    c.set('auth', auth)
    c.set('authenticated', auth.authenticated)
    await next()
  })

  app.use(
    '*',
    secureHeaders({
      crossOriginEmbedderPolicy: false,
    }),
  )
  app.use(
    '*',
    cors({
      origin: config.corsOrigin,
      credentials: true,
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))
  app.route(
    '/',
    mcpAuthRouter({
      issuerUrl: new URL(config.origin),
      baseUrl: new URL(config.origin),
      resourceServerUrl: new URL('/api/mcp', config.origin),
      resourceName: 'Mnie finance management',
      scopesSupported: ['read', 'write', 'trade', 'mcp'],
      provider: oauthProvider,
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      clientRegistrationOptions: { rateLimit: false },
      revocationOptions: { rateLimit: false },
    }),
  )
  app.get('/ws', rpcWebSocket.upgradeWebSocket)
  app.route('/auth', createAuthRoutes())
  app.route('/admin', createAdminRoutes())
  app.route('/oauth', createOAuthRoutes())
  app.route('/mcp', createMcpRoutes())

  return { app, websocket: rpcWebSocket.websocket }
}
