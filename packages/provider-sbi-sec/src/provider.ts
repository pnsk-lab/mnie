import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  InvestmentOperations,
  InvestmentOrder,
  InvestmentOrderCancelRequest,
  InvestmentOrderChangeRequest,
  InvestmentOrderPlacement,
  InvestmentOrderPreview,
  InvestmentOrderRequest,
  InvestmentOrderRules,
  InvestmentPosition,
  InvestmentTrade,
  OperationDefinition,
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
  OrderCancelOptions,
  OrderCorrectionOptions,
} from './operations'
import { loginWithPasskey } from './session'
import type {
  Board,
  AccountType,
  CashPosition,
  IssueChart,
  IssueSearchResult,
  LoginWithPasskeyOptions,
  MarketCode,
  MarketIndex,
  MarginPosition,
  Order,
  SbiClientOptions,
  TradeRecord,
} from './types'

export type SbiSecOperations = CommonOperations &
  InvestmentOperations & {
    'market.index.major': OperationDefinition<Record<string, never>, MarketIndex[]>
    'market.issue.chart': OperationDefinition<IssueChartOptions, IssueChart>
    'market.issue.search': OperationDefinition<IssueSearchOptions, IssueSearchResult>
    'market.issue.suggest': OperationDefinition<IssueSearchOptions, IssueSearchResult>
    'market.issue.board': OperationDefinition<IssueOptions, Board>
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
  throw new Error(`${name} is not a supported SBI Securities market`)
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
): InvestmentOrderPreview => ({
  estimatedAmount: money(preview.estimatedAmount),
  warnings: [...preview.warnings, ...(preview.message ? [preview.message] : [])],
  confirmationToken: preview.confirmationId,
})

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
 * Adapts SBI Securities' transport implementation to the provider-neutral
 * financial API. SBI-specific methods deliberately remain internal here.
 */
