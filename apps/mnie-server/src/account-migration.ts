import { and, eq } from 'drizzle-orm'
import type { Db } from './db'
import {
  accountAudit,
  appState,
  financialAccounts,
  physicalAccountAssets,
  virtualAccounts,
} from './db/schema'
import { applyAssetChanges, compareDecimal } from './virtual-accounts'
import { randomId } from './security/crypto'
import { withProfileLock } from './profile-lock'
import type { PhysicalAccountGateway } from './physical-account-gateway'

/** Owner initiated migration. Existing allocations are never silently overwritten. */
export const migratePhysicalAccount = async (
  db: Db,
  gateway: PhysicalAccountGateway,
  physicalAccountId: string,
) =>
  withProfileLock(`financial:${physicalAccountId}`, async () => {
    const physical = db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.id, physicalAccountId))
      .get()
    if (!physical) throw new Error('physical account not found')
    const key = `account_migration:${physicalAccountId}`
    if (db.select().from(appState).where(eq(appState.key, key)).get()?.value === 'complete')
      throw new Error('account migration is already complete')
    if (physical.kind === 'brokerage') {
      await gateway.assertVirtualTrading(physical.profileId)
      const open = (await gateway.openOrders(physical.profileId, {
        account: physical.providerAccountId,
      })) as { items: unknown[]; complete?: boolean }
      if (open.complete !== true)
        throw new Error('provider cannot confirm the complete open-order snapshot')
      if (open.items.length) throw new Error('resolve broker open orders before migrating')
    }
    await gateway.snapshot(db, physical)
    const id = randomId('acct')
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(virtualAccounts)
        .where(and(eq(virtualAccounts.physicalAccountId, physicalAccountId)))
        .all()
      if (existing.some((account) => account.kind !== 'system'))
        throw new Error('manual allocations already exist; automatic migration is unavailable')
      if (!existing.some((account) => account.systemRole === 'unallocated'))
        throw new Error('initialize Unallocated before migration')
      const now = new Date()
      tx.insert(virtualAccounts)
        .values({
          id,
          physicalAccountId,
          label: 'Personal',
          kind: 'personal',
          status: 'active',
          policy: { tradingEnabled: physical.kind === 'brokerage' },
          createdAt: now,
          updatedAt: now,
        })
        .run()
      const assets = tx
        .select()
        .from(physicalAccountAssets)
        .where(eq(physicalAccountAssets.physicalAccountId, physicalAccountId))
        .all()
      if (!assets.length || assets.some((asset) => compareDecimal(asset.amount, '0') < 0))
        throw new Error('physical snapshot is incomplete or negative')
      applyAssetChanges(tx, {
        accountId: id,
        changes: assets.map((asset) => {
          const [, instrumentId, venue, , accountType] = asset.assetKey.split(':')
          return {
            asset:
              asset.assetKind === 'cash'
                ? { kind: 'cash' as const, currency: asset.assetKey.slice(5) }
                : {
                    kind: 'security' as const,
                    instrumentId: instrumentId!,
                    venue: venue!,
                    positionType: 'cash' as const,
                    accountType,
                  },
            availableDelta: asset.amount,
            reservedDelta: '0',
            pendingDelta: '0',
          }
        }),
        eventType: 'migration_allocation',
        referenceType: 'migration',
        referenceId: key,
      })
      tx.insert(appState)
        .values({ key, value: 'complete', updatedAt: now })
        .onConflictDoUpdate({ target: appState.key, set: { value: 'complete', updatedAt: now } })
        .run()
      tx.insert(accountAudit)
        .values({
          id: randomId('audit'),
          accountId: id,
          event: 'migration.completed',
          detail: {
            assets: assets.map((asset) => ({ assetKey: asset.assetKey, amount: asset.amount })),
          },
          createdAt: now,
        })
        .run()
    })
    return { accountId: id }
  })
