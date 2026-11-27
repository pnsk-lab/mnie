import { consumeApiKeyTradeLimitsSync } from './security/trade-limits'
import { applyPhysicalAccountAssetChanges } from './physical-accounts'
import { and, eq, isNull } from 'drizzle-orm'
import type { FinancialAssetChange, FinancialOperationEffects } from '@mnie/types'
import type { Db } from './db'
import { accountAudit, virtualOrderQuotes, virtualOrders } from './db/schema'
import { randomId, sha256 } from './security/crypto'
import { openCredential, sealCredential } from './security/keyring'
import {
  applyAssetChanges,
  invertChanges,
  financialAssetKey,
  addDecimal,
  compareDecimal,
  negateDecimal,
} from './virtual-accounts'
import {
  assertAccountTrade,
  assertReservationPolicy,
  assertOrderRisk,
  principalId,
  type AccountAccess,
} from './account-policy'

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value
export const requestHash = (input: Record<string, unknown>) =>
  sha256(JSON.stringify(canonical(input)))
const cleanInput = (input: Record<string, unknown>) => {
  if (
    [
      'parentId',
      'physicalAccountId',
      'providerOrderId',
      'reservationId',
      'principal',
      'effects',
      'projectedAssetChanges',
      'state',
    ].some((key) => key in input)
  )
    throw new Error('internal order fields are not accepted')
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key]) =>
        !['confirmationToken', 'quoteId', 'idempotencyKey', 'allowTransaction'].includes(key),
    ),
  )
}
const audit = (db: Db, accountId: string, event: string, detail: Record<string, unknown>) =>
  db
    .insert(accountAudit)
    .values({ id: randomId('audit'), accountId, event, detail, createdAt: new Date() })
    .run()
export const publicOrder = (row: typeof virtualOrders.$inferSelect) => ({
  instrumentId: row.request.instrumentId,
  side: row.request.side,
  quantity: row.request.quantity,
  venue:
    row.request.instrumentVenue ?? (row.request.execution as { venue?: string } | undefined)?.venue,
  ...row.result,
  id: typeof row.request.parentId === 'string' ? row.request.parentId : row.id,
  accountId: row.accountId,
  status:
    typeof row.request.parentId === 'string' && typeof row.result?.status === 'string'
      ? row.result.status
      : row.state,
  orderedAt: row.createdAt.toISOString(),
})

export const storeOrderQuote = async (
  db: Db,
  accountId: string,
  access: AccountAccess,
  operation: string,
  request: Record<string, unknown>,
  preview: Record<string, unknown>,
) => {
  const parent =
    operation === 'investments.orders.replace.preview'
      ? db
          .select()
          .from(virtualOrders)
          .where(
            and(
              eq(virtualOrders.id, String(request.orderId ?? '')),
              eq(virtualOrders.accountId, accountId),
            ),
          )
          .get()
      : undefined
  if (operation === 'investments.orders.replace.preview' && !parent)
    throw new Error('order not found')
  const riskRequest = parent
    ? {
        ...parent.request,
        ...request,
        execution: {
          ...(parent.request.execution as Record<string, unknown> | undefined),
          priceType: request.limitPrice ? 'limit' : 'market',
          limitPrice: request.limitPrice,
        },
      }
    : request
  const account = assertAccountTrade(db, accountId, access, riskRequest, operation)
  const token = preview.confirmationToken
  const changes = preview.projectedAssetChanges as FinancialAssetChange[] | undefined
  if (typeof token !== 'string' || !changes?.length)
    throw new Error('provider cannot determine a safe reservation')
  if (
    changes.some(
      (change) =>
        change.availableDelta.startsWith('-') &&
        !change.reservedDelta.startsWith('-') &&
        change.reservedDelta === '0',
    )
  )
    throw new Error('provider returned an invalid reservation')
  assertOrderRisk(db, accountId, access, riskRequest, changes, operation)
  const id = randomId('quote')
  const expiresAt = new Date(
    Math.min(
      Date.now() + 5 * 60_000,
      typeof preview.expiresAt === 'string' ? new Date(preview.expiresAt).getTime() : Infinity,
    ),
  )
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    throw new Error('provider quote has expired')
  const sealedToken = await sealCredential(token)
  const publicPreview = {
    ...Object.fromEntries(
      Object.entries(preview).filter(([key]) =>
        [
          'estimatedAmount',
          'tradeAmount',
          'heldAmount',
          'settlementCurrency',
          'quantity',
          'price',
          'exchangeRate',
          'warnings',
          'fees',
        ].includes(key),
      ),
    ),
    confirmationToken: id,
    quoteId: id,
    expiresAt: expiresAt.toISOString(),
  }
  // Encryption may await: revalidate access and policy after it completes.
  const current = assertAccountTrade(db, accountId, access, riskRequest, operation)
  if (current.version !== account.version) throw new Error('account changed during preview')
  db.insert(virtualOrderQuotes)
    .values({
      id,
      accountId,
      principal: principalId(access),
      accountVersion: current.version,
      operation,
      requestHash: requestHash(cleanInput(request)),
      request: cleanInput(request),
      sealedToken,
      changes,
      preview: publicPreview,
      expiresAt,
      createdAt: new Date(),
    })
    .run()
  return publicPreview
}

