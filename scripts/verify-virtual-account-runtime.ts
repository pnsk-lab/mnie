import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq } from 'drizzle-orm'
import { resolve } from 'node:path'
import * as schema from '../apps/mnie-server/src/db/schema'
import { loadConfig } from '../apps/mnie-server/src/config'
import { createProviderRegistry } from '../apps/mnie-server/src/providers/registry'
import { createApiKey, revokeApiKey } from '../apps/mnie-server/src/security/api-keys'
import { connectMnie } from '../packages/client-mnie/src/index'

const required = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const config = loadConfig()
const path = resolve(required('MNIE_VERIFY_DATABASE_PATH'))
const accountId = required('MNIE_VERIFY_ACCOUNT_ID')
const origin = required('MNIE_VERIFY_ORIGIN')
// Inspect the running installation without triggering startup recovery in createDb().
const sqlite = new Database(path, { readonly: false, strict: true })
const db = drizzle(sqlite, { schema })
const registry = createProviderRegistry(db, config)
const account = db
  .select()
  .from(schema.virtualAccounts)
  .where(eq(schema.virtualAccounts.id, accountId))
  .get()
if (!account || account.kind === 'system')
  throw new Error('select an existing Personal or Agent account')
const physical = db
  .select()
  .from(schema.financialAccounts)
  .where(eq(schema.financialAccounts.id, account.physicalAccountId))
  .get()
if (!physical) throw new Error('physical account not found')
let keyId: string | undefined
let workspace: Awaited<ReturnType<typeof connectMnie>> | undefined
try {
  const key = await createApiKey(db, 'Temporary account runtime verification', {
    scopes: ['read'],
    accountBindings: [{ accountId, role: 'read' }],
  })
  keyId = key.id
  workspace = await connectMnie({ baseURL: origin, token: key.token, WebSocket })
  const visible = await workspace.accounts()
  if (visible.length !== 1 || visible[0]?.id !== accountId)
    throw new Error('SDK account visibility is incorrect')
  const balances = await workspace.call('portfolio.accounts.balances', { account: accountId })
  const history = await workspace.call('portfolio.accounts.history', { account: accountId })
  let providerAccounts = 0
  let providerBalances = 0
  await registry.use(physical.profileId, async ({ provider }) => {
    const availability = await provider.checkAvailability()
    if (!availability.ok) throw new Error('stored provider session is not authenticated')
    const accounts = (await provider.invoke('accounts.list', {})) as { items: unknown[] }
    const balances = (await provider.invoke('balances.list', {
      account: physical.providerAccountId,
    })) as unknown[]
    providerAccounts = accounts.items.length
    providerBalances = balances.length
  })
  console.log(
    JSON.stringify({
      authenticated: true,
      transport: 'websocket',
      visibleAccountCount: visible.length,
      virtualAssetCount: balances.assets.length,
      historyCount: history.items.length,
      providerAccountCount: providerAccounts,
      providerBalanceCount: providerBalances,
    }),
  )
} finally {
  workspace?.close()
  if (keyId) await revokeApiKey(db, keyId)
  sqlite.close()
}
