import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from './db'
import {
  apiKeys,
  apiKeyVirtualAccounts,
  virtualAccounts,
  virtualOrders,
  physicalAccountAssets,
  virtualAccountAssets,
  physicalPositionPrices,
} from './db/schema'
import { compareDecimal, addDecimal, multiplyDecimal, financialAssetKey } from './virtual-accounts'
import {
  blockingSyncErrorsForTrade,
  formatBlockingSyncError,
  listPhysicalSyncErrors,
} from './sync-errors'

export type AccountAccess = { owner: boolean; apiKeyId?: string }
export const principalId = (access: AccountAccess) =>
  access.owner ? 'owner' : (access.apiKeyId ?? 'anonymous')

export const assertAccountTrade = (
  db: Db,
  accountId: string,
  access: AccountAccess,
  input: Record<string, unknown>,
  operation = 'investments.orders.create',
  options?: { allowVenueScopedWhenVenueOmitted?: boolean },
) => {
  const account = db.select().from(virtualAccounts).where(eq(virtualAccounts.id, accountId)).get()
  if (!account || account.kind === 'system' || account.status !== 'active')
    throw new Error('account does not allow trading')
  if (!access.owner) {
    const binding = db
      .select()
      .from(apiKeyVirtualAccounts)
      .innerJoin(apiKeys, eq(apiKeys.id, apiKeyVirtualAccounts.apiKeyId))
      .where(
        and(
          eq(apiKeyVirtualAccounts.apiKeyId, access.apiKeyId ?? ''),
          eq(apiKeyVirtualAccounts.virtualAccountId, accountId),
          eq(apiKeyVirtualAccounts.role, 'trade'),
          isNull(apiKeys.revokedAt),
        ),
      )
      .get()
    if (!binding || (binding.api_keys.expiresAt && binding.api_keys.expiresAt <= new Date()))
      throw new Error('account does not allow trading')
    if (
      binding.api_key_virtual_accounts.allowedMethods &&
      !binding.api_key_virtual_accounts.allowedMethods.includes(`account.${operation}`)
    )
      throw new Error(`API key is not allowed to call ${operation} for this account`)
    if (binding.api_keys.scopes && !binding.api_keys.scopes.includes('trade'))
      throw new Error('missing OAuth scope: trade')
  }
  if (
    db
      .select()
      .from(virtualOrders)
      .where(eq(virtualOrders.physicalAccountId, account.physicalAccountId))
      .all()
      .some((order) => ['submission_unknown', 'reconciliation_required'].includes(order.state))
  )
    throw new Error('physical account has an unresolved order')
  const policy = account.policy
  const execution = input.execution as
    | { priceType?: string; venue?: string; limitPrice?: { currency: string; value: string } }
    | undefined
  const scopedInput: Record<string, unknown> = {
    ...input,
    venue: input.instrumentVenue ?? input.venue ?? execution?.venue,
    orderType: input.orderType ?? execution?.priceType,
  }
  const syncErrors = listPhysicalSyncErrors(db, account.physicalAccountId)
  const blockingErrors = blockingSyncErrorsForTrade(syncErrors, {
    operation,
    venue: typeof scopedInput.venue === 'string' ? scopedInput.venue : undefined,
    orderId: typeof input.orderId === 'string' ? input.orderId : undefined,
    accountId,
    allowVenueScopedWhenVenueOmitted: options?.allowVenueScopedWhenVenueOmitted,
  })
  if (blockingErrors.length) throw new Error(formatBlockingSyncError(blockingErrors))
  const now = Date.now()
  const physicalAssets = db
    .select()
    .from(physicalAccountAssets)
    .where(eq(physicalAccountAssets.physicalAccountId, account.physicalAccountId))
    .all()
  if (!physicalAssets.length) throw new Error('physical account snapshot is missing')
  const staleAfterMs = typeof policy.staleAfterMs === 'number' ? policy.staleAfterMs : 5 * 60_000
  if (physicalAssets.some((asset) => now - asset.updatedAt.getTime() > staleAfterMs))
    throw new Error('physical account snapshot is stale')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dailyOrders = db
    .select()
    .from(virtualOrders)
    .where(eq(virtualOrders.accountId, accountId))
    .all()
    .filter(
      (order) => order.createdAt >= today && !order.request.parentId && order.state !== 'rejected',
    )
  if (typeof policy.maxDailyTrades === 'number' && dailyOrders.length >= policy.maxDailyTrades)
    throw new Error('account daily trade limit exceeded')

  if (policy.tradingEnabled === false) throw new Error('account trading is disabled')
  if (
    (input.positionType && input.positionType !== 'cash') ||
    (input.strategy && (input.strategy as { kind?: string }).kind !== 'single')
  )
    throw new Error('only simple cash orders are supported')
  for (const [field, allowed] of [
    ['instrumentId', 'allowedInstruments'],
    ['venue', 'allowedMarkets'],
    ['side', 'allowedSides'],
    ['orderType', 'allowedOrderTypes'],
  ] as const) {
    if (Array.isArray(policy[allowed]) && !policy[allowed].includes(scopedInput[field]))
      throw new Error(`account policy denies ${field}`)
  }
  const amount = (input.amount ?? input.price ?? execution?.limitPrice) as
    | { currency?: string; value?: string }
    | undefined
  if (
    amount?.currency &&
    Array.isArray(policy.allowedCurrencies) &&
    !policy.allowedCurrencies.includes(amount.currency)
  )
    throw new Error('account policy denies currency')
  return account
}