export const createCoordinatedOrder = async (
  db: Db,
  accountId: string,
  access: AccountAccess,
  input: Record<string, unknown>,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
  preflight?: (
    input: Record<string, unknown>,
  ) => Promise<{ transactionAmount?: { currency: string; value: string } } | void>,
) => {
  const idempotencyKey = String(input.idempotencyKey ?? '')
  if (!idempotencyKey) throw new Error('idempotencyKey is required')
  if (input.allowTransaction !== true) throw new Error('allowTransaction: true is required')
  const hash = requestHash({
    quoteId: input.quoteId ?? input.confirmationToken,
    ...cleanInput(input),
  })
  const existing = db
    .select()
    .from(virtualOrders)
    .where(
      and(eq(virtualOrders.accountId, accountId), eq(virtualOrders.idempotencyKey, idempotencyKey)),
    )
    .get()
  if (existing) {
    if (existing.requestHash !== hash)
      throw new Error('idempotency key was used for another request')
    return publicOrder(existing)
  }
  const quoteId = String(input.quoteId ?? input.confirmationToken ?? '')
  const quote = db.select().from(virtualOrderQuotes).where(eq(virtualOrderQuotes.id, quoteId)).get()
  if (
    !quote ||
    quote.accountId !== accountId ||
    quote.principal !== principalId(access) ||
    quote.consumedAt ||
    quote.expiresAt <= new Date() ||
    quote.operation !== 'investments.orders.preview' ||
    (Object.keys(cleanInput(input)).length > 0 &&
      quote.requestHash !== requestHash(cleanInput(input)))
  )
    throw new Error('quote is invalid or expired')
  const confirmationToken = await openCredential(quote.sealedToken)
  const trusted = await preflight?.({ ...quote.request, confirmationToken, allowTransaction: true })
  const concurrent = db
    .select()
    .from(virtualOrders)
    .where(
      and(eq(virtualOrders.accountId, accountId), eq(virtualOrders.idempotencyKey, idempotencyKey)),
    )
    .get()
  if (concurrent) {
    if (concurrent.requestHash !== hash)
      throw new Error('idempotency key was used for another request')
    return publicOrder(concurrent)
  }
  if (quote.expiresAt <= new Date()) throw new Error('quote has expired')
  const id = randomId('order')
  const now = new Date()
  db.transaction((tx) => {
    const account = assertAccountTrade(db, accountId, access, quote.request)
    if (account.version !== quote.accountVersion) throw new Error('quote account version changed')
    assertOrderRisk(db, accountId, access, quote.request, quote.changes)
    if (access.apiKeyId)
      consumeApiKeyTradeLimitsSync({
        db,
        apiKeyId: access.apiKeyId,
        operation: 'investments.orders.create',
        params: {
          ...quote.request,
          ...(trusted?.transactionAmount ? { amount: trusted.transactionAmount } : {}),
        },
      })
    const consumed = tx
      .update(virtualOrderQuotes)
      .set({ consumedAt: now })
      .where(and(eq(virtualOrderQuotes.id, quoteId), isNull(virtualOrderQuotes.consumedAt)))
      .returning()
      .get()
    if (!consumed) throw new Error('quote has already been used')
    applyAssetChanges(tx, {
      accountId,
      changes: quote.changes,
      eventType: 'order_reservation',
      referenceType: 'order_reservation',
      referenceId: id,
    })
    tx.insert(virtualOrders)
      .values({
        id,
        accountId,
        physicalAccountId: account.physicalAccountId,
        idempotencyKey,
        requestHash: hash,
        request: quote.request,
        state: 'submitting',
        reservationId: id,
        changes: quote.changes,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    audit(db, accountId, 'order.submitting', { orderId: id, principal: principalId(access) })
  })
  let result: Record<string, unknown>
  try {
    result = (await execute({
      ...quote.request,
      confirmationToken,
      allowTransaction: true,
    })) as Record<string, unknown>
  } catch {
    // A transport error is not proof of rejection. Keep the reservation until reconciliation.
    db.update(virtualOrders)
      .set({
        state: 'submission_unknown',
        error: 'Broker submission outcome is unknown',
        updatedAt: new Date(),
      })
      .where(eq(virtualOrders.id, id))
      .run()
    audit(db, accountId, 'order.submission_unknown', { orderId: id })
    return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, id)).get()!)
  }
  const effects = result.effects as FinancialOperationEffects | undefined
  const rejected = result.status === 'rejected'
  const state = rejected
    ? 'rejected'
    : result.id && effects && effects.referenceId === result.id
      ? result.status === 'executed' || result.status === 'filled'
        ? 'filled'
        : 'open'
      : 'submission_unknown'
  const publicResult = {
    ...Object.fromEntries(
      Object.entries(result).filter(([key]) =>
        [
          'instrumentId',
          'instrumentName',
          'side',
          'amount',
          'quantity',
          'price',
          'venue',
          'accountType',
          'orderedAt',
          'executedQuantity',
          'unexecutedQuantity',
        ].includes(key),
      ),
    ),
    id,
    accountId,
  }
  try {
    db.transaction((tx) => {
      if (rejected || state !== 'submission_unknown') {
        applyAssetChanges(tx, {
          accountId,
          changes: invertChanges(quote.changes),
          eventType: 'order_reservation_release',
          referenceType: 'order_reservation_release',
          referenceId: id,
        })
        if (!rejected && effects) {
          applyAssetChanges(tx, {
            accountId,
            changes: effects.changes,
            eventType: 'order_accepted',
            referenceType: 'order_accepted',
            referenceId: id,
          })
          applyPhysicalAccountAssetChanges(
            db,
            tx.select().from(virtualOrders).where(eq(virtualOrders.id, id)).get()!
              .physicalAccountId,
            effects.changes,
          )
        }
      }
      tx.update(virtualOrders)
        .set({
          state,
          providerOrderId: typeof result.id === 'string' ? result.id : null,
          changes:
            state !== 'submission_unknown' && !rejected && effects
              ? effects.changes
              : quote.changes,
          result: publicResult,
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, id))
        .run()
      audit(db, accountId, `order.${state}`, { orderId: id })
    })
  } catch {
    try {
      db.update(virtualOrders)
        .set({
          state: 'submission_unknown',
          providerOrderId: typeof result.id === 'string' ? result.id : null,
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, id))
        .run()
    } catch {
      // A broker reference already owned by another virtual order must never be attached twice.
      db.update(virtualOrders)
        .set({
          state: 'submission_unknown',
          error: 'Broker reference conflicts with an existing order',
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, id))
        .run()
    }
  }
  return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, id)).get()!)
}

