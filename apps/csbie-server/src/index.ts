import { loadConfig } from './config'
import { createDb } from './db'
import { createServerApp } from './app'

const config = loadConfig()
const db = createDb(config.databasePath)
const { app, websocket } = createServerApp(db, config)

const server = Bun.serve({
  port: config.port,
  fetch(request, server) {
    return app.fetch(request, { server })
  },
  websocket,
})

console.log(`csbie-server listening on http://localhost:${server.port}`)
