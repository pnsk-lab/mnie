const uiPort = Number(process.env.MNIE_UI_DEV_PORT ?? 5173)
const serverPort = Number(process.env.PORT ?? process.env.MNIE_SERVER_PORT ?? 8787)
const uiOrigin = `http://127.0.0.1:${uiPort}`
const serverEntry = new URL('../../mnie-server/src/index.ts', import.meta.url).pathname

const ui = Bun.spawn({
  cmd: ['bun', '--filter', '@repo/mnie-ui', 'dev'],
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: process.env,
})

const server = Bun.spawn({
  cmd: ['bun', '--watch', serverEntry],
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: {
    ...process.env,
    PORT: String(serverPort),
    MNIE_ORIGIN: uiOrigin,
    MNIE_CORS_ORIGIN: uiOrigin,
  },
})

const shutdown = () => {
  ui.kill()
  server.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const appExit = await server.exited
shutdown()
process.exit(appExit)
