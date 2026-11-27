import type {
  Account,
  Balance,
  CommonMethods,
  FinancialAssetChange,
  FinancialAssetReference,
  FinancialOperationEffects,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  InvestmentMethods,
  InvestmentOrder,
  InvestmentOrderCancelRequest,
  InvestmentOrderChangeRequest,
  InvestmentOrderPlacement,
  InvestmentOrderPreview,
  InvestmentOrderRequest,
  InvestmentOrderRules,
  InvestmentPosition,
  InvestmentTrade,
  MethodDefinition,
  Page,
  Transaction,
} from '@mnie/types'
import type { SbiClientMethods } from './methods/types'
import type {
  CashOrderOptions,
  CashOrderPriceCondition,
  IfdOrderOptions,
  IssueChartOptions,
  IssueOptions,
  IssueSearchOptions,
  IssueTicksOptions,
  OrderCancelOptions,
  OrderCorrectionOptions,
} from './operations'
import { isUsMarket } from './markets'
import { loginWithPasskey } from './session'
import type {
  Board,
  AccountType,
  CashPosition,
  IssueChart,
  IssueSearchResult,
  IssueTickList,
  LoginWithPasskeyOptions,
  MarketCode,
  MarketIndex,
  MarginPosition,
  Order,
  SbiClientOptions,
  TradeRecord,
} from './types'

export type SbiSecOperations = CommonMethods &
  InvestmentMethods & {
    'market.index.major': MethodDefinition<Record<string, never>, MarketIndex[]>
    'market.issue.chart': MethodDefinition<IssueChartOptions, IssueChart>
    'market.issue.ticks': MethodDefinition<IssueTicksOptions, IssueTickList>
    'market.issue.search': MethodDefinition<IssueSearchOptions, IssueSearchResult>
    'market.issue.suggest': MethodDefinition<IssueSearchOptions, IssueSearchResult>
    'market.issue.board': MethodDefinition<IssueOptions, Board>
  }

const money = (value: { currency: string; value: number | null } | undefined) =>
  value?.value == null ? undefined : { currency: value.currency, value: String(value.value) }

const signedMoney = (value: { value: number | null } | undefined, currency: string | undefined) =>
  value?.value == null || !currency ? undefined : { currency, value: String(value.value) }

