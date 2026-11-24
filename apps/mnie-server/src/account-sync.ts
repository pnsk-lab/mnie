import { saveAccountSnapshots } from './account-read-model'
import { withProfileLock } from './profile-lock'
import { eq } from 'drizzle-orm'
import type { InvestmentOrder } from '@mnie/types'
import type { Db } from './db'
import { virtualOrders, financialAccounts, virtualAccounts, appState } from './db/schema'
import type { PhysicalAccountGateway } from './physical-account-gateway'
import { reconcileVirtualOrder } from './order-coordinator'
import { reconcilePhysicalAccount } from './virtual-accounts'
import { syncExternalOrderReservations } from './external-order-reservations'

export const syncAccountOrdersUnlocked = async (
  db: Db,
  gateway: PhysicalAccountGateway,
  physicalAccountId: string,
) => {
  const physical = db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.id, physicalAccountId))
    .get()
  if (!physical) throw new Error('physical account not found')
  let stage = 'provider_capabilities'
  try {
    if (physical.kind === 'brokerage') {
      await gateway.assertVirtualTrading(physical.profileId)
      stage = 'open_orders'
      const open = (await gateway.openOrders(physical.profileId, {
        account: physical.providerAccountId,
      })) as { items: InvestmentOrder[]; complete?: boolean }
      const orders = db
        .select()
        .from(virtualOrders)
        .where(eq(virtualOrders.physicalAccountId, physicalAccountId))
        .all()
      for (const order of orders) {
        if (
          order.request.parentId ||
          ['filled', 'cancelled', 'rejected', 'expired'].includes(order.state) ||
          !order.providerOrderId
        )
          continue
        stage = 'order_snapshot'
        const result = await gateway.orderSnapshot(physical.profileId, {
          account: physical.providerAccountId,
          orderId: order.providerOrderId,
          instrumentId: order.request.instrumentId,
          venue:
            order.request.instrumentVenue ??
            (order.request.execution as { venue?: string } | undefined)?.venue,
        })
        reconcileVirtualOrder(db, order.id, result as Record<string, unknown>)
      }
      stage = 'external_order_reservations'
      syncExternalOrderReservations(db, physicalAccountId, open)
    }
    stage = 'physical_assets'
    await gateway.snapshot(db, physical)
    db.delete(appState)
      .where(eq(appState.key, `physical_snapshot_error:${physicalAccountId}`))
      .run()
    stage = 'reconciliation'
    const reconciliation = await reconcilePhysicalAccount(db, physicalAccountId)
    const accounts = db
      .select()
      .from(virtualAccounts)
      .where(eq(virtualAccounts.physicalAccountId, physicalAccountId))
      .all()
      .filter((account) => account.status !== 'closed')
    stage = 'virtual_account_snapshots'
    await saveAccountSnapshots(
      db,
      accounts.map((account) => account.id),
    )
    return reconciliation
  } catch (cause) {
    // Persist only a known broker error code; arbitrary exception messages may
    // contain credentials, account details or upstream response bodies.
    const message = cause instanceof Error ? cause.message : String(cause)
    const code = message.match(/\bECOMN\d{4}\b/)?.[0]
    console.error(JSON.stringify({ event: 'account_sync.failed', physicalAccountId, stage, ...(code ? { code } : {}), at: new Date().toISOString() }))
    db.insert(appState)
      .values({
        key: `physical_snapshot_error:${physicalAccountId}`,
        value: 'BROKER_SNAPSHOT_UNAVAILABLE',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value: 'BROKER_SNAPSHOT_UNAVAILABLE', updatedAt: new Date() },
      })
      .run()
    await reconcilePhysicalAccount(db, physicalAccountId)
    throw cause
  }
}

export const syncAccountOrders = (
  db: Db,
  gateway: PhysicalAccountGateway,
  physicalAccountId: string,
) =>
  withProfileLock(`financial:${physicalAccountId}`, () =>
    syncAccountOrdersUnlocked(db, gateway, physicalAccountId),
  )
