import { and, eq, ne } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeyVirtualAccounts, virtualAccounts, virtualOrders } from '../db/schema'
import { STATIC_METHODS } from '../rpc/methods'

// These administrative methods operate on existing virtual or physical accounts.
// An explicit global method grant is necessary but does not by itself grant access
// to every account. Methods operating on a whole physical account require every
// affected virtual account to grant the method.
const accountMethods = new Set([
  'admin.apiKeys.bind',
  'admin.accountAccess.list',
  'admin.accountAccess.revoke',
  'admin.accounts.update',
  'admin.accounts.freeze',
  'admin.accounts.unfreeze',
  'admin.accounts.close',
  'admin.accounts.activity',
  'admin.accounts.assets.transfer',
  'admin.accounts.assets.transferBatch',
  'admin.accounts.orders.reconcile',
])
const physicalMethods = new Set([
  'admin.accounts.reconciliation.inspect',
  'admin.accounts.reconciliation.approve',
  'admin.accounts.migrate',
  'admin.accounts.create',
])
export const scopedAdminMethods = [...accountMethods, ...physicalMethods]
export const hasUnscopedAdminPermission = (methods: string[] | null | undefined) =>
  !!methods?.some(
    (method) =>
      method.startsWith('admin.') &&
      (STATIC_METHODS as readonly string[]).includes(method) &&
      !accountMethods.has(method) &&
      !physicalMethods.has(method),
  )
export function assertAdminAccountScope(
  db: Db,
  apiKeyId: string,
  method: string,
  input: Record<string, unknown>,
) {
  if (!accountMethods.has(method) && !physicalMethods.has(method)) return
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) ids.add(value)
  }
  if (physicalMethods.has(method)) {
    const physical = typeof input.physicalAccountId === 'string' ? input.physicalAccountId : ''
    if (!physical) throw new Error('physicalAccountId is required')
    for (const account of db
      .select()
      .from(virtualAccounts)
      .where(
        and(eq(virtualAccounts.physicalAccountId, physical), ne(virtualAccounts.status, 'closed')),
      )
      .all())
      ids.add(account.id)
  } else if (method === 'admin.accounts.orders.reconcile') {
    const order = db
      .select()
      .from(virtualOrders)
      .where(eq(virtualOrders.id, String(input.orderId ?? '')))
      .get()
    if (order) ids.add(order.accountId)
  } else if (method === 'admin.accounts.assets.transferBatch') {
    if (Array.isArray(input.transfers))
      for (const transfer of input.transfers) {
        if (transfer && typeof transfer === 'object') {
          add((transfer as Record<string, unknown>).fromAccountId)
          add((transfer as Record<string, unknown>).toAccountId)
        }
      }
  } else if (method === 'admin.accounts.assets.transfer') {
    add(input.fromAccountId)
    add(input.toAccountId)
  } else add(input.accountId)
  if (!ids.size) throw new Error('account scope could not be verified')
  for (const id of ids) {
    const binding = db
      .select()
      .from(apiKeyVirtualAccounts)
      .where(
        and(
          eq(apiKeyVirtualAccounts.apiKeyId, apiKeyId),
          eq(apiKeyVirtualAccounts.virtualAccountId, id),
        ),
      )
      .get()
    // NULL is legacy "all account.*", not permission to administer accounts.
    if (!binding?.allowedMethods?.includes(method))
      throw new Error('API key lacks this admin permission for the account')
  }
}