export const changeCoordinatedOrder = async (
  db: Db,
  accountId: string,
  access: AccountAccess,
  operation: 'cancel' | 'replace',
  input: Record<string, unknown>,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
  preflight?: (
    input: Record<string, unknown>,
  ) => Promise<{ transactionAmount?: { currency: string; value: string } } | void>,
) => {
  const parent = db
    .select()
    .from(virtualOrders)
    .where(
      and(
        eq(virtualOrders.id, String(input.orderId ?? '')),
        eq(virtualOrders.accountId, accountId),
      ),
    )
    .get()
  if (!parent?.providerOrderId) throw new Error('order not found')
  if (input.allowTransaction !== true) throw new Error('allowTransaction: true is required')
  const idempotencyKey = String(input.idempotencyKey ?? '')
  if (!idempotencyKey) throw new Error('idempotencyKey is required')
  const hash = requestHash({ ...cleanInput(input), operation })
  const previous = db
    .select()
    .from(virtualOrders)
    .where(
      and(eq(virtualOrders.accountId, accountId), eq(virtualOrders.idempotencyKey, idempotencyKey)),
    )
    .get()
  if (previous) {
    if (previous.requestHash !== hash)
      throw new Error('idempotency key was used for another request')
    return publicOrder(previous)
  }
  if (!['open', 'partially_filled'].includes(parent.state))
    throw new Error('order cannot be changed in its current state')
  let quote: typeof virtualOrderQuotes.$inferSelect | undefined
  let confirmationToken: string | undefined
  if (operation === 'replace') {
    quote = db
      .select()
      .from(virtualOrderQuotes)
      .where(eq(virtualOrderQuotes.id, String(input.quoteId ?? input.confirmationToken ?? '')))
      .get()
    if (
      !quote ||
      quote.accountId !== accountId ||
      quote.principal !== principalId(access) ||
      quote.operation !== 'investments.orders.replace.preview' ||
      quote.consumedAt ||
      quote.expiresAt <= new Date() ||
      quote.requestHash !== requestHash(cleanInput(input))
    )
      throw new Error('quote is invalid or expired')
    confirmationToken = await openCredential(quote.sealedToken)
  }
  const trusted = await preflight?.({
    ...parent.request,
    ...cleanInput(input),
    orderId: parent.providerOrderId,
    confirmationToken,
    allowTransaction: true,
  })
  const id = randomId('command')
  const extra: FinancialAssetChange[] = []
  if (quote) {
    for (const change of quote.changes) {
      const key = financialAssetKey(change.asset)
      const old = parent.changes
        .filter((entry) => financialAssetKey(entry.asset) === key)
        .reduce((sum, entry) => addDecimal(sum, entry.reservedDelta), '0')
      const difference = addDecimal(change.reservedDelta, negateDecimal(old))
      if (compareDecimal(difference, '0') > 0)
        extra.push({
          asset: change.asset,
          availableDelta: negateDecimal(difference),
          reservedDelta: difference,
          pendingDelta: '0',
        })
    }
  }
  db.transaction((tx) => {
    const account = assertAccountTrade(
      db,
      accountId,
      access,
      { ...parent.request, ...input },
      `investments.orders.${operation}`,
    )
    if (access.apiKeyId)
      consumeApiKeyTradeLimitsSync({
        db,
        apiKeyId: access.apiKeyId,
        operation: `investments.orders.${operation}`,
        params: {
          ...parent.request,
          ...input,
          ...(trusted?.transactionAmount ? { amount: trusted.transactionAmount } : {}),
        },
      })
    if (quote) {
      if (account.version !== quote.accountVersion) throw new Error('quote account version changed')
      assertReservationPolicy(account.policy, quote.changes)
      if (
        !tx
          .update(virtualOrderQuotes)
          .set({ consumedAt: new Date() })
          .where(and(eq(virtualOrderQuotes.id, quote.id), isNull(virtualOrderQuotes.consumedAt)))
          .returning()
          .get()
      )
        throw new Error('quote has already been used')
    }
    if (
      !tx
        .update(virtualOrders)
        .set({
          state: operation === 'cancel' ? 'cancel_pending' : 'replace_pending',
          updatedAt: new Date(),
        })
        .where(and(eq(virtualOrders.id, parent.id), eq(virtualOrders.state, parent.state)))
        .returning()
        .get()
    )
      throw new Error('order state conflict')
    if (extra.length)
      applyAssetChanges(tx, {
        accountId,
        changes: extra,
        eventType: 'replacement_reservation',
        referenceType: 'replacement_reservation',
        referenceId: id,
      })
    tx.insert(virtualOrders)
      .values({
        id,
        accountId,
        physicalAccountId: parent.physicalAccountId,
        idempotencyKey,
        requestHash: hash,
        request: { ...cleanInput(input), operation, parentId: parent.id },
        state: operation === 'cancel' ? 'cancel_pending' : 'replace_pending',
        changes: extra,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()
    audit(db, accountId, `order.${operation}_pending`, {
      orderId: parent.id,
      commandId: id,
      principal: principalId(access),
    })
  })
  let result: Record<string, unknown>
  try {
    result = (await execute({
      ...cleanInput(input),
      allowTransaction: true,
      orderId: parent.providerOrderId,
      ...(confirmationToken ? { confirmationToken } : {}),
    })) as Record<string, unknown>
  } catch {
    db.update(virtualOrders)
      .set({ state: 'submission_unknown', updatedAt: new Date() })
      .where(eq(virtualOrders.id, id))
      .run()
    return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, id)).get()!)
  }
  const effects = result.effects as FinancialOperationEffects | undefined
  const rejected = result.status === 'rejected'
  // A cancellation receipt alone is not a terminal broker confirmation.
  const confirmed =
    rejected ||
    (operation === 'replace' && !!effects) ||
    (operation === 'cancel' && result.status === 'cancelled' && result.confirmed === true)
  if (!confirmed) {
    db.update(virtualOrders)
      .set({ providerOrderId: parent.providerOrderId, updatedAt: new Date() })
      .where(eq(virtualOrders.id, id))
      .run()
    return publicOrder(
      db.select().from(virtualOrders).where(eq(virtualOrders.id, parent.id)).get()!,
    )
  }
  try {
    db.transaction((tx) => {
      if (extra.length)
        applyAssetChanges(tx, {
          accountId,
          changes: invertChanges(extra),
          eventType: 'replacement_release',
          referenceType: 'replacement_release',
          referenceId: id,
        })
      if (!rejected) {
        applyAssetChanges(tx, {
          accountId,
          changes: invertChanges(parent.changes),
          eventType: 'order_change_release',
          referenceType: 'order_change_release',
          referenceId: id,
        })
        if (effects?.changes.length)
          applyAssetChanges(tx, {
            accountId,
            changes: effects.changes,
            eventType: 'order_changed',
            referenceType: 'order_changed',
            referenceId: id,
          })
      }
      const state = rejected ? parent.state : operation === 'cancel' ? 'cancelled' : 'open'
      tx.update(virtualOrders)
        .set({
          state,
          providerOrderId:
            !rejected && operation === 'replace' && typeof result.id === 'string'
              ? result.id
              : parent.providerOrderId,
          changes: rejected ? parent.changes : (effects?.changes ?? []),
          request: rejected
            ? parent.request
            : {
                ...parent.request,
                ...cleanInput(input),
                execution: {
                  ...(parent.request.execution as Record<string, unknown> | undefined),
                  priceType: input.limitPrice ? 'limit' : 'market',
                  limitPrice: input.limitPrice,
                },
              },
          result: rejected
            ? parent.result
            : {
                ...parent.result,
                quantity: input.quantity ?? parent.result?.quantity,
                price: input.limitPrice ?? parent.result?.price,
              },
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, parent.id))
        .run()
      tx.update(virtualOrders)
        .set({
          state: rejected ? 'rejected' : 'filled',
          result: { id: parent.id, accountId, status: state },
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, id))
        .run()
      audit(db, accountId, `order.${state}`, { orderId: parent.id, commandId: id })
    })
  } catch {
    db.update(virtualOrders)
      .set({ state: 'submission_unknown', updatedAt: new Date() })
      .where(eq(virtualOrders.id, id))
      .run()
    return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, id)).get()!)
  }
  return publicOrder(db.select().from(virtualOrders).where(eq(virtualOrders.id, parent.id)).get()!)
}