export const createProviderFromClient = (
  client: SbiClientMethods,
): FinancialProvider<SbiSecOperations> => {
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
    capabilities: () => [
      'accounts:read',
      'balances:read',
      'transactions:read',
      'investments:read',
      'investments:trade',
    ],
    operations: () => [
      'accounts.list',
      'balances.list',
      'assets.valuation.get',
      'transactions.list',
      'history.list',
      'investments.positions.list',
      'investments.positions.get',
      'investments.orders.list',
      'investments.orders.get',
      'investments.trades.list',
      'investments.orders.preview',
      'investments.orders.create',
      'investments.orders.replace.preview',
      'investments.orders.replace',
      'investments.orders.cancel',
      'market.index.major',
      'market.issue.chart',
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
    checkOperationAvailability: async ({ operation, input }) => {
      const advertised = createProviderFromClient(client).operations() as readonly string[]
      if (!advertised.includes(operation)) {
        return {
          available: false,
          reason: 'OPERATION_UNSUPPORTED',
          message: `SBI Securities does not support ${operation}`,
        }
      }
      if (!operation.startsWith('investments.orders.')) return { available: true }
      if (operation === 'investments.orders.list' || operation === 'investments.orders.get') {
        return { available: true }
      }
      if (
        operation === 'investments.orders.replace' ||
        operation === 'investments.orders.replace.preview' ||
        operation === 'investments.orders.cancel'
      ) {
        const request = input as { orderId?: string } | undefined
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
          operation === 'investments.orders.cancel'
            ? order.cancelable !== false
            : order.correctable !== false
        return allowed
          ? { available: true }
          : {
              available: false,
              reason: 'PROVIDER_RESTRICTED',
              message:
                operation === 'investments.orders.cancel'
                  ? 'order is not cancellable'
                  : 'order is not correctable',
            }
      }
      const request = input as InvestmentOrderRequest
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
        const input = request as { accountId?: string }
        if (input.accountId && input.accountId !== currentAccount.id) return [] as never
        const power = await client.account.power.buyingPower()
        const asOf = new Date().toISOString()
        const balances: Balance[] = [
          ['buying-power', power.cashBuyingPower],
          ['withdrawable', power.withdrawableAmount],
          ['collateral', power.collateralValue],
        ].flatMap(([type, value]) => {
          const valueMoney = money(value as { currency: string; value: number | null } | undefined)
          return valueMoney
            ? [
                {
                  accountId: currentAccount.id,
                  type: type as Balance['type'],
                  amount: { kind: 'money', money: valueMoney },
                  asOf,
                },
              ]
            : []
        })
        return balances as never
      }
      if (name === 'assets.valuation.get') {
        const input = request as { accountId?: string }
        if (input.accountId && input.accountId !== currentAccount.id) {
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
        const input = request as { accountId?: string; positionType?: 'cash' | 'margin' }
        if (input.accountId && input.accountId !== currentAccount.id) return { items: [] } as never
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
          accountId?: string
          instrumentId: string
          venue: string
          positionType?: 'cash' | 'margin'
          accountType?: string
        }
        if (input.accountId && input.accountId !== currentAccount.id) {
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
          return commonPreview(preview) as never
        }
        const placement = input as InvestmentOrderPlacement
        const receipt =
          input.strategy?.kind === 'ifd'
            ? await client.orders.ifd.place({
                ...(options as IfdOrderOptions),
                confirmationId: placement.confirmationToken,
                allowTrading: true,
              })
            : await client.orders.cash.place({
                ...(options as CashOrderOptions),
                confirmationId: placement.confirmationToken,
                allowTrading: true,
              })
        return commonReceipt(input, receipt, currentAccount.id) as never
      }
      if (
        name === 'investments.orders.replace.preview' ||
        name === 'investments.orders.replace' ||
        name === 'investments.orders.cancel'
      ) {
        const input = request as InvestmentOrderChangeRequest | InvestmentOrderCancelRequest
        if (input.accountId !== currentAccount.id) throw new Error('order account was not found')
        const openOrders = await client.orders.inquiry.open({})
        const source = openOrders.orders.find(
          (order) =>
            order.id === input.orderId ||
            order.orderSubNo === input.orderId ||
            order.orderNumber === input.orderId,
        )
        if (!source) throw new Error('open order was not found')
        if (name === 'investments.orders.cancel') {
          const cancel: OrderCancelOptions = {
            orderNumber: source.orderNumber ?? source.id,
            orderId: source.orderSubNo ?? source.id,
            issueCode: source.issue.code,
            market: source.issue.market,
            tradeId: source.tradeId,
          }
          const receipt = await client.orders.cash.placeCancel({ ...cancel, allowTrading: true })
          return {
            id: source.id,
            accountId: currentAccount.id,
            instrumentId: source.issue.code,
            instrumentName: source.issue.name,
            side: source.side,
            status: receipt.accepted ? 'cancelled' : 'rejected',
            quantity: source.quantity == null ? undefined : String(source.quantity),
            orderedAt: receipt.acceptedAt ?? source.orderedAt,
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
          return commonPreview(await client.orders.cash.estimateCorrection(correction)) as never
        }
        const receipt = await client.orders.cash.placeCorrection({
          ...correction,
          allowTrading: true,
        })
        return {
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
        } as InvestmentOrder as never
      }
      if (name === 'investments.orders.get') {
        const input = request as {
          accountId?: string
          orderId: string
          instrumentId?: string
          venue: string
        }
        if (input.accountId && input.accountId !== currentAccount.id) {
          throw new Error('investment order account was not found')
        }
        const market = sbiMarket(input.venue, 'venue')
        const openOrders = await client.orders.inquiry.open({
          issueCode: input.instrumentId,
          market,
        })
        const source = openOrders.orders.find(
          (order) =>
            order.id === input.orderId ||
            order.orderSubNo === input.orderId ||
            order.orderNumber === input.orderId,
        )
        const detail = await client.orders.inquiry.detail({
          orderNumber: source?.orderNumber,
          orderId: source?.orderSubNo ?? source?.id ?? input.orderId,
          issueCode: source?.issue.code ?? input.instrumentId,
          market,
        })
        return commonOrder(detail, currentAccount.id) as never
      }
      if (name === 'investments.trades.list') {
        const input = request as { accountId?: string; venue?: string; limit?: number }
        if (input.accountId && input.accountId !== currentAccount.id) {
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
        const input = request as { accountId?: string; from?: string; status?: string; to?: string }
        if (input.accountId && input.accountId !== currentAccount.id) return { items: [] } as never
        if (input.from || input.to) {
          throw new Error("SBI Securities currently provides today's execution history only")
        }
        const executions = await client.orders.inquiry.executionsToday()
        const orders = executions.orders.map((order) => commonOrder(order, currentAccount.id))
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
            accountId: input.accountId,
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
