import { randomUUID } from 'node:crypto'
import type {
  Board,
  CashPosition,
  CashPositionList,
  ChartPeriod,
  ChartPrice,
  CurrencyAmount,
  IssueChart,
  IssueSearchResult,
  MarketCode,
  Order,
  OrderList,
  OrderPreview,
  OrderReceipt,
  SbiSession,
  SignedTextValue,
  StockOrderPreOrder,
  TradeSide,
} from '../types'
import type {
  BoardOptions,
  CashOrderOptions,
  CashOrderPreOrderOptions,
  IssueChartOptions,
  IssueOptions,
  IssueSearchOptions,
  OrderInquiryOptions,
  PlaceCashOrderOptions,
  PlaceOrderCancelOptions,
} from './types'
import { requireUsMarket } from '../markets'

const COUNTRY_US = 'US'
const DEFAULT_CHART_COUNT = 120
const US_CHART_INTERVALS: Record<ChartPeriod, Record<number, string>> = {
  minute: { 1: '1', 5: '2', 10: '3', 15: '4' },
  day: { 1: '7' },
  week: { 1: '8' },
  month: { 1: '9' },
}

export const createUsStockAdapter = (session: SbiSession) => ({
  search: async (options: IssueSearchOptions): Promise<IssueSearchResult> => {
    requireUsMarket(options.market, 'market.issue.search')
    const data = await callUsGraphql(session, 'SearchStocks', SEARCH_STOCKS, {
      input: {
        countryCode: COUNTRY_US,
        searchKeyword: options.query,
        matchType: 'CONTAINS',
        marketCode: usGraphqlMarketCode(options.market),
        page: { pageNum: 1, pageSize: options.limit ?? 20 },
      },
    })
    const stocks = arrayAt(data, ['listForeignStockSecurities', 'foreignStocks'])
    return {
      statusText: 'success',
      issues: stocks.map((stock) => {
        const securities = objectAt(stock, ['securities'])
        const market = usMarketFromGraphql(objectAt(stock, ['market']), options.market)
        return {
          code: stringAt(securities, ['securitiesCode']) ?? '',
          market,
          name:
            stringAt(securities, ['securitiesName']) ??
            stringAt(securities, ['securitiesShortName']),
        }
      }),
    }
  },
  board: async (options: IssueOptions): Promise<Board> => {
    const detail = await fetchStockDetail(session, options, 'market.issue.board')
    const quote = quoteFromDetail(detail, options)
    return {
      issue: quote.issue,
      bids: priceLevels(detail.marketPrice, 'bid', 'bidSize'),
      asks: priceLevels(detail.marketPrice, 'ask', 'askSize'),
      quote,
    }
  },
  chart: async (options: IssueChartOptions): Promise<IssueChart> => {
    requireUsMarket(options.market, 'market.issue.chart')
    const normalized = normalizedUsChartOptions(options)
    const data = await callUsRest(
      session,
      `information/chart/rics/${encodeURIComponent(usRic(options.issueCode, options.market))}/candles:listLatestCandles`,
      {
        count: String(normalized.count),
        interval: normalized.interval,
        countryCode: COUNTRY_US,
      },
      { hash: 'candle' },
    )
    const prices = arrayAt(data, ['candles'])
      .map(usChartPrice)
      .filter((price): price is ChartPrice => price != null)
      .reverse()
    const detail = await fetchStockDetail(session, options, 'market.issue.chart')
    const quote = quoteFromDetail(detail, options)
    return {
      issue: quote.issue,
      period: normalized.period,
      unit: normalized.unit,
      prices,
      previousClose: quote.previousClose,
      currentPrice: quote.price,
      highPrice: quote.high,
      lowPrice: quote.low,
      latestDateTime: prices.at(-1)?.dateTime,
    }
  },
  openOrders: async (options: IssueOptions): Promise<OrderList> => {
    requireUsMarket(options.market, 'market.issue.openOrders')
    const list = await fetchUsOrders(session, {
      issueCode: options.issueCode,
      market: options.market,
    })
    return { orders: list.orders.filter((order) => order.issue.code === options.issueCode) }
  },
  tradingInfo: async (options: BoardOptions): Promise<Board> => {
    const detail = await fetchStockDetail(session, options, 'market.issue.tradingInfo')
    const quote = quoteFromDetail(detail, options)
    return {
      issue: quote.issue,
      bids: priceLevels(detail.marketPrice, 'bid', 'bidSize'),
      asks: priceLevels(detail.marketPrice, 'ask', 'askSize'),
      quote,
    }
  },
  positions: async (): Promise<CashPositionList> => fetchUsCashPositions(session),
  unrealized: async () => {
    const positions = await fetchUsCashPositions(session)
    return {
      cash: positions.totalProfitLoss,
      total: positions.totalProfitLoss,
      totalRate: positions.totalProfitLossRate,
      error: positions.error,
    }
  },
  orders: async (options?: OrderInquiryOptions): Promise<OrderList> =>
    fetchUsOrders(session, options),
  preOrder: async (options: CashOrderPreOrderOptions): Promise<StockOrderPreOrder> => {
    requireUsMarket(options.market, 'orders.cash.preOrder')
    const data = await callUsGraphql(session, 'GetOrderCreatingInitialData', ORDER_INITIAL_DATA, {
      buySellCode: buySellCode(options.side),
      countryCode: COUNTRY_US,
      securitiesCode: options.issueCode,
      rics: [usRic(options.issueCode, options.market)],
    })
    const init = objectAt(data, ['getForeignStockCreatedOrderInitialization'])
    const securities =
      objectAt(init, ['securities']) ?? objectAt(data, ['getForeignStockSecurities', 'securities'])
    return {
      issue: {
        code: stringAt(securities, ['securitiesCode']) ?? options.issueCode,
        market: options.market,
        name:
          stringAt(securities, ['securitiesName']) ?? stringAt(securities, ['securitiesShortName']),
      },
      market: options.market,
      currentPrice: usd(
        stringAt(arrayAt(data, ['listMarketPrices', 'marketPrices'])[0], ['price', 'last']),
      ),
      priceSteps: arrayAt(init, ['tickSizes']).map((tick) => ({
        from: usd(stringAt(tick, ['tickSize'])),
      })),
      orderTerms: stringArrayAt(init, ['orderTerms']),
      orderTermDates: [],
      paymentLimits: stringArrayAt(init, ['settlementMethodCodes']).map((code) => ({ code })),
    }
  },
  estimate: async (options: CashOrderOptions): Promise<OrderPreview> => {
    requireUsMarket(options.market, 'orders.cash.estimate')
    assertUsCashOrderOptions(options, 'orders.cash.estimate')
    const orderInput = await resolveUsOrderInput(session, options, 'orders.cash.estimate')
    const data = await callUsGraphql(
      session,
      'ConfirmOrderCreating',
      CONFIRM_ORDER,
      { input: { order: orderInput } },
      { tradePassword: requireUsTradePassword(session, 'orders.cash.estimate') },
    )
    return orderPreviewFromConfirmation(data, options)
  },
  place: async (options: PlaceCashOrderOptions): Promise<OrderReceipt> => {
    requireUsMarket(options.market, 'orders.cash.place')
    if (options.allowTrading !== true) {
      throw new Error('orders.cash.place requires allowTrading: true')
    }
    assertUsCashOrderOptions(options, 'orders.cash.place')
    const orderInput = await resolveUsOrderInput(session, options, 'orders.cash.place')
    const data = await callUsGraphql(
      session,
      'SubmitOrderCreating',
      SUBMIT_ORDER,
      { input: { order: orderInput } },
      { tradePassword: requireUsTradePassword(session, 'orders.cash.place') },
    )
    const order = objectAt(data, ['createForeignStockOrder', 'order'])
    return {
      accepted: true,
      orderId: stringAt(order, ['orderNo']) ?? stringAt(order, ['orderSubNo']),
      acceptedAt: stringAt(order, ['orderInputDatetime']),
      message: stringAt(data, ['createForeignStockOrder', 'message']),
    }
  },
  placeCancel: async (options: PlaceOrderCancelOptions): Promise<OrderReceipt> => {
    if (options.allowTrading !== true) {
      throw new Error('orders.cash.placeCancel requires allowTrading: true')
    }
    throw new Error('orders.cash.placeCancel is not implemented for US stock markets')
  },
})