export const assertReservationPolicy = (
  policy: Record<string, unknown>,
  changes: import('@mnie/types').FinancialAssetChange[],
) => {
  if (typeof policy.maxOrderAmount === 'string') {
    for (const change of changes) {
      if (
        change.asset.kind === 'cash' &&
        change.availableDelta.startsWith('-') &&
        compareDecimal(change.availableDelta.slice(1), policy.maxOrderAmount) > 0
      )
        throw new Error('account order amount limit exceeded')
    }
  }
}

const allowedPolicyFields = new Set([
  'tradingEnabled',
  'allowedInstruments',
  'allowedMarkets',
  'allowedCurrencies',
  'allowedSides',
  'allowedOrderTypes',
  'maxOrderAmount',
  'maxDailyTurnover',
  'maxDailyTrades',
  'maxConcentrationPercent',
  'staleAfterMs',
  'approvalThreshold',
])
export const validateAccountPolicy = (policy: Record<string, unknown>) => {
  for (const [field, value] of Object.entries(policy)) {
    if (!allowedPolicyFields.has(field)) throw new Error(`unsupported account policy: ${field}`)
    if (value === undefined) continue
    if (field === 'tradingEnabled' && typeof value !== 'boolean')
      throw new Error('tradingEnabled must be boolean')
    if (
      field.startsWith('allowed') &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))
    )
      throw new Error(`${field} must be a list of values`)
    if (
      [
        'maxOrderAmount',
        'maxDailyTurnover',
        'maxConcentrationPercent',
        'approvalThreshold',
      ].includes(field) &&
      (typeof value !== 'string' || compareDecimal(value, '0') < 0)
    )
      throw new Error(`${field} must be a positive decimal string`)
    if (
      ['maxDailyTrades', 'staleAfterMs'].includes(field) &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    )
      throw new Error(`${field} must be a non-negative integer`)
  }
  if (
    typeof policy.maxConcentrationPercent === 'string' &&
    compareDecimal(policy.maxConcentrationPercent, '100') > 0
  )
    throw new Error('concentration limit must not exceed 100')
  if (
    ['maxOrderAmount', 'maxDailyTurnover', 'approvalThreshold'].some(
      (field) => policy[field] !== undefined,
    ) &&
    (!Array.isArray(policy.allowedCurrencies) || policy.allowedCurrencies.length !== 1)
  )
    throw new Error('金額の上限を使うには、許可する通貨を1種類指定してください')
  return policy
}

