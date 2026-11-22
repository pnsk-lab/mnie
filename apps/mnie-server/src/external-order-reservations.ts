import { and, eq, sql } from 'drizzle-orm'
import type { FinancialAssetChange, InvestmentOrder } from '@mnie/types'
import type { Db } from './db'
import {
  accountAudit,
  externalOrderReservations,
  virtualAccounts,
  virtualAssetMovements,
  virtualOrders,
} from './db/schema'
import {
  addDecimal,
  canonicalDecimal,
  compareDecimal,
  financialAssetKey,
  negateDecimal,
} from './virtual-accounts'
import { randomId } from './security/crypto'

/** Unmatched open broker orders reserve Unallocated; they never consume another account implicitly. */
export const syncExternalOrderReservations = (
  db: Db,
  physicalAccountId: string,
  snapshot: { items: InvestmentOrder[]; complete?: boolean },
) => {
  if (snapshot.complete !== true || !Array.isArray(snapshot.items))
    throw new Error('complete broker open-order snapshot is required')
  const system = db
    .select()
    .from(virtualAccounts)
    .where(
      and(
        eq(virtualAccounts.physicalAccountId, physicalAccountId),
        eq(virtualAccounts.systemRole, 'unallocated'),
      ),
    )
    .get()
  if (!system) throw new Error('Unallocated account is missing')
  const known = new Set(
    db
      .select()
      .from(virtualOrders)
      .where(eq(virtualOrders.physicalAccountId, physicalAccountId))
      .all()
      .filter((order) => !order.request.parentId)
      .map((order) => order.providerOrderId),
  )
  const open = snapshot.items.filter(
    (order) =>
      !['executed', 'cancelled', 'expired', 'rejected'].includes(order.status) &&
      !known.has(order.id),
  )
  if (
    open.some((order) => !order.id) ||
    new Set(open.map((order) => order.id)).size !== open.length
  )
    throw new Error('broker order identities are incomplete or duplicated')
  const previous = db
    .select()
    .from(externalOrderReservations)
    .where(eq(externalOrderReservations.physicalAccountId, physicalAccountId))
    .all()
  const incoming = new Map(
    open.map((order) => {
      let state: 'open' | 'needs_review' = 'open'
      const byAsset = new Map<string, FinancialAssetChange>()
      try {
        if (!order.effects || order.effects.referenceId !== order.id)
          throw new Error('external order effects are missing')
        for (const effect of order.effects.changes) {
          const amount = canonicalDecimal(effect.reservedDelta)
          if (compareDecimal(amount, '0') < 0) throw new Error('negative external reservation')
          if (amount === '0') continue
          const key = financialAssetKey(effect.asset)
          const total = addDecimal(byAsset.get(key)?.reservedDelta ?? '0', amount)
          byAsset.set(key, {
            asset: effect.asset,
            availableDelta: negateDecimal(total),
            reservedDelta: total,
            pendingDelta: '0',
          })
        }
        if (!byAsset.size) throw new Error('external reservation amount is missing')
      } catch {
        state = 'needs_review'
        byAsset.clear()
      }
      return [order.id, { state, changes: [...byAsset.values()] }] as const
    }),
  )
  db.transaction((tx) => {
    let changed = false
    const ids = new Set([...previous.map((row) => row.providerOrderId), ...incoming.keys()])
    for (const id of ids) {
      const old = previous.find((row) => row.providerOrderId === id)
      const next = incoming.get(id) ?? { state: 'closed' as const, changes: [] }
      // Unknown reservations remain locked until a complete snapshot proves the order is no longer open.
      const changes: FinancialAssetChange[] = [
        ...(next.state === 'needs_review' ? (old?.changes ?? []) : next.changes),
      ]
      if (old?.state === next.state && JSON.stringify(old.changes) === JSON.stringify(changes))
        continue
      changed = true
      const referenceId = randomId('external-order')
      const amounts = new Map<string, { asset: FinancialAssetChange['asset']; delta: string }>()
      for (const [source, sign] of [
        [old?.changes ?? [], -1],
        [changes, 1],
      ] as const)
        for (const change of source) {
          const key = financialAssetKey(change.asset)
          const delta = sign === 1 ? change.reservedDelta : negateDecimal(change.reservedDelta)
          amounts.set(key, {
            asset: change.asset,
            delta: addDecimal(amounts.get(key)?.delta ?? '0', delta),
          })
        }
      for (const [assetKey, { delta }] of amounts)
        if (delta !== '0')
          tx.insert(virtualAssetMovements)
            .values({
              id: randomId('movement'),
              virtualAccountId: system.id,
              assetKey,
              availableDelta: negateDecimal(delta),
              reservedDelta: delta,
              pendingDelta: '0',
              eventType: 'external_order_reservation',
              referenceType: 'external_order',
              referenceId,
              createdAt: new Date(),
            })
            .run()
      tx.insert(externalOrderReservations)
        .values({
          physicalAccountId,
          providerOrderId: id,
          changes,
          state: next.state,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            externalOrderReservations.physicalAccountId,
            externalOrderReservations.providerOrderId,
          ],
          set: { changes, state: next.state, updatedAt: new Date() },
        })
        .run()
      tx.insert(accountAudit)
        .values({
          id: randomId('audit'),
          accountId: system.id,
          event:
            next.state === 'needs_review'
              ? 'external_order.needs_review'
              : 'external_order.updated',
          detail: { referenceId, state: next.state },
          createdAt: new Date(),
        })
        .run()
    }
    if (changed)
      tx.update(virtualAccounts)
        .set({ version: sql`${virtualAccounts.version} + 1`, updatedAt: new Date() })
        .where(eq(virtualAccounts.id, system.id))
        .run()
  })
}