const fetchStockDetail = async (session: SbiSession, options: IssueOptions, methodName: string) => {
  requireUsMarket(options.market, methodName)
  const data = await callUsGraphql(session, 'GetStockDetail', STOCK_DETAIL, {
    countryCode: COUNTRY_US,
    securitiesCode: options.issueCode,
    rics: [usRic(options.issueCode, options.market)],
  })
  const stock = objectAt(data, ['getForeignStockSecurities'])
  const marketPrice = arrayAt(data, ['listMarketPrices', 'marketPrices'])[0]
  return { stock, marketPrice }
}

const fetchUsCashPositions = async (session: SbiSession): Promise<CashPositionList> => {
  const data = await callUsGraphql(session, 'GetSecuritiesBalanceList', SECURITIES_BALANCES, {
    input: { countryCode: COUNTRY_US, page: { pageNum: 1, pageSize: 999 } },
  })
  const balances = arrayAt(data, ['listSecuritiesBalances', 'securitiesBalances'])
  const positions = balances.map((balance): CashPosition => {
    const securities = objectAt(balance, ['securities'])
    const evaluation = objectAt(balance, ['evaluationProfitLoss'])
    const market = usMarketFromGraphql(objectAt(balance, ['market']))
    return {
      issue: {
        code: stringAt(securities, ['securitiesCode']) ?? '',
        market,
        name:
          stringAt(securities, ['securitiesName']) ?? stringAt(securities, ['securitiesShortName']),
      },
      accountType: mapUsSpecificAccount(stringAt(balance, ['specificAccountCode'])),
      depositType: mapUsSpecificAccount(stringAt(balance, ['specificAccountCode'])),
      quantity: numberAt(balance, ['securitiesQuantity']),
      currentPrice: usd(stringAt(balance, ['stockPrice', 'last'])),
      averagePrice: usd(stringAt(balance, ['frnAcquisitionPrice'])),
      purchasePrice: usd(stringAt(balance, ['frnAcquisitionPrice'])),
      marketValue: usd(stringAt(evaluation, ['frnEvaluationAmount'])),
      valuationPrice: usd(stringAt(evaluation, ['frnEvaluationAmount'])),
      profitLoss: signed(stringAt(evaluation, ['frnEvaluationProfitLoss'])),
      profitLossRate: percent(stringAt(evaluation, ['frnEvaluationProfitLossPercent'])),
    }
  })
  return {
    positions,
    totalCount: positions.length,
    totalMarketValue: sumAmounts(positions.map((position) => position.marketValue)),
    totalProfitLoss: sumSigned(positions.map((position) => position.profitLoss)),
  }
}