export const assertOrderRisk = (
  db: Db,
  accountId: string,
  access: AccountAccess,
  request: Record<string, unknown>,
  changes: import('@mnie/types').FinancialAssetChange[],
  operation = 'investments.orders.create',
) => {
  const account = assertAccountTrade(db, accountId, access, request, operation)
  assertReservationPolicy(account.policy, changes)
  const planned = new Map<string, string>()
  for (const change of changes) {
    if (
      compareDecimal(change.availableDelta, '0') > 0 ||
      compareDecimal(change.reservedDelta, '0') < 0 ||
      compareDecimal(change.pendingDelta, '0') !== 0 ||
      compareDecimal(addDecimal(change.availableDelta, change.reservedDelta), '0') !== 0
    )
      throw new Error('provider returned an invalid reservation plan')
    const assetKey = financialAssetKey(change.asset)
    planned.set(assetKey, addDecimal(planned.get(assetKey) ?? '0', change.reservedDelta))
  }
  const availableAssets = db
    .select()
    .from(virtualAccountAssets)
    .where(eq(virtualAccountAssets.virtualAccountId, accountId))
    .all()
  const replaced = operation.includes('replace')
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
  for (const [assetKey, amount] of planned) {
    const held =
      replaced?.changes
        .filter((change) => financialAssetKey(change.asset) === assetKey)
        .reduce((sum, change) => addDecimal(sum, change.reservedDelta), '0') ?? '0'
    const available = addDecimal(
      availableAssets.find((asset) => asset.assetKey === assetKey)?.available ?? '0',
      held,
    )
    if (compareDecimal(available, amount) < 0)
      throw new Error(`insufficient virtual asset: ${assetKey}`)
  }
  const policy = account.policy
  const amounts = changes.filter(
    (change) => change.asset.kind === 'cash' && change.availableDelta.startsWith('-'),
  )
  if (
    Array.isArray(policy.allowedCurrencies) &&
    changes.some(
      (change) =>
        change.asset.kind === 'cash' &&
        !(policy.allowedCurrencies as string[]).includes(change.asset.currency),
    )
  )
    throw new Error('account policy denies currency')
  if (
    ['maxOrderAmount', 'maxDailyTurnover', 'approvalThreshold'].some(
      (field) => policy[field] !== undefined,
    ) &&
    !amounts.length
  )
    throw new Error('provider cannot establish a bounded cash amount for this policy')
  const reserved = amounts.reduce(
    (sum, change) => addDecimal(sum, change.availableDelta.slice(1)),
    '0',
  )
  if (
    typeof policy.approvalThreshold === 'string' &&
    compareDecimal(reserved, policy.approvalThreshold) > 0 &&
    !access.owner
  )
    throw new Error('this order requires owner approval')
  if (typeof policy.maxDailyTurnover === 'string') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const orders = db
      .select()
      .from(virtualOrders)
      .where(eq(virtualOrders.accountId, accountId))
      .all()
      .filter(
        (order) =>
          order.createdAt >= today && !order.request.parentId && order.state !== 'rejected',
      )
    const total = orders.reduce(
      (sum, order) =>
        order.changes.reduce(
          (subtotal, change) =>
            change.asset.kind === 'cash' && change.availableDelta.startsWith('-')
              ? addDecimal(subtotal, change.availableDelta.slice(1))
              : subtotal,
          sum,
        ),
      reserved,
    )
    if (compareDecimal(total, policy.maxDailyTurnover) > 0)
      throw new Error('account daily turnover limit exceeded')
  }
  if (typeof policy.maxConcentrationPercent === 'string' && request.side === 'buy') {
    const assets = db
      .select()
      .from(virtualAccountAssets)
      .where(eq(virtualAccountAssets.virtualAccountId, accountId))
      .all()
    const prices = db
      .select()
      .from(physicalPositionPrices)
      .where(eq(physicalPositionPrices.physicalAccountId, account.physicalAccountId))
      .all()
    const currency = amounts[0]?.asset.kind === 'cash' ? amounts[0].asset.currency : undefined
    if (
      !currency ||
      amounts.some((change) => change.asset.kind === 'cash' && change.asset.currency !== currency)
    )
      throw new Error('concentration policy requires one valuation currency')
    let total = '0',
      current = '0'
    for (const asset of assets) {
      const quantity = addDecimal(addDecimal(asset.available, asset.reserved), asset.pending)
      let value: string
      if (asset.assetKind === 'cash') {
        if (asset.assetKey !== `cash:${currency}`)
          throw new Error('concentration policy requires explicit currency conversion')
        value = quantity
      } else {
        const price = prices.find((item) => item.assetKey === asset.assetKey)?.price
        if (!price || price.currency !== currency)
          throw new Error('concentration policy requires current prices')
        value = multiplyDecimal(quantity, price.value)
        if (asset.assetKey.split(':')[1] === request.instrumentId)
          current = addDecimal(current, value)
      }
      total = addDecimal(total, value)
    }
    if (
      compareDecimal(
        multiplyDecimal(addDecimal(current, reserved), '100'),
        multiplyDecimal(total, policy.maxConcentrationPercent),
      ) > 0
    )
      throw new Error('account concentration limit exceeded')
  }
}
