import { resolve } from 'node:path'
import { createServerApp } from '../apps/mnie-server/src/app'
import { loadConfig } from '../apps/mnie-server/src/config'
import { createDb } from '../apps/mnie-server/src/db'
import { connectMnie } from '../packages/client-mnie/src/index'

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const databasePath = resolve(process.env.MNIE_DATABASE_PATH ?? 'apps/mnie-app/data/mnie-app.sqlite')
const configured = loadConfig()
const config = {
  ...configured,
  port: 0,
  databasePath,
  origin: 'http://localhost',
  corsOrigin: 'http://localhost',
}
const db = createDb(databasePath)
const runtime = createServerApp(db, config, { backgroundJobs: false })
const requestedProfileId = process.env.MNIE_VERIFY_PROFILE_ID?.trim()
const profile = (await runtime.providers.profiles()).find(
  (candidate) =>
    candidate.provider === 'paypay-bank' &&
    (!requestedProfileId || candidate.id === requestedProfileId),
)
if (!profile) throw new Error('stored PayPay Bank profile was not found')

const token = requiredEnv('CODEX_DEBUG_API_KEY')
let server: ReturnType<typeof Bun.serve> | undefined
let workspace: Awaited<ReturnType<typeof connectMnie>> | undefined

try {
  server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
    websocket: runtime.websocket,
  })
  workspace = await connectMnie({
    baseURL: `http://localhost:${server.port}`,
    token,
    WebSocket,
  })
  const provider = workspace.profile(profile.id)
  const operations = await provider.operations()
  const availability = await provider.checkAvailability()
  if (!availability.ok) {
    throw new Error(`provider availability failed: ${String(availability.message)}`)
  }
  const accounts = await provider.invoke('accounts.list', {})
  const balances = await provider.invoke('balances.list', {})
  const currency =
    balances[0]?.amount?.kind === 'money' ? balances[0].amount.money.currency : undefined
  console.log(
    JSON.stringify({
      provider: profile.provider,
      available: true,
      operations,
      accountCount: accounts.items.length,
      balanceCount: balances.length,
      currency,
      transport: 'websocket',
    }),
  )
} finally {
  workspace?.close()
  server?.stop(true)
  await runtime.close()
}