const fetchUsOrders = async (
  session: SbiSession,
  options?: OrderInquiryOptions,
): Promise<OrderList> => {
  const data = await callUsGraphql(session, 'GetOrderList', ORDER_LIST, {
    input: { countryCode: COUNTRY_US, page: { pageNum: 1, pageSize: options?.limit ?? 999 } },
  })
  const orders = arrayAt(data, ['listForeignStockOrders', 'orderDecodes']).map(orderFromGraphql)
  return {
    orders: orders.filter((order) => {
      if (options?.issueCode && order.issue.code !== options.issueCode) return false
      if (options?.market && order.issue.market !== options.market) return false
      if (options?.status && order.status !== options.status) return false
      return true
    }),
  }
}

const callUsGraphql = async (
  session: SbiSession,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  options: { tradePassword?: string } = {},
) => {
  const us = session.foreignStock
  if (!us) {
    throw new Error(
      'foreign stock session is not configured; pass foreignStockBaseUrl/usStockBaseUrl to loginWithPasskey',
    )
  }
  if (!us.sessionId || !us.accountId || us.loginAuthenticated !== true) {
    throw new Error('foreign stock session is not authenticated')
  }
  const response = await fetch(us.endpoints.graphqlIntUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${us.sessionId}`,
      'account-id': us.accountId,
      'content-type': 'application/json',
      ...(us.endpoints.userAgent ? { 'user-agent': us.endpoints.userAgent } : {}),
      ...(us.marketPriceHash ? { hash_token: us.marketPriceHash } : {}),
      ...(options.tradePassword
        ? {
            request_id: randomUUID(),
            trade_password: Buffer.from(options.tradePassword, 'utf8').toString('base64'),
          }
        : {}),
    },
    body: JSON.stringify({ operationName, query, variables }),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `foreign stock GraphQL ${operationName} failed with HTTP ${response.status}: ${text}`,
    )
  }
  const json = JSON.parse(text) as { data?: unknown; errors?: unknown }
  if (json.errors) {
    throw new Error(
      `foreign stock GraphQL ${operationName} returned errors: ${JSON.stringify(json.errors)}`,
    )
  }
  if (!json.data || typeof json.data !== 'object') {
    throw new Error(`foreign stock GraphQL ${operationName} returned no data`)
  }
  return json.data as Record<string, unknown>
}

const callUsRest = async (
  session: SbiSession,
  path: string,
  params: Record<string, string | undefined>,
  options: { hash?: 'marketPrice' | 'candle' } = {},
) => {
  const us = session.foreignStock
  if (!us) {
    throw new Error(
      'foreign stock session is not configured; pass foreignStockBaseUrl/usStockBaseUrl to loginWithPasskey',
    )
  }
  if (!us.sessionId || !us.accountId || us.loginAuthenticated !== true) {
    throw new Error('foreign stock session is not authenticated')
  }

  const url = new URL(path, us.endpoints.restUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value)
  }
  const hashToken = options.hash === 'candle' ? us.candleHash : us.marketPriceHash
  if (options.hash && !hashToken) {
    throw new Error(`foreign stock ${options.hash} hash token is not available`)
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${us.sessionId}`,
      'account-id': us.accountId,
      ...(us.endpoints.userAgent ? { 'user-agent': us.endpoints.userAgent } : {}),
      ...(hashToken ? { hash_token: hashToken } : {}),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`foreign stock REST ${path} failed with HTTP ${response.status}: ${text}`)
  }
  try {
    const json = text ? JSON.parse(text) : undefined
    if (!json || typeof json !== 'object') {
      throw new Error(`foreign stock REST ${path} returned no data`)
    }
    return json as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`foreign stock REST ${path} returned non-JSON response`)
    }
    throw error
  }
}