/** Reconcile an identified broker order. Missing effects are never guessed from account totals. */
export const reconcileVirtualOrder = (db: Db, orderId: string, result: Record<string, unknown>) => {
  const order = db.select().from(virtualOrders).where(eq(virtualOrders.id, orderId)).get()
  if (!order || !order.providerOrderId || result.id !== order.providerOrderId)
    throw new Error('broker order identity mismatch')
  const effects = result.effects as FinancialOperationEffects | undefined
  if (effects && effects.referenceId !== order.providerOrderId)
    throw new Error('broker effects identity mismatch')
  const status = String(result.status ?? 'unknown')
  const state =
    status === 'executed'
      ? 'filled'
      : compareDecimal(String(result.executedQuantity ?? '0'), '0') > 0 && status === 'open'
        ? 'partially_filled'
        : status
  if (!['open', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired'].includes(state))
    throw new Error('broker order state is unknown')
  // An unchanged open order does not require a new ledger movement.
  if (
    !effects &&
    state === 'open' &&
    compareDecimal(String(result.executedQuantity ?? '0'), '0') === 0
  ) {
    if (['submitting', 'submission_unknown'].includes(order.state)) {
      db.update(virtualOrders)
        .set({ state: 'open', error: null, updatedAt: new Date() })
        .where(eq(virtualOrders.id, order.id))
        .run()
      audit(db, order.accountId, 'order.recovered', { orderId: order.id })
    }
    return
  }
  const terminalWithoutFill =
    ['cancelled', 'rejected', 'expired'].includes(state) &&
    result.executedQuantity !== undefined &&
    compareDecimal(String(result.executedQuantity), '0') === 0
  if (!effects && !terminalWithoutFill) {
    db.update(virtualOrders)
      .set({ state: 'reconciliation_required', updatedAt: new Date() })
      .where(eq(virtualOrders.id, order.id))
      .run()
    return
  }
  const changes = effects?.changes ?? []
  const reference = `${order.id}:${requestHash({ state, changes })}`
  if (order.state === state && requestHash({ changes: order.changes }) === requestHash({ changes }))
    return
  try {
    db.transaction((tx) => {
      applyAssetChanges(tx, {
        accountId: order.accountId,
        changes: invertChanges(order.changes),
        eventType: 'order_sync_release',
        referenceType: 'order_sync_release',
        referenceId: reference,
        settlement: true,
      })
      if (changes.length)
        applyAssetChanges(tx, {
          accountId: order.accountId,
          changes,
          eventType: 'order_sync',
          referenceType: 'order_sync',
          referenceId: reference,
          settlement: true,
        })
      applyPhysicalAccountAssetChanges(db, order.physicalAccountId, [
        ...invertChanges(order.changes),
        ...changes,
      ])
      tx.update(virtualOrders)
        .set({
          state,
          changes,
          error: null,
          result: {
            ...order.result,
            status: state,
            executedQuantity: result.executedQuantity,
            unexecutedQuantity: result.unexecutedQuantity,
          },
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, order.id))
        .run()
      // A confirmed cancellation also resolves its pending command.
      for (const command of tx
        .select()
        .from(virtualOrders)
        .where(eq(virtualOrders.accountId, order.accountId))
        .all()) {
        if (
          command.request.parentId === order.id &&
          command.request.operation === 'cancel' &&
          state === 'cancelled'
        )
          tx.update(virtualOrders)
            .set({ state: 'filled', updatedAt: new Date() })
            .where(eq(virtualOrders.id, command.id))
            .run()
      }
      audit(db, order.accountId, `order.${state}`, { orderId: order.id })
    })
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('insufficient virtual asset:')) {
      db.update(virtualOrders)
        .set({
          state: 'reconciliation_required',
          error: cause.message,
          updatedAt: new Date(),
        })
        .where(eq(virtualOrders.id, order.id))
        .run()
      if (order.state !== 'reconciliation_required' || order.error !== cause.message) {
        audit(db, order.accountId, 'order.reconciliation_required', {
          orderId: order.id,
          reason: cause.message,
        })
      }
      return
    }
    throw cause
  }
}
