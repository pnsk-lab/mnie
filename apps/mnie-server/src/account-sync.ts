import { saveAccountSnapshots } from './account-read-model'
import { withProfileLock } from './profile-lock'
import { eq } from 'drizzle-orm'
import type { OpenOrderSnapshot } from '@mnie/types'
import type { Db } from './db'
import { virtualOrders, financialAccounts, virtualAccounts } from './db/schema'
import type { PhysicalAccountGateway } from './physical-account-gateway'
import { reconcileVirtualOrder } from './order-coordinator'
import { reconcilePhysicalAccount } from './virtual-accounts'
import { syncExternalOrderReservations } from './external-order-reservations'
import { summarizeSyncFailure } from './account-sync-diagnostics'
import {
  clearLegacyPhysicalSyncError,
  clearPhysicalSyncError,
  clearPhysicalSyncErrorsByPrefix,
  isSyncFailureReason,
  listPhysicalSyncErrors,
  setPhysicalSyncError,
  type SyncStage,
} from './sync-errors'

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

  const recordStageError = (
    stage: SyncStage,
    scope: string,
    cause: unknown,
    extra?: { venues?: string[]; orderId?: string; accountId?: string },
  ) => {
    // Persist only a sanitized failure classification and known error code; arbitrary
    // exception messages may contain credentials, account details or upstream bodies.
    const summary = summarizeSyncFailure(cause)
    console.error(
      JSON.stringify({
        event: 'account_sync.failed',
        physicalAccountId,
        stage,
        scope,
        ...summary,
        ...(extra?.venues?.length ? { venues: extra.venues } : {}),
        at: new Date().toISOString(),
      }),
    )
    setPhysicalSyncError(db, physicalAccountId, {
      stage,
      scope,
      ...summary,
      ...extra,
    })
  }

  if (physical.kind === 'brokerage') {
    let canTrade = false
    try {
      await gateway.assertVirtualTrading(physical.profileId)
      clearPhysicalSyncError(db, physicalAccountId, 'provider_capabilities')
      canTrade = true
    } catch (cause) {
      recordStageError('provider_capabilities', 'provider_capabilities', cause)
    }

    if (canTrade) {
      let open: OpenOrderSnapshot | undefined
      try {
        open = (await gateway.openOrders(physical.profileId, {
          account: physical.providerAccountId,
        })) as OpenOrderSnapshot
        if (open?.complete === true) {
          clearPhysicalSyncErrorsByPrefix(db, physicalAccountId, 'open_orders')
        } else if (open?.failedScopes?.length) {
          clearPhysicalSyncError(db, physicalAccountId, 'open_orders')
          const failedScopeKeys = new Set(
            open.failedScopes.map((item) => `open_orders:${item.scope}`),
          )
          for (const existing of listPhysicalSyncErrors(db, physicalAccountId)) {
            if (existing.stage === 'open_orders' && !failedScopeKeys.has(existing.scope)) {
              clearPhysicalSyncError(db, physicalAccountId, existing.scope)
            }
          }
          for (const failed of open.failedScopes) {
            const scope = `open_orders:${failed.scope}`
            const reason = isSyncFailureReason(failed.reason) ? failed.reason : 'unknown'
            console.error(
              JSON.stringify({
                event: 'account_sync.failed',
                physicalAccountId,
                stage: 'open_orders',
                scope,
                reason,
                ...(failed.code ? { code: failed.code } : {}),
                ...(failed.venues?.length ? { venues: failed.venues } : {}),
                at: new Date().toISOString(),
              }),
            )
            setPhysicalSyncError(db, physicalAccountId, {
              stage: 'open_orders',
              scope,
              reason,
              ...(failed.code ? { code: failed.code } : {}),
              ...(failed.venues?.length ? { venues: failed.venues } : {}),
            })
          }
        } else {
          recordStageError(
            'open_orders',
            'open_orders',
            new Error('open order snapshot was incomplete'),
          )
        }
      } catch (cause) {
        recordStageError('open_orders', 'open_orders', cause)
      }

      const orders = db
        .select()
        .from(virtualOrders)
        .where(eq(virtualOrders.physicalAccountId, physicalAccountId))
        .all()
      const activeOrderIds = new Set<string>()
      for (const order of orders) {
        if (
          order.request.parentId ||
          ['filled', 'cancelled', 'rejected', 'expired'].includes(order.state) ||
          !order.providerOrderId
        )
          continue
        activeOrderIds.add(order.id)
        const venue =
          (order.request.instrumentVenue as string | undefined) ??
          (order.request.execution as { venue?: string } | undefined)?.venue
        try {
          const result = await gateway.orderSnapshot(physical.profileId, {
            account: physical.providerAccountId,
            orderId: order.providerOrderId,
            instrumentId: order.request.instrumentId,
            venue,
          })
          reconcileVirtualOrder(db, order.id, result as Record<string, unknown>)
          clearPhysicalSyncError(db, physicalAccountId, `order_snapshot:${order.id}`)
        } catch (cause) {
          recordStageError('order_snapshot', `order_snapshot:${order.id}`, cause, {
            orderId: order.id,
            accountId: order.accountId,
            ...(venue ? { venues: [venue] } : {}),
          })
        }
      }
      for (const existing of listPhysicalSyncErrors(db, physicalAccountId)) {
        if (
          existing.stage === 'order_snapshot' &&
          existing.orderId &&
          !activeOrderIds.has(existing.orderId)
        ) {
          clearPhysicalSyncError(db, physicalAccountId, existing.scope)
        }
      }

      if (open && (open.complete === true || (open.completeVenues?.length ?? 0) > 0)) {
        try {
          syncExternalOrderReservations(db, physicalAccountId, open)
          clearPhysicalSyncError(db, physicalAccountId, 'external_order_reservations')
        } catch (cause) {
          recordStageError('external_order_reservations', 'external_order_reservations', cause)
        }
      }
    }
  }

  try {
    await gateway.snapshot(db, physical)
    clearPhysicalSyncError(db, physicalAccountId, 'physical_assets')
    clearLegacyPhysicalSyncError(db, physicalAccountId)
  } catch (cause) {
    recordStageError('physical_assets', 'physical_assets', cause)
  }

  let reconciliation: Awaited<ReturnType<typeof reconcilePhysicalAccount>>
  try {
    reconciliation = await reconcilePhysicalAccount(db, physicalAccountId)
    clearPhysicalSyncError(db, physicalAccountId, 'reconciliation')
  } catch (cause) {
    recordStageError('reconciliation', 'reconciliation', cause)
    throw cause
  }

  try {
    const accounts = db
      .select()
      .from(virtualAccounts)
      .where(eq(virtualAccounts.physicalAccountId, physicalAccountId))
      .all()
      .filter((account) => account.status !== 'closed')
    await saveAccountSnapshots(
      db,
      accounts.map((account) => account.id),
    )
    clearPhysicalSyncError(db, physicalAccountId, 'virtual_account_snapshots')
  } catch (cause) {
    recordStageError('virtual_account_snapshots', 'virtual_account_snapshots', cause)
  }
  return reconciliation
}

export const syncAccountOrders = (
  db: Db,
  gateway: PhysicalAccountGateway,
  physicalAccountId: string,
) =>
  withProfileLock(`financial:${physicalAccountId}`, () =>
    syncAccountOrdersUnlocked(db, gateway, physicalAccountId),
  )