const quoteFromDetail = (
  detail: { stock: unknown; marketPrice: unknown },
  options: IssueOptions,
) => {
  const securities = objectAt(detail.stock, ['securities'])
  const price = objectAt(detail.marketPrice, ['price'])
  return {
    issue: {
      code: stringAt(securities, ['securitiesCode']) ?? options.issueCode,
      market: options.market,
      name:
        stringAt(securities, ['securitiesName']) ?? stringAt(securities, ['securitiesShortName']),
    },
    price: usd(stringAt(price, ['last'])),
    change: signed(stringAt(price, ['change'])),
    changeRate: percent(stringAt(price, ['changePercent'])),
    open: usd(stringAt(price, ['open'])),
    high: usd(stringAt(price, ['high'])),
    low: usd(stringAt(price, ['low'])),
    previousClose: usd(stringAt(price, ['prevClose'])),
    volume: numberAt(price, ['volume']),
    timestamp: stringAt(price, ['lastDatetime']),
  }
}

const usChartPrice = (value: unknown): ChartPrice | undefined => {
  const candle = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  if (!candle) return undefined
  const dateTime = stringAt(candle, ['startDatetime'])
  const close = usd(stringAt(candle, ['close']))
  if (!dateTime || close.value == null) return undefined
  return {
    dateTime,
    open: usd(stringAt(candle, ['open'])),
    high: usd(stringAt(candle, ['high'])),
    low: usd(stringAt(candle, ['low'])),
    close,
    volume: numberAt(candle, ['volume']),
  }
}

