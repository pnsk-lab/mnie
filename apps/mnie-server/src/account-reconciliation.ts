import { and, eq, desc } from 'drizzle-orm'
import type { Db } from './db'
import {
  accountAudit,
  externalOrderReservations,
  financialAccounts,
  physicalAccountAssets,
  virtualAccounts,
  virtualOrders,
  virtualAccountSnapshots,
} from './db/schema'
import { addDecimal, listDerivedUnallocatedAssets, negateDecimal } from './virtual-accounts'
import { publicOrder, reconcileVirtualOrder } from './order-coordinator'
import type { PhysicalAccountGateway } from './physical-account-gateway'
import { randomId, sha256 } from './security/crypto'
import { withProfileLock } from './profile-lock'
import { listPhysicalSyncErrors } from './sync-errors'

export const inspectAccountReconciliation = (db: Db, physicalAccountId: string) => {
  const accounts = db
    .select()
    .from(virtualAccounts)
    .where(eq(virtualAccounts.physicalAccountId, physicalAccountId))
    .all()
  if (!accounts.length) throw new Error('physical account not found')
  const unallocated = listDerivedUnallocatedAssets(db, physicalAccountId)
  const physical = db
    .select()
    .from(physicalAccountAssets)
    .where(eq(physicalAccountAssets.physicalAccountId, physicalAccountId))
    .all()
  const orders = db
    .select()
    .from(virtualOrders)
    .where(eq(virtualOrders.physicalAccountId, physicalAccountId))
    .all()
  const assets = unallocated.map((asset) => {
    const actual = physical.find((row) => row.assetKey === asset.assetKey)?.amount ?? '0'
    return {
      assetKey: asset.assetKey,
      allocated: addDecimal(actual, negateDecimal(asset.available)),
      actual,
      unallocated: asset.available,
    }
  })
  const snapshots = accounts.flatMap((account) =>
    db
      .select()
      .from(virtualAccountSnapshots)
      .where(eq(virtualAccountSnapshots.accountId, account.id))
      .orderBy(desc(virtualAccountSnapshots.capturedAt))
      .limit(2)
      .all(),
  )
  const events = accounts.flatMap((account) =>
    db
      .select()
      .from(accountAudit)
      .where(
        and(
          eq(accountAudit.accountId, account.id),
          eq(accountAudit.event, 'external_activity.detected'),
        ),
      )
      .orderBy(desc(accountAudit.createdAt))
      .limit(50)
      .all(),
  )
  const syncErrors = listPhysicalSyncErrors(db, physicalAccountId)
  return {
    snapshotError: syncErrors.length > 0,
    syncErrors,
    externalOrders: db
      .select()
      .from(externalOrderReservations)
      .where(eq(externalOrderReservations.physicalAccountId, physicalAccountId))
      .all()
      .filter((order) => order.state !== 'closed')
      .map((order) => ({
        id: `external_${sha256(`${physicalAccountId}:${order.providerOrderId}`)}`,
        state: order.state,
      })),
    assets,
    orders: orders
      .filter((order) => !['filled', 'cancelled', 'rejected', 'expired'].includes(order.state))
      .map(publicOrder),
    snapshots,
    events,
  }
}

/** An owner supplies the exact broker reference; the broker must independently confirm its identity. */
export const reconcileOrderReference = async (
  db: Db,
  gateway: PhysicalAccountGateway,
  orderId: string,
  providerOrderId: string,
) => {
  const order = db.select().from(virtualOrders).where(eq(virtualOrders.id, orderId)).get()
  if (
    !order ||
    !['submission_unknown', 'reconciliation_required'].includes(order.state) ||
    order.request.parentId
  )
    throw new Error('order cannot be reconciled by reference')
  return withProfileLock(`financial:${order.physicalAccountId}`, async () => {
    if (order.providerOrderId && order.providerOrderId !== providerOrderId)
      throw new Error('broker reference cannot be changed')
    const physical = db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.id, order.physicalAccountId))
      .get()!
    if (
      db
        .select()
        .from(virtualOrders)
        .where(
          and(
            eq(virtualOrders.physicalAccountId, order.physicalAccountId),
            eq(virtualOrders.providerOrderId, providerOrderId),
          ),
        )
        .all()
        .some((row) => row.id !== order.id)
    )
      throw new Error('broker order is already assigned')
    const result = (await gateway.orderSnapshot(physical.profileId, {
      account: physical.providerAccountId,
      orderId: providerOrderId,
      instrumentId: order.request.instrumentId,
      venue:
        order.request.instrumentVenue ??
        (order.request.execution as { venue?: string } | undefined)?.venue,
    })) as Record<string, unknown>
    if (
      result.id !== providerOrderId ||
      result.instrumentId !== order.request.instrumentId ||
      result.side !== order.request.side
    )
      throw new Error('broker order does not match the reserved request')
    if (result.status !== 'open' && !result.effects)
      throw new Error('provider cannot report attributable settlement effects')
    db.transaction((tx) => {
      tx.update(virtualOrders)
        .set({ providerOrderId, updatedAt: new Date() })
        .where(eq(virtualOrders.id, order.id))
        .run()
      reconcileVirtualOrder(db, order.id, result)
      tx.insert(accountAudit)
        .values({
          id: randomId('audit'),
          accountId: order.accountId,
          event: 'order.reference_confirmed',
          detail: { orderId: order.id },
          createdAt: new Date(),
        })
        .run()
    })
    return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, order.id)).get()!)
  })
}
