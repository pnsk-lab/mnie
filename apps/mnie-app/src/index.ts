import { existsSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { Hono } from 'hono'
import { createServerApp } from '@repo/mnie-server/app'
import { loadConfig } from '@repo/mnie-server/config'
import { createDb } from '@repo/mnie-server/db'

const config = loadConfig()
const db = createDb(config.databasePath)
const api = createServerApp(db, config)
const app = new Hono()
const uiDist = resolve(import.meta.dir, '../../mnie-ui/dist')

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

app.route('/', api.app)

const isInsideUiDist = (path: string) => {
  const pathFromUiDist = relative(uiDist, path)
  return pathFromUiDist === '' || (!pathFromUiDist.startsWith('..') && !isAbsolute(pathFromUiDist))
}

const serveUi = async (request: Request) => {
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = resolve(uiDist, relativePath)
  if (!isInsideUiDist(filePath)) return new Response('Not Found', { status: 404 })
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
      ['/authorize', '/token', '/register', '/revoke'].includes(url.pathname)
    ) {
      return app.fetch(request, { server })
    }
    return serveUi(request)
  },
  websocket: api.websocket,
})

console.log(`mnie listening on http://localhost:${server.port}`)

const shutdown = async () => {
  server.stop(true)
  await api.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