const priceLevels = (source: unknown, priceKey: string, quantityKey: string) => {
  const price = stringAt(source, [priceKey])
  if (price == null) return []
  return [{ price: usd(price), quantity: numberAt(source, [quantityKey]) }]
}

const orderPreviewFromConfirmation = (
  data: Record<string, unknown>,
  options: CashOrderOptions,
): OrderPreview => {
  const confirmation = objectAt(data, ['confirmForeignStockCreatedOrder'])
  const order = objectAt(confirmation, ['order'])
  return {
    issue: { code: options.issueCode, market: options.market },
    side: options.side,
    quantity: options.quantity,
    price: usd(String(options.price ?? '')),
    estimatedAmount: usd(
      stringAt(confirmation, ['estimatePrice']) ?? stringAt(order, ['frnNetAmount']),
    ),
    commission: usd(stringAt(order, ['frnCommissionAmount'])),
    tax: usd(stringAt(order, ['frnCommissionCtax'])),
    warnings: stringArrayAt(confirmation, ['warningStatuses']),
    confirmationId: stringAt(order, ['orderNo']) ?? stringAt(order, ['orderSubNo']),
  }
}

const orderFromGraphql = (value: unknown): Order => {
  const market = usMarketFromGraphql(objectAt(value, ['market']))
  const securities = objectAt(value, ['securities'])
  return {
    id: stringAt(value, ['orderNo']) ?? stringAt(value, ['orderSubNo']) ?? '',
    issue: {
      code: stringAt(securities, ['securitiesCode']) ?? '',
      market,
      name:
        stringAt(securities, ['securitiesName']) ?? stringAt(securities, ['securitiesShortName']),
    },
    side: stringAt(value, ['buySellCode']) === 'SELL' ? 'sell' : 'buy',
    status: mapOrderStatus(stringAt(value, ['orderStatus'])),
    statusText: stringAt(value, ['orderStatus']),
    quantity: numberAt(value, ['orderQuantity']),
    unexecutedQuantity: numberAt(value, ['unexecutedQuantity']),
    executedQuantity: numberAt(value, ['executionQuantity']),
    price: usd(stringAt(value, ['orderPrice'])),
    executedPrice: usd(stringAt(value, ['executionAveragePrice'])),
    orderedAt: stringAt(value, ['orderInputDatetime']),
    orderNumber: stringAt(value, ['orderNo']),
  }
}

const normalizedUsChartOptions = (options: IssueChartOptions) => {
  const period = options.period ?? 'day'
  const unit = options.unit ?? 1
  const count = options.count ?? DEFAULT_CHART_COUNT
  if (!(period in US_CHART_INTERVALS)) {
    throw new Error('period must be minute, day, week, or month')
  }
  if (!Number.isInteger(unit) || unit <= 0) {
    throw new Error('unit must be a positive integer')
  }
  const interval = US_CHART_INTERVALS[period][unit]
  if (!interval) {
    if (period === 'minute') throw new Error('minute chart unit must be 1, 5, 10, or 15')
    throw new Error('day, week, and month chart unit must be 1')
  }
  if (!Number.isInteger(count) || count <= 0 || count > 9999) {
    throw new Error('count must be an integer between 1 and 9999')
  }
  return { period, unit, count, interval }
}

