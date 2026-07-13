import { loadConfig } from './config'
import { createDb } from './db'
import { createServerApp } from './app'
import { assertCaptchaModel } from '@repo/capsolve-sp'

const config = loadConfig()
await assertCaptchaModel()
const db = createDb(config.databasePath)
const { app, websocket } = createServerApp(db, config)

const server = Bun.serve({
  port: config.port,
  fetch(request, server) {
    return app.fetch(request, { server })
  },
  websocket,
})

console.log(`mnie-server listening on http://localhost:${server.port}`)
