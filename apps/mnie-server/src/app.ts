import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { mcpAuthRouter } from '@hono/mcp'
import type { ServerConfig } from './config'
import type { AppBindings } from './context'
import type { Db } from './db'
import { createCronSystem } from './cron'
import { createOAuthServerProvider } from './security/oauth-provider'
import { authenticateRequest } from './security/http-auth'
import { createAuthRoutes } from './routes/auth'
import { createOAuthRoutes } from './routes/oauth'
import { createRpcWebSocket } from './rpc/ws'
import { createProviderRegistry } from './providers/registry'
import { AdminRpcService } from './rpc/admin'

export const createServerApp = (
  db: Db,
  config: ServerConfig,
  options: { backgroundJobs?: boolean } = {},
) => {
  const app = new Hono<AppBindings>()
  const providers = createProviderRegistry(db, config)
  const cronSystem = createCronSystem(db, config, providers, { start: options.backgroundJobs })
  const adminRpc = new AdminRpcService(db, providers, cronSystem)
  const rpcWebSocket = createRpcWebSocket(db, providers, adminRpc)
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

  app.route(
    '/',
    mcpAuthRouter({
      issuerUrl: new URL(config.origin),
      baseUrl: new URL(config.origin),
      resourceServerUrl: new URL('/api/ws', config.origin),
      resourceName: 'Mnie finance management',
      scopesSupported: ['read', 'trade'],
      provider: oauthProvider,
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      clientRegistrationOptions: { rateLimit: false },
      revocationOptions: { rateLimit: false },
    }),
  )
  app.get('/api/ws', rpcWebSocket.upgradeWebSocket)
  app.route('/api/auth', createAuthRoutes())
  app.route('/api/oauth', createOAuthRoutes())

  return {
    app,
    websocket: rpcWebSocket.websocket,
    providers,
    close: () => cronSystem.close(),
  }
}
