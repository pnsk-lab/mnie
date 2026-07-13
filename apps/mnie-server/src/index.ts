import { loadConfig } from './config'
import { createDb } from './db'
import { createServerApp } from './app'
import { assertCaptchaModel } from '@repo/capsolve-sp'

const config = loadConfig()
await assertCaptchaModel()
const db = createDb(config.databasePath)
const runtime = createServerApp(db, config)
const { app, websocket } = runtime

const server = Bun.serve({
  port: config.port,
  fetch(request, server) {
    return app.fetch(request, { server })
  },
  websocket,
})

console.log(`mnie-server listening on http://localhost:${server.port}`)

const shutdown = async () => {
  server.stop(true)
  await runtime.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