const resolveUsOrderInput = async (
  session: SbiSession,
  options: CashOrderOptions | PlaceCashOrderOptions,
  methodName: string,
) => {
  const orderDate = usOrderDate(options)
  if (orderDate) return usOrderInput(options, orderDate)
  if ('orderTerm' in options && options.orderTerm === 'day') return usOrderInput(options)

  const preOrder = await createUsStockAdapter(session).preOrder({
    issueCode: options.issueCode,
    market: options.market,
    side: options.side,
  })
  const firstOrderDate = preOrder.orderTerms.find((term) => /^\d{4}-\d{2}-\d{2}$/.test(term))
  if (!firstOrderDate) {
    throw new Error(`${methodName} could not determine a valid US stock order term`)
  }
  return usOrderInput(options, firstOrderDate)
}

const usOrderInput = (options: CashOrderOptions | PlaceCashOrderOptions, orderDate?: string) => ({
  ...('allowTrading' in options ? { orderSubNo: options.confirmationId ?? '' } : {}),
  countryCode: COUNTRY_US,
  marketCode: usGraphqlMarketCode(options.market),
  securitiesCode: options.issueCode,
  buySellCode: buySellCode(options.side),
  orderQuantity: String(options.quantity),
  orderPrice: usOrderIsMarket(options) ? undefined : String(options.price),
  orderPriceKindCode: usOrderIsMarket(options) ? 'MARKET' : 'LIMIT',
  orderLimitCode: orderDate ? 'CARRY_OVER_ORDER' : 'TODAY_ORDER',
  orderTerm: orderDate,
  specificAccountCode: usSpecificAccountCode(options.accountType),
  settlementMethodCode: usSettlementMethodCode(options.foreignStockSettlementMethod),
})

const usOrderDate = (options: CashOrderOptions | PlaceCashOrderOptions) => {
  if ('orderTerm' in options && options.orderTerm === 'date') {
    if (!('orderDate' in options) || !options.orderDate) {
      throw new Error('US stock orderTerm: "date" requires orderDate')
    }
    return normalizeUsOrderDate(options.orderDate)
  }
  return undefined
}

const normalizeUsOrderDate = (value: string) => {
  const normalized = value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('US stock orderDate must be yyyy-MM-dd or yyyyMMdd')
  }
  return normalized
}

const usGraphqlMarketCode = (market: MarketCode) => {
  switch (market) {
    case 'XNAS':
      return 'US_NASDAQ'
    case 'XNYS':
      return 'US_NYSE'
    case 'ARCX':
      return 'US_ARCA'
    default:
      throw new Error(`unsupported US stock market: ${market}`)
  }
}

const usRic = (issueCode: string, market: MarketCode) => {
  switch (market) {
    case 'XNAS':
      return `${issueCode}.NB`
    case 'XNYS':
      return `${issueCode}.N`
    case 'ARCX':
      return `${issueCode}.P`
    default:
      throw new Error(`unsupported US stock market: ${market}`)
  }
}

const assertUsCashOrderOptions = (options: CashOrderOptions, methodName: string) => {
  if (options.kind === 's')
    throw new Error(`${methodName} does not support S-kabu orders for US stocks`)
  if (options.orderMethod && options.orderMethod !== 'normal') {
    throw new Error(`${methodName} does not support stop/OCO orders for US stocks`)
  }
  if (!usOrderIsMarket(options) && options.price == null) {
    throw new Error(`${methodName} requires price for non-market US stock orders`)
  }
}

const requireUsTradePassword = (session: SbiSession, methodName: string) => {
  if (!session.tradePassword) {
    throw new Error(`${methodName} requires tradePassword in loginWithPasskey options`)
  }
  return session.tradePassword
}

const usOrderIsMarket = (options: CashOrderOptions | PlaceCashOrderOptions) =>
  options.kind === 'market' || ('priceCondition' in options && options.priceCondition === 'market')

const buySellCode = (side: TradeSide) => (side === 'sell' ? 'SELL' : 'BUY')

const mapOrderStatus = (value: string | undefined): Order['status'] => {
  if (!value) return 'unknown'
  if (/EXECUT|約定/i.test(value)) return 'executed'
  if (/CANCEL|取消/i.test(value)) return 'cancelled'
  if (/REJECT|失効/i.test(value)) return 'rejected'
  return 'open'
}

