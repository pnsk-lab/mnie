import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import { createServerApp } from '@repo/csbie-server/app'
import { loadConfig } from '@repo/csbie-server/config'
import { createDb } from '@repo/csbie-server/db'

const config = loadConfig()
const db = createDb(config.databasePath)
const api = createServerApp(db, config)
const app = new Hono()
const uiDist = join(import.meta.dir, '../../csbie-ui/dist')

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

app.route('/api', api.app)
app.route('/', api.app)

const serveUi = async (request: Request) => {
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = join(uiDist, relativePath)
  const resolvedPath = existsSync(filePath) ? filePath : join(uiDist, 'index.html')
  const file = Bun.file(resolvedPath)
  const headers = new Headers()
  headers.set('content-type', contentTypes[extname(resolvedPath)] ?? 'application/octet-stream')
  return new Response(file, { headers })
}

const server = Bun.serve({
  port: config.port,
  fetch(request, server) {
    const url = new URL(request.url)
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/.well-known/') ||
      url.pathname.startsWith('/oauth/') ||
      ['/authorize', '/token', '/register', '/revoke'].includes(url.pathname)
    ) {
      return app.fetch(request, { server })
    }
    return serveUi(request)
  },
  websocket: api.websocket,
})

console.log(`csbie listening on http://localhost:${server.port}`)