const finiteNumber = (value: string | undefined, name: string) => {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`)
  return parsed
}

const sbiAccountType = (value: string | undefined): AccountType | undefined => {
  if (value == null) return undefined
  if (
    value === 'general' ||
    value === 'specific' ||
    value === 'growthInvestment' ||
    value === 'nisa' ||
    value === 'juniorNisa' ||
    value === 'unknown'
  ) {
    return value
  }
  throw new Error(`SBI Securities account type is unsupported: ${value}`)
}

const sbiMarket = (value: string | undefined, name: string): MarketCode => {
  if (
    value === 'XTKS' ||
    value === 'XNGO' ||
    value === 'XFKA' ||
    value === 'XSAP' ||
    value === 'STK' ||
    value === 'XNAS' ||
    value === 'XNYS' ||
    value === 'ARCX'
  ) {
    return value
  }
  throw new Error(`${name} is not a supported SBI Securities market: ${JSON.stringify(value)}`)
}

const priceCondition = (request: InvestmentOrderRequest): CashOrderPriceCondition => {
  const priceType = request.execution?.priceType ?? 'market'
  if (request.execution?.timing === 'opening') {
    return priceType === 'limit' ? 'limitAtOpen' : 'marketAtOpen'
  }
  return priceType
}

const cashOrderInput = (request: InvestmentOrderRequest): CashOrderOptions => {
  if (request.amount) throw new Error('SBI Securities does not support amount-specified orders')
  const market = sbiMarket(request.execution?.venue, 'execution.venue')
  if (request.settlementMethod && !isUsMarket(market)) {
    throw new Error('settlementMethod is supported only for US stock orders')
  }
  const quantity = finiteNumber(request.quantity, 'quantity')
  const accountType = sbiAccountType(request.accountType)
  const isSKabu = market === 'STK'
  const common = {
    issueCode: request.instrumentId,
    market,
    side: request.side,
    quantity,
    accountType,
    depositType: accountType,
    foreignStockSettlementMethod: request.settlementMethod,
  }
  if (isSKabu) {
    if (request.execution?.priceType !== 'market' || request.execution.limitPrice) {
      throw new Error('S-kabu supports market orders only')
    }
    if (request.strategy && request.strategy.kind !== 'single') {
      throw new Error('S-kabu does not support conditional order strategies')
    }
    if (
      request.execution.timeInForce &&
      request.execution.timeInForce !== 'session' &&
      request.execution.timeInForce !== 'day'
    ) {
      throw new Error('S-kabu does not support the requested time in force')
    }
    if (request.execution.expiresOn) {
      throw new Error('S-kabu does not support an expiration date')
    }
    return {
      ...common,
      kind: 's',
      preOrderMarket: sbiMarket(request.instrumentVenue, 'instrumentVenue'),
    }
  }
  const limitPrice = request.execution?.limitPrice
  if (request.execution?.priceType === 'limit' && !limitPrice) {
    throw new Error('limit orders require execution.limitPrice')
  }
  const strategy = request.strategy
  const orderMethod =
    strategy?.kind === 'stop' ? 'stop' : strategy?.kind === 'oco' ? 'oco' : 'normal'
  return {
    ...common,
    kind: request.execution?.priceType === 'limit' ? 'limit' : 'market',
    priceCondition: priceCondition(request),
    price: limitPrice ? finiteNumber(limitPrice.value, 'execution.limitPrice.value') : undefined,
    orderTerm:
      request.execution?.timeInForce === 'session' ? 'day' : request.execution?.timeInForce,
    orderDate: request.execution?.expiresOn,
    orderMethod,
    triggerZone:
      strategy?.kind === 'stop' || strategy?.kind === 'oco'
        ? strategy.trigger.condition === 'at-or-above'
          ? 'above'
          : 'below'
        : undefined,
    triggerPrice:
      strategy?.kind === 'stop' || strategy?.kind === 'oco'
        ? finiteNumber(strategy.trigger.price.value, 'strategy.trigger.price.value')
        : undefined,
    secondaryPriceCondition:
      strategy?.kind === 'oco'
        ? strategy.alternative.priceType === 'limit'
          ? 'limit'
          : 'market'
        : undefined,
    secondaryPrice:
      strategy?.kind === 'oco' && strategy.alternative.limitPrice
        ? finiteNumber(
            strategy.alternative.limitPrice.value,
            'strategy.alternative.limitPrice.value',
          )
        : undefined,
  }
}

const ifdOrderInput = (request: InvestmentOrderRequest): IfdOrderOptions => {
  const base = cashOrderInput({ ...request, strategy: { kind: 'single' } })
  if (base.kind === 's') throw new Error('S-kabu does not support IFD orders')
  if (request.strategy?.kind !== 'ifd') throw new Error('IFD strategy is required')
  return {
    ...base,
    ifdPriceCondition: request.strategy.exit.priceType,
    ifdPrice: request.strategy.exit.limitPrice
      ? finiteNumber(request.strategy.exit.limitPrice.value, 'strategy.exit.limitPrice.value')
      : undefined,
  }
}

const commonPreview = (
  preview: Awaited<ReturnType<SbiClientMethods['orders']['cash']['estimate']>>,
  request: InvestmentOrderRequest,
): InvestmentOrderPreview => {
  const heldAmount = money(preview.heldAmount) ?? money(preview.estimatedAmount)
  return {
    estimatedAmount: money(preview.estimatedAmount),
    tradeAmount: money(preview.tradeAmount),
    heldAmount,
    settlementCurrency: preview.settlementCurrency,
    quantity: preview.quantity == null ? undefined : String(preview.quantity),
    price: money(preview.price),
    warnings: [...preview.warnings, ...(preview.message ? [preview.message] : [])],
    confirmationToken: preview.confirmationId,
    projectedAssetChanges: orderReservationChanges(request, heldAmount),
  }
}

const orderReservationChanges = (
  request: InvestmentOrderRequest,
  heldAmount?: { currency: string; value: string },
): FinancialAssetChange[] => {
  if (request.side === 'buy') {
    if (!heldAmount) throw new Error('provider did not return the settlement order amount')
    return [
      {
        asset: { kind: 'cash', currency: heldAmount.currency },
        availableDelta: `-${heldAmount.value}`,
        reservedDelta: heldAmount.value,
        pendingDelta: '0',
      },
    ]
  }
  if (!request.quantity) throw new Error('sell order quantity is required')
  const venue = request.instrumentVenue ?? request.execution?.venue
  if (!venue) throw new Error('sell order venue is required')
  return [
    {
      asset: {
        kind: 'security',
        instrumentId: request.instrumentId,
        venue,
        positionType: 'cash',
        ...(request.accountType ? { accountType: request.accountType } : {}),
      },
      availableDelta: `-${request.quantity}`,
      reservedDelta: request.quantity,
      pendingDelta: '0',
    },
  ]
}

const commonReceipt = (
  request: InvestmentOrderRequest,
  receipt: Awaited<ReturnType<SbiClientMethods['orders']['cash']['place']>>,
  accountId: string,
): InvestmentOrder => ({
  id: String(receipt.orderId ?? ''),
  accountId,
  instrumentId: request.instrumentId,
  side: request.side,
  status: receipt.accepted ? 'open' : 'rejected',
  quantity: request.quantity,
  price: request.execution?.limitPrice,
  orderedAt: receipt.acceptedAt,
})

const baseOrderRules: InvestmentOrderRules = {
  sizing: [{ kind: 'quantity', minimum: '1', increment: '1' }],
  priceTypes: ['market', 'limit'],
  timings: ['realtime', 'opening'],
  timeInForce: ['day', 'week', 'date'],
  accountTypes: ['specific', 'general', 'growthInvestment', 'nisa'],
  supportsCorrection: true,
  supportsCancellation: true,
}

const orderRules = (
  preOrder: Awaited<ReturnType<SbiClientMethods['orders']['cash']['preOrder']>>,
  request: InvestmentOrderRequest,
): InvestmentOrderRules => {
  const isSKabu = request.execution?.venue === 'STK'
  return {
    sizing: [
      {
        kind: 'quantity',
        minimum: isSKabu ? '1' : String(preOrder.lotSize ?? 1),
        increment: isSKabu ? '1' : String(preOrder.lotSize ?? 1),
        boardLot: preOrder.lotSize == null ? undefined : String(preOrder.lotSize),
      },
    ],
    priceTypes: isSKabu ? ['market'] : ['market', 'limit'],
    timings: isSKabu ? ['realtime'] : ['realtime', 'opening'],
    venues: [preOrder.market, request.execution?.venue].filter((value): value is string =>
      Boolean(value),
    ),
    timeInForce: ['day', 'week', 'date'],
    expirationDates: preOrder.orderTermDates,
    accountTypes: ['specific', 'general', 'growthInvestment', 'nisa'],
    priceIncrements: preOrder.priceSteps.flatMap((step) => {
      const increment = money(step.to)
      if (!increment) return []
      const upTo = money(step.from)
      return [{ increment, ...(upTo ? { upTo } : {}) }]
    }),
    supportsCorrection: !isSKabu,
    supportsCancellation: true,
    notices: [preOrder.deficitMessage, preOrder.nonSpecificTradeText].filter(
      (value): value is string => Boolean(value),
    ),
  }
}

const commonOrder = (order: Order, accountId: string): InvestmentOrder => ({
  id: order.id,
  accountId,
  instrumentId: order.issue.code,
  instrumentName: order.issue.name,
  venue: order.issue.market,
  accountType: order.accountType,
  side: order.side,
  status: order.status,
  quantity: order.quantity == null ? undefined : String(order.quantity),
  unexecutedQuantity:
    order.unexecutedQuantity == null ? undefined : String(order.unexecutedQuantity),
  executedQuantity: order.executedQuantity == null ? undefined : String(order.executedQuantity),
  price: money(order.executedPrice ?? order.price),
  orderedAt: order.orderedAt,
  expiresAt: order.expiresAt,
  statusText: order.statusText,
  cancelable: order.cancelable,
  correctable: order.correctable,
  settlementCurrency: order.settlementCurrency,
  accountInformation: order.accountInformation,
})

const commonCashPosition = (position: CashPosition, accountId: string): InvestmentPosition => ({
  id: `cash:${position.issue.code}:${position.issue.market ?? ''}:${position.accountType ?? ''}`,
  accountId,
  instrumentId: position.issue.code,
  instrumentName: position.issue.name,
  venue: position.issue.market,
  quantity: String(position.quantity ?? 0),
  availableQuantity:
    position.availableQuantity == null ? undefined : String(position.availableQuantity),
  positionType: 'cash',
  lotType: position.quantity == null ? undefined : position.quantity >= 100 ? 'standard' : 'oddLot',
  accountType: position.accountType,
  averagePrice: money(position.averagePrice ?? position.purchasePrice),
  currentPrice: money(position.currentPrice),
  marketValue: money(position.marketValue),
  unrealizedProfitLoss: signedMoney(position.profitLoss, position.marketValue?.currency),
  unrealizedProfitLossRate:
    position.profitLossRate?.value == null ? undefined : String(position.profitLossRate.value),
  accountInformation: position.accountInformation,
})

const commonMarginPosition = (position: MarginPosition, accountId: string): InvestmentPosition => ({
  id: position.id ?? `margin:${position.issue.code}:${position.side}`,
  accountId,
  instrumentId: position.issue.code,
  instrumentName: position.issue.name,
  venue: position.issue.market,
  quantity: String(position.quantity ?? 0),
  availableQuantity:
    position.availableCloseQuantity == null ? undefined : String(position.availableCloseQuantity),
  positionType: 'margin',
  side: position.side === 'buy' ? 'long' : 'short',
  accountType: position.accountType,
  averagePrice: money(position.openPrice),
  currentPrice: money(position.currentPrice),
  marketValue: money(position.marketValue),
  unrealizedProfitLoss: signedMoney(position.profitLoss, position.marketValue?.currency),
  unrealizedProfitLossRate:
    position.profitLossRate?.value == null ? undefined : String(position.profitLossRate.value),
})

const commonTrade = (record: TradeRecord, accountId: string): InvestmentTrade => ({
  id: record.id,
  accountId,
  instrumentId: record.issue.code,
  instrumentName: record.issue.name,
  venue: record.issue.market,
  type: record.tradeRecordTypeCode,
  quantity: record.quantity == null ? undefined : String(record.quantity),
  price: money(record.price),
  amount: money(record.amount),
  tradeDate: record.tradeDate,
  valueDate: record.valueDate,
  accountType: record.accountType,
  settlementCurrency: record.settlementCurrencyCode,
})

/**
 * Computes the cumulative asset effects attributable to a broker order.
 * Returns undefined when the reserved or settled amounts cannot be derived
 * exactly (for example, an unexecuted market buy has no bounded reservation),
 * so callers must not fall back to estimates.
 */
const orderEffects = (order: Order): FinancialOperationEffects | undefined => {
  if (!order.id) return undefined
  const executed = order.executedQuantity ?? 0
  // Terminal orders keep only their settled part; any remaining quantity is released.
  const terminal =
    order.status === 'executed' ||
    order.status === 'cancelled' ||
    order.status === 'expired' ||
    order.status === 'rejected'
  const unexecuted = terminal
    ? 0
    : (order.unexecutedQuantity ?? Math.max((order.quantity ?? 0) - executed, 0))
  const security: FinancialAssetReference = {
    kind: 'security',
    instrumentId: order.issue.code,
    venue: order.issue.market ?? '',
    positionType: 'cash',
    ...(order.accountType ? { accountType: order.accountType } : {}),
  }
  const changes: FinancialAssetChange[] = []
  if (order.settlementCurrency) {
    // Settlement-currency path (foreign securities). Only amounts the broker
    // itself reported may move the ledger: an open partial fill has no
    // attributable remaining hold, so the effects stay unaccountable.
    const cash: FinancialAssetReference = {
      kind: 'cash',
      currency: order.settlementCurrency,
    }
    if (executed > 0 && unexecuted > 0) return undefined
    if (order.side === 'buy') {
      const reserved = unexecuted > 0 ? order.heldAmount?.value : 0
      const spent = executed > 0 ? order.settledAmount?.value : 0
      if (reserved == null || spent == null) return undefined
      if (reserved + spent > 0)
        changes.push({
          asset: cash,
          availableDelta: `-${reserved + spent}`,
          reservedDelta: String(reserved),
          pendingDelta: '0',
        })
      if (executed > 0)
        changes.push({
          asset: security,
          availableDelta: String(executed),
          reservedDelta: '0',
          pendingDelta: '0',
        })
      return { referenceId: order.id, changes }
    }
    const total = executed + unexecuted
    if (total > 0)
      changes.push({
        asset: security,
        availableDelta: `-${total}`,
        reservedDelta: String(unexecuted),
        pendingDelta: '0',
      })
    if (executed > 0) {
      const settled = order.settledAmount?.value
      if (settled == null) return undefined
      changes.push({
        asset: cash,
        availableDelta: String(settled),
        reservedDelta: '0',
        pendingDelta: '0',
      })
    }
    return { referenceId: order.id, changes }
  }
  const fees = (order.commission?.value ?? 0) + (order.tax?.value ?? 0)
  const cash: FinancialAssetReference = { kind: 'cash', currency: 'JPY' }
  if (order.side === 'buy') {
    const reserved =
      unexecuted > 0 ? (order.price?.value == null ? undefined : unexecuted * order.price.value) : 0
    const spent =
      executed > 0
        ? order.executedPrice?.value == null
          ? undefined
          : executed * order.executedPrice.value + fees
        : 0
    if (reserved === undefined || spent === undefined) return undefined
    if (reserved + spent > 0)
      changes.push({
        asset: cash,
        availableDelta: `-${reserved + spent}`,
        reservedDelta: String(reserved),
        pendingDelta: '0',
      })
    if (executed > 0)
      changes.push({
        asset: security,
        availableDelta: String(executed),
        reservedDelta: '0',
        pendingDelta: '0',
      })
    return { referenceId: order.id, changes }
  }
  const total = executed + unexecuted
  if (total > 0)
    changes.push({
      asset: security,
      availableDelta: `-${total}`,
      reservedDelta: String(unexecuted),
      pendingDelta: '0',
    })
  if (executed > 0 && order.executedPrice?.value != null)
    changes.push({
      asset: cash,
      availableDelta: String(executed * order.executedPrice.value - fees),
      reservedDelta: '0',
      pendingDelta: '0',
    })
  return { referenceId: order.id, changes }
}

/** Copies today's execution price and fees onto a matching order row. */
const mergeExecutionDetails = (order: Order, execution?: Order): Order =>
  execution
    ? {
        ...order,
        executedPrice: order.executedPrice ?? execution.executedPrice,
        commission: order.commission ?? execution.commission,
        tax: order.tax ?? execution.tax,
        daytradeTotal: order.daytradeTotal ?? execution.daytradeTotal,
      }
    : order

const withOrderEffects = (order: InvestmentOrder, source: Order): InvestmentOrder => {
  const effects = orderEffects(source)
  return effects ? { ...order, effects } : order
}

const matchesOrderId = (order: Order, orderId: string) =>
  order.id === orderId || order.orderSubNo === orderId || order.orderNumber === orderId

/**
 * Adapts SBI Securities' transport implementation to the provider-neutral
 * financial API. SBI-specific methods deliberately remain internal here.
 */
export const createProviderFromClient = (
  client: SbiClientMethods,
): FinancialProvider<SbiSecOperations> => {
  const projectedChanges = new Map<string, FinancialAssetChange[]>()
  const profile = client.session.profile
  const account = async (): Promise<Account> => {
    const value = await profile()
    const number = value.accountNumber ?? value.userId ?? 'primary'
    return {
      id: number,
      providerId: 'sbi-sec',
      kind: 'brokerage',
      name: 'SBI Securities brokerage account',
      ...(value.accountNumber ? { maskedNumber: `***${value.accountNumber.slice(-4)}` } : {}),
    }
  }
  return {
    descriptor: { id: 'sbi-sec', name: 'SBI Securities' },
    accountId: 'primary',
    accountIsolation: {
      physicalCashIncludesReservations: true,
      stableOrderReferences: true,
      attributableSettlementEffects: true,
      completeOpenOrderSnapshot: true,
    },
    transactionObservationPolicy: {
      accountKind: 'brokerage',
      institutionId: 'sbi-sec',
      timePrecision: 'instant',
      identity: { kind: 'stable-provider-id' },
    },
    capabilities: () => [
      'accounts:read',
      'balances:read',
      'transactions:read',
      'investments:read',
      'investments:trade',
    ],
    methods: () => [
      'accounts.list',
      'balances.list',
      'assets.valuation.get',
      'transactions.list',
      'history.list',
      'investments.positions.list',
      'investments.positions.get',
      'investments.orders.list',
      'investments.orders.get',
      'investments.orders.open',
      'investments.trades.list',
      'investments.orders.preview',
      'investments.orders.create',
      'investments.orders.replace.preview',
      'investments.orders.replace',
      'investments.orders.cancel',
      'market.index.major',
      'market.issue.chart',
      'market.issue.ticks',
      'market.issue.search',
      'market.issue.suggest',
      'market.issue.board',
    ],
    checkAvailability: async () => {
      try {
        await client.account.assets.current()
        return { ok: true }
      } catch (message) {
        return { ok: false, message, reason: 'UNKNOWN' }
      }
    },
    checkMethodAvailability: async ({ method, params }) => {
      const advertised = createProviderFromClient(client).methods() as readonly string[]
      if (!advertised.includes(method)) {
        return {
          available: false,
          reason: 'OPERATION_UNSUPPORTED',
          message: `SBI Securities does not support ${method}`,
        }
      }
      if (!method.startsWith('investments.orders.')) return { available: true }
      if (
        method === 'investments.orders.list' ||
        method === 'investments.orders.get' ||
        method === 'investments.orders.open'
      ) {
        return { available: true }
      }
      if (
        (method === 'investments.orders.preview' || method === 'investments.orders.create') &&
        (!params || typeof params !== 'object')
      ) {
        return { available: true, orderRules: baseOrderRules }
      }
      if (
        method === 'investments.orders.replace' ||
        method === 'investments.orders.replace.preview' ||
        method === 'investments.orders.cancel'
      ) {
        const request = params as { orderId?: string } | undefined
        if (!request?.orderId) {
          return {
            available: false,
            reason: 'PROVIDER_RESTRICTED',
            message: 'orderId is required',
          }
        }
        const open = await client.orders.inquiry.open({})
        const order = open.orders.find(
          (candidate) =>
            candidate.id === request.orderId ||
            candidate.orderSubNo === request.orderId ||
            candidate.orderNumber === request.orderId,
        )
        if (!order) {
          return {
            available: false,
            reason: 'PROVIDER_RESTRICTED',
            message: 'open order was not found',
          }
        }
        const allowed =
          method === 'investments.orders.cancel'
            ? order.cancelable !== false
            : order.correctable !== false
        return allowed
          ? { available: true }
          : {
              available: false,
              reason: 'PROVIDER_RESTRICTED',
              message:
                method === 'investments.orders.cancel'
                  ? 'order is not cancellable'
                  : 'order is not correctable',
            }
      }
      const request = params as InvestmentOrderRequest
      try {
        const options = cashOrderInput(request)
        const preOrder = await client.orders.cash.preOrder({
          issueCode: options.issueCode,
          market: options.market,
          side: options.side,
          accountType: options.accountType,
          depositType: options.depositType,
          ...(options.kind === 's'
            ? { kind: 's' as const, preOrderMarket: options.preOrderMarket }
            : {}),
        })
        if (options.kind === 's' && preOrder.sKabu?.available !== true) {
          return {
            available: false,
            reason: 'INSTRUMENT_UNSUPPORTED',
            message: 'S-kabu is unavailable for this instrument',
          }
        }
        return { available: true, orderRules: orderRules(preOrder, request) }
      } catch (message) {
        return { available: false, reason: 'PROVIDER_RESTRICTED', message }
      }
    },
    invoke: async (name, request) => {
      if (name === 'market.index.major') return (await client.market.index.major()) as never
      if (name === 'market.issue.chart') {
        return (await client.market.issue.chart(request as IssueChartOptions)) as never
      }
      if (name === 'market.issue.ticks') {
        return (await client.market.issue.ticks(request as IssueTicksOptions)) as never
      }
      if (name === 'market.issue.search') {
        return (await client.market.issue.search(request as IssueSearchOptions)) as never
      }
      if (name === 'market.issue.suggest') {
        return (await client.market.issue.suggest(request as IssueSearchOptions)) as never
      }
      if (name === 'market.issue.board') {
        return (await client.market.issue.board(request as IssueOptions)) as never
      }
      if (name === 'accounts.list') return { items: [await account()] } as Page<Account> as never
      const currentAccount = await account()
      if (name === 'balances.list') {
        const input = request as { account?: string }
        if (input.account && input.account !== currentAccount.id) return [] as never
        const [power, assets] = await Promise.all([
          client.account.power.buyingPower(),
          client.account.assets.current(),
        ])
        const asOf = new Date().toISOString()
        // The domestic deposit total still contains cash reserved by open orders,
        // so it is the only figure safe to use as the physical cash balance.
        const domesticDeposit = assets.summaryDetails?.find(
          (detail) => detail.category === 'DOMESTIC_DEPOSIT',
        )?.valuation
        const balances: Balance[] =
          domesticDeposit == null
            ? []
            : [
                {
                  accountId: currentAccount.id,
                  type: 'current',
                  amount: {
                    kind: 'money',
                    money: { currency: 'JPY', value: String(domesticDeposit) },
                  },
                  asOf,
                } satisfies Balance,
              ]
        const powerEntries: [
          Balance['type'],
          { currency: string; value: number | null } | undefined,
        ][] = [
          ['buying-power', power.cashBuyingPower],
          ['withdrawable', power.withdrawableAmount],
          ['collateral', power.collateralValue],
        ]
        for (const [type, value] of powerEntries) {
          const valueMoney = money(value)
          if (valueMoney)
            balances.push({
              accountId: currentAccount.id,
              type,
              amount: { kind: 'money', money: valueMoney },
              asOf,
            })
        }
        return balances as never
      }
      if (name === 'assets.valuation.get') {
        const input = request as { account?: string }
        if (input.account && input.account !== currentAccount.id) {
          throw new Error('asset valuation account was not found')
        }
        const assets = await client.account.assets.current()
        const valuation = assets.summary?.valuation
        if (valuation == null) throw new Error('SBI Securities did not return an asset valuation')
        const holdings = assets.summaryWithoutDeposit?.valuation
        return {
          amount: { currency: 'JPY', value: String(valuation) },
          asOf: new Date().toISOString(),
          ...(holdings == null
            ? {}
            : { holdingsAmount: { currency: 'JPY', value: String(holdings) } }),
          ...(holdings == null
            ? {}
            : {
                cashAmount: { currency: 'JPY', value: String(Math.max(valuation - holdings, 0)) },
              }),
        } as never
      }
      if (name === 'investments.positions.list') {
        const input = request as { account?: string; positionType?: 'cash' | 'margin' }
        if (input.account && input.account !== currentAccount.id) return { items: [] } as never
        const positionType = input.positionType
        const [cash, margin] = await Promise.all([
          positionType === 'margin' ? Promise.resolve(undefined) : client.account.positions.cash(),
          positionType === 'cash' ? Promise.resolve(undefined) : client.account.positions.margin(),
        ])
        const positions: InvestmentPosition[] = [
          ...(cash?.positions ?? []).map((position) =>
            commonCashPosition(position, currentAccount.id),
          ),
          ...(margin?.positions ?? []).map((position) =>
            commonMarginPosition(position, currentAccount.id),
          ),
        ]
        return { items: positions } as Page<InvestmentPosition> as never
      }
      if (name === 'investments.positions.get') {
        const input = request as {
          account?: string
          instrumentId: string
          venue: string
          positionType?: 'cash' | 'margin'
          accountType?: string
        }
        if (input.account && input.account !== currentAccount.id) {
          throw new Error('investment position account was not found')
        }
        if (input.positionType === 'margin') {
          const value = await client.account.positions.marginDetail({
            issueCode: input.instrumentId,
            market: sbiMarket(input.venue, 'venue'),
            accountType: sbiAccountType(input.accountType),
          })
          const position = value.positions[0]
          if (!position) throw new Error('investment position was not found')
          return commonMarginPosition(position, currentAccount.id) as never
        }
        const value = await client.account.positions.cashDetail({
          issueCode: input.instrumentId,
          market: sbiMarket(input.venue, 'venue'),
          accountType: sbiAccountType(input.accountType),
          limit: 1,
        })
        const position = value.positions[0]
        if (!position) throw new Error('investment position was not found')
        return commonCashPosition(position, currentAccount.id) as never
      }
      if (name === 'investments.orders.preview' || name === 'investments.orders.create') {
        const input = request as InvestmentOrderRequest | InvestmentOrderPlacement
        const options =
          input.strategy?.kind === 'ifd' ? ifdOrderInput(input) : cashOrderInput(input)
        if (name === 'investments.orders.preview') {
          const preview =
            input.strategy?.kind === 'ifd'
              ? await client.orders.ifd.estimate(options as IfdOrderOptions)
              : await client.orders.cash.estimate(options as CashOrderOptions)
          const result = commonPreview(preview, input)
          if (result.confirmationToken && result.projectedAssetChanges) {
            projectedChanges.set(result.confirmationToken, result.projectedAssetChanges)
          }
          return result as never
        }
        const placement = input as InvestmentOrderPlacement
        // US confirmations mint a local token, never a broker orderSubNo, so
        // the token must not be forwarded into the broker submission.
        const usMarket = 'market' in options && isUsMarket(options.market)
        const receipt =
          input.strategy?.kind === 'ifd'
            ? await client.orders.ifd.place({
                ...(options as IfdOrderOptions),
                confirmationId: placement.confirmationToken,
                allowTrading: true,
              })
            : await client.orders.cash.place({
                ...(options as CashOrderOptions),
                confirmationId: usMarket ? undefined : placement.confirmationToken,
                allowTrading: true,
              })
        const result = commonReceipt(input, receipt, currentAccount.id)
        if (receipt.accepted) {
          const changes = placement.confirmationToken
            ? projectedChanges.get(placement.confirmationToken)
            : undefined
          if (!changes) throw new Error('order preview asset changes are missing or expired')
          result.effects = {
            referenceId: result.id || placement.confirmationToken || '',
            changes,
          }
          projectedChanges.delete(placement.confirmationToken!)
        } else if (placement.confirmationToken) {
          projectedChanges.delete(placement.confirmationToken)
        }
        return result as never
      }
      if (
        name === 'investments.orders.replace.preview' ||
        name === 'investments.orders.replace' ||
        name === 'investments.orders.cancel'
      ) {
        const input = request as InvestmentOrderChangeRequest | InvestmentOrderCancelRequest
        if (input.account !== currentAccount.id) throw new Error('order account was not found')
        const openOrders = await client.orders.inquiry.open({})
        const source = openOrders.orders.find((order) => matchesOrderId(order, input.orderId))
        if (!source) throw new Error('open order was not found')
        const lookupOrder = async () => {
          const recent = await client.orders.inquiry.open({
            issueCode: source.issue.code,
            market: source.issue.market,
          })
          const found = recent.orders.find((order) => matchesOrderId(order, source.id))
          if (found) {
            const executions = await client.orders.inquiry
              .executionsToday({ issueCode: source.issue.code, market: source.issue.market })
              .catch(() => ({ orders: [] }))
            return mergeExecutionDetails(
              found,
              executions.orders.find((order) => matchesOrderId(order, source.id)),
            )
          }
          return undefined
        }
        if (name === 'investments.orders.cancel') {
          const cancel: OrderCancelOptions = {
            orderNumber: source.orderNumber ?? source.id,
            orderId: source.orderSubNo ?? source.id,
            issueCode: source.issue.code,
            market: source.issue.market,
            tradeId: source.tradeId,
          }
          const receipt = await client.orders.cash.placeCancel({ ...cancel, allowTrading: true })
          if (!receipt.accepted) {
            return {
              id: source.id,
              accountId: currentAccount.id,
              instrumentId: source.issue.code,
              instrumentName: source.issue.name,
              side: source.side,
              status: 'rejected',
              quantity: source.quantity == null ? undefined : String(source.quantity),
              orderedAt: source.orderedAt,
            } as InvestmentOrder as never
          }
          const refreshed = await lookupOrder()
          if (refreshed) {
            const effects = orderEffects(refreshed)
            const confirmed =
              refreshed.status === 'cancelled' &&
              (effects !== undefined || !refreshed.executedQuantity)
            return {
              ...commonOrder(refreshed, currentAccount.id),
              ...(confirmed ? { confirmed: true } : {}),
              ...(effects ? { effects } : {}),
            } as InvestmentOrder as never
          }
          return {
            id: source.id,
            accountId: currentAccount.id,
            instrumentId: source.issue.code,
            instrumentName: source.issue.name,
            side: source.side,
            status: 'cancelled',
            confirmed: true,
            quantity: source.quantity == null ? undefined : String(source.quantity),
            orderedAt: receipt.acceptedAt ?? source.orderedAt,
            effects: { referenceId: source.id, changes: [] },
          } as InvestmentOrder as never
        }
        const change = input as InvestmentOrderChangeRequest
        const correction: OrderCorrectionOptions = {
          orderNumber: source.orderNumber,
          orderId: source.orderSubNo ?? source.id,
          issueCode: source.issue.code,
          market: source.issue.market,
          tradeId: source.tradeId,
          depositTypeText: source.depositTypeText,
          quantity: change.quantity ? finiteNumber(change.quantity, 'quantity') : undefined,
          priceCondition: change.limitPrice ? 'limit' : 'market',
          price: change.limitPrice
            ? finiteNumber(change.limitPrice.value, 'limitPrice.value')
            : undefined,
        }
        if (name === 'investments.orders.replace.preview') {
          const preview = await client.orders.cash.estimateCorrection(correction)
          const projectedRequest: InvestmentOrderRequest = {
            account: currentAccount.id,
            instrumentId: source.issue.code,
            instrumentVenue: source.issue.market,
            side: source.side,
            quantity:
              change.quantity ?? (source.quantity == null ? undefined : String(source.quantity)),
            positionType: 'cash',
            accountType: source.accountType,
            execution: {
              priceType: change.limitPrice ? 'limit' : 'market',
              limitPrice: change.limitPrice,
              venue: source.issue.market,
            },
          }
          const result = commonPreview(preview, projectedRequest)
          if (result.confirmationToken && result.projectedAssetChanges) {
            projectedChanges.set(result.confirmationToken, result.projectedAssetChanges)
          }
          return result as never
        }
        const receipt = await client.orders.cash.placeCorrection({
          ...correction,
          allowTrading: true,
        })
        if (receipt.accepted) {
          const refreshed = await lookupOrder()
          if (refreshed) {
            const result = withOrderEffects(commonOrder(refreshed, currentAccount.id), refreshed)
            if (result.effects) {
              result.effects = { ...result.effects, reversesReferenceIds: [source.id] }
              if (change.confirmationToken) projectedChanges.delete(change.confirmationToken)
              return result as never
            }
            return result as never
          }
        }
        const result: InvestmentOrder = {
          id: source.id,
          accountId: currentAccount.id,
          instrumentId: source.issue.code,
          instrumentName: source.issue.name,
          side: source.side,
          status: receipt.accepted ? 'open' : 'rejected',
          quantity:
            change.quantity ?? (source.quantity == null ? undefined : String(source.quantity)),
          price: change.limitPrice,
          orderedAt: receipt.acceptedAt ?? source.orderedAt,
        }
        if (receipt.accepted) {
          const changes = change.confirmationToken
            ? projectedChanges.get(change.confirmationToken)
            : undefined
          if (!changes) throw new Error('order preview asset changes are missing or expired')
          result.effects = {
            referenceId: source.id,
            changes,
            reversesReferenceIds: [source.id],
          }
          projectedChanges.delete(change.confirmationToken!)
        }
        return result as never
      }
      if (name === 'investments.orders.open') {
        const input = request as { account?: string }
        if (input.account && input.account !== currentAccount.id) {
          return { items: [], complete: true } as never
        }
        const list = await client.orders.inquiry.open({})
        if (list.error && list.error.code !== 'ME0010') {
          throw new Error(`open order snapshot failed: ${list.error.code}`)
        }
        const executions = await client.orders.inquiry
          .executionsToday({})
          .catch(() => ({ orders: [] }))
        const items = list.orders.map((order) => {
          const hydrated = mergeExecutionDetails(
            order,
            executions.orders.find((candidate) => matchesOrderId(candidate, order.id)),
          )
          return withOrderEffects(commonOrder(hydrated, currentAccount.id), hydrated)
        })
        return {
          items,
          // The inquiry caps at 999 rows; only a shorter result proves completeness.
          complete: list.orders.length < 999,
        } as never
      }
      if (name === 'investments.orders.get') {
        const input = request as {
          account?: string
          orderId: string
          instrumentId?: string
          venue: string
        }
        if (input.account && input.account !== currentAccount.id) {
          throw new Error('investment order account was not found')
        }
        const market = sbiMarket(input.venue, 'venue')
        const openOrders = await client.orders.inquiry.open({
          issueCode: input.instrumentId,
          market,
        })
        const source = openOrders.orders.find((order) => matchesOrderId(order, input.orderId))
        if (!isUsMarket(market)) {
          const executions = await client.orders.inquiry
            .executionsToday({ issueCode: input.instrumentId, market })
            .catch(() => ({ orders: [] }))
          const execution = executions.orders.find((order) => matchesOrderId(order, input.orderId))
          const order = source ?? execution
          if (!order) throw new Error('investment order was not found')
          const hydrated = mergeExecutionDetails(order, execution)
          return withOrderEffects(commonOrder(hydrated, currentAccount.id), hydrated) as never
        }
        const detail = await client.orders.inquiry.detail({
          orderNumber: source?.orderNumber,
          orderId: source?.orderSubNo ?? source?.id ?? input.orderId,
          issueCode: source?.issue.code ?? input.instrumentId,
          market,
        })
        return withOrderEffects(commonOrder(detail, currentAccount.id), detail) as never
      }
      if (name === 'investments.trades.list') {
        const input = request as { account?: string; venue?: string; limit?: number }
        if (input.account && input.account !== currentAccount.id) {
          return { items: [] } as never
        }
        const records = await client.orders.inquiry.tradeRecords({
          limit: input.limit,
          market: input.venue ? sbiMarket(input.venue, 'venue') : undefined,
        })
        return {
          items: records.records.map((record) => commonTrade(record, currentAccount.id)),
        } as Page<InvestmentTrade> as never
      }
      if (name === 'investments.orders.list' || name === 'transactions.list') {
        const input = request as { account?: string; from?: string; status?: string; to?: string }
        if (input.account && input.account !== currentAccount.id) return { items: [] } as never
        if (input.from || input.to) {
          throw new Error("SBI Securities currently provides today's execution history only")
        }
        const executions = await client.orders.inquiry.executionsToday()
        const orders = executions.orders.map((order) =>
          withOrderEffects(commonOrder(order, currentAccount.id), order),
        )
        if (name === 'investments.orders.list') {
          return {
            items: input.status ? orders.filter((order) => order.status === input.status) : orders,
          } as Page<InvestmentOrder> as never
        }
        const transactions: Transaction[] = orders.map((order) => ({
          id: order.id,
          accountId: currentAccount.id,
          kind: 'investment-trade',
          direction: order.side === 'buy' ? 'debit' : 'credit',
          status: order.status === 'executed' ? 'posted' : 'pending',
          amount: order.price ? { kind: 'money', money: order.price } : null,
          occurredAt: order.orderedAt ?? new Date().toISOString(),
          description: `${order.side} ${order.instrumentName ?? order.instrumentId}`,
          investment: {
            instrumentId: order.instrumentId,
            side: order.side,
            quantity: order.executedQuantity ?? order.quantity,
            unitPrice: order.price,
          },
        }))
        return { items: transactions } as Page<Transaction> as never
      }
      if (name === 'history.list') {
        const input = request as HistoryListRequest
        if (input.kinds?.some((kind) => kind !== 'transaction')) {
          throw new Error('SBI Securities history.list supports transaction history only')
        }
        const [executions, yenDetails] = await Promise.all([
          createProviderFromClient(client).invoke('transactions.list', {
            account: input.account,
          }),
          client.banking.detailHistory(),
        ])
        const transactions = [...executions.items, ...yenDetails].sort((left, right) =>
          left.occurredAt.localeCompare(right.occurredAt),
        )
        return {
          items: transactions.map((transaction) => ({
            kind: 'transaction' as const,
            occurredAt: transaction.occurredAt,
            transaction,
          })),
        } as Page<HistoryItem> as never
      }
      throw new Error(`unsupported SBI Securities operation: ${name}`)
    },
    exportSession: () => client.session.export(),
    close: async () => {},
  }
}

/** Authenticates with an SBI passkey and returns the provider-neutral API. */
export const connectWithPasskey = async (
  options: LoginWithPasskeyOptions,
  clientOptions: SbiClientOptions = {},
): Promise<FinancialProvider<SbiSecOperations>> =>
  createProviderFromClient(await loginWithPasskey(options, clientOptions))