const usMarketFromGraphql = (market: unknown, fallback: MarketCode = 'XNAS'): MarketCode => {
  const code = stringAt(market, ['marketCode'])
  if (code === 'NASDAQ' || code === 'XNAS') return 'XNAS'
  if (code === 'NYSE' || code === 'XNYS') return 'XNYS'
  if (code === 'NYSE_ARCA' || code === 'ARCX') return 'ARCX'
  return fallback
}

const mapUsSpecificAccount = (value: string | undefined) => {
  if (value === 'SPECIFIC' || value === 'TOKUTEI') return 'specific'
  if (value === 'GENERAL' || value === 'IPPAN') return 'general'
  if (value?.includes('NISA')) return 'nisa'
  return undefined
}

const usSpecificAccountCode = (value: CashOrderOptions['accountType']) => {
  if (value === 'specific') return 'SPECIFIC'
  if (value === 'general') return 'GENERAL'
  if (value === 'nisa' || value === 'growthInvestment') return 'NISA'
  if (!value) return undefined
  throw new Error(`US stock orders do not support accountType: ${value}`)
}

const usSettlementMethodCode = (value: CashOrderOptions['foreignStockSettlementMethod']) => {
  if (value === 'foreign') return 'FOREIGN_SETTLEMENT'
  if (value === 'yen' || !value) return 'YEN_SETTLEMENT'
  throw new Error(`US stock orders do not support foreignStockSettlementMethod: ${value}`)
}

const usd = (text: string | undefined): CurrencyAmount => ({
  value: parseNumber(text),
  text: text?.trim() ?? '',
  currency: 'USD',
})

const percent = (text: string | undefined) => ({
  value: parseNumber(text),
  text: text?.trim() ?? '',
})

const signed = (text: string | undefined): SignedTextValue => {
  const value = parseNumber(text)
  return {
    value,
    text: text?.trim() ?? '',
    sign: value == null ? undefined : value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero',
  }
}

const sumAmounts = (amounts: Array<CurrencyAmount | undefined>): CurrencyAmount | undefined => {
  const values = amounts.map((amount) => amount?.value).filter((value) => value != null)
  if (values.length === 0) return undefined
  const value = values.reduce((sum, current) => sum + current, 0)
  return { value, text: String(value), currency: 'USD' }
}

const sumSigned = (values: Array<SignedTextValue | undefined>): SignedTextValue | undefined => {
  const numbers = values.map((value) => value?.value).filter((value) => value != null)
  if (numbers.length === 0) return undefined
  const value = numbers.reduce((sum, current) => sum + current, 0)
  return {
    value,
    text: String(value),
    sign: value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero',
  }
}

const parseNumber = (text: string | undefined | null) => {
  if (text == null) return null
  const normalized = text.replace(/[,\s$%]/g, '').replace(/[()]/g, '')
  if (!normalized || normalized === '-' || normalized === '--') return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

const objectAt = (source: unknown, path: string[]): Record<string, unknown> | undefined => {
  const value = valueAt(source, path)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const arrayAt = (source: unknown, path: string[]): unknown[] => {
  const value = valueAt(source, path)
  return Array.isArray(value) ? value : []
}

const stringAt = (source: unknown, path: string[]): string | undefined => {
  const value = valueAt(source, path)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

const stringArrayAt = (source: unknown, path: string[]) =>
  arrayAt(source, path).flatMap((value) => (typeof value === 'string' ? [value] : []))

const numberAt = (source: unknown, path: string[]) => parseNumber(stringAt(source, path))

const valueAt = (source: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, source)

const SEARCH_STOCKS = `
query SearchStocks($input: Input_fstock_securities_ListForeignStockSecuritiesRequest) {
  listForeignStockSecurities(input: $input) {
    foreignStocks {
      market { marketCode marketName marketShortName timeZone }
      securities { countryCode securitiesCode securitiesName securitiesShortName ric }
      securitiesType tradeUnit openBuyRestrict openSellRestrict
    }
    page { hasNextPage }
  }
}`

const STOCK_DETAIL = `
query GetStockDetail($countryCode: common_enums_CountryEnum_Country, $securitiesCode: String, $rics: [String]) {
  getForeignStockSecurities(input: { countryCode: $countryCode securitiesCode: $securitiesCode }) {
    market { marketCode marketName marketShortName timeZone }
    securities { countryCode securitiesCode securitiesName securitiesShortName ric }
    securitiesType tradeUnit openBuyRestrict openSellRestrict
  }
  listMarketPrices(input: { countryCode: $countryCode rics: $rics }) {
    marketPrices {
      ric ask askSize bid bidSize
      price { last lastDatetime change changePercent open high low prevClose volume }
    }
  }
}`

const SECURITIES_BALANCES = `
query GetSecuritiesBalanceList($input: Input_account_balance_ListSecuritiesBalancesRequest) {
  listSecuritiesBalances(input: $input) {
    securitiesBalances {
      specificAccountCode securitiesQuantity frnAcquisitionPrice acquisitionPrice currencyCode countryCode
      securities { countryCode securitiesCode securitiesName securitiesShortName ric }
      market { marketCode marketName marketShortName timeZone }
      evaluationProfitLoss {
        frnEvaluationAmount frnEvaluationProfitLoss evaluationAmount evaluationProfitLoss evaluationProfitLossPercent frnEvaluationProfitLossPercent
      }
      stockPrice { last tickArrow }
    }
    page { hasNextPage pageNum pageSize }
  }
}`

const ORDER_INITIAL_DATA = `
query GetOrderCreatingInitialData($buySellCode: common_enums_BuySellEnum_BuySell, $countryCode: common_enums_CountryEnum_Country, $securitiesCode: String, $rics: [String]) {
  getForeignStockCreatedOrderInitialization(input: { buySellCode: $buySellCode countryCode: $countryCode securitiesCode: $securitiesCode }) {
    securities { countryCode productCode ric securitiesCode securitiesName securitiesShortName }
    market { countryCode marketCode marketName marketShortName timeZone }
    priceRangeNoLimit priceRangeLimitMin priceRangeLimitMax tickSizes { tickSize }
    specificAccountCodes settlementMethodCodes orderPriceKindCodes orderLimitCodes orderTerms
  }
  getForeignStockSecurities(input: { countryCode: $countryCode securitiesCode: $securitiesCode }) {
    currencyCode listedSecuritiesStatus tradeUnit
    market { marketCode marketName marketShortName timeZone }
    securities { countryCode productCode ric securitiesCode securitiesName securitiesShortName }
  }
  listMarketPrices(input: { countryCode: $countryCode rics: $rics }) {
    marketPrices { ask askSize bid bidSize price { last lastDatetime change changePercent } }
  }
}`

const CONFIRM_ORDER = `
query ConfirmOrderCreating($input: Input_fstock_order_ConfirmForeignStockCreatedOrderRequest) {
  confirmForeignStockCreatedOrder(input: $input) {
    buyPossibleAmount estimatePrice nisaBuyLimitAmount sellPossibleQuantity warningStatuses
    order {
      orderNo orderSubNo orderInputDatetime orderQuantity orderPrice frnNetAmount frnCommissionAmount frnCommissionCtax
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
  }
}`

const SUBMIT_ORDER = `
mutation SubmitOrderCreating($input: Input_fstock_order_CreateForeignStockOrderRequest) {
  createForeignStockOrder(input: $input) {
    order {
      orderNo orderSubNo orderInputDatetime orderQuantity orderPrice
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
    message
  }
}`

const ORDER_LIST = `
query GetOrderList($input: Input_fstock_order_ListForeignStockOrdersRequest) {
  listForeignStockOrders(input: $input) {
    orderDecodes {
      orderNo orderSubNo buySellCode orderStatus orderQuantity unexecutedQuantity executionQuantity
      orderPrice executionAveragePrice orderInputDatetime
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
    page { hasNextPage pageNum pageSize }
  }
}`
