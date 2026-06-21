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
  TradeRecord,
  TradeRecordList,
  TradeSide,
} from '../types'
import type {
  BoardOptions,
  CashOrderOptions,
  CashOrderPreOrderOptions,
  CashPositionOptions,
  IssueChartOptions,
  IssueOptions,
  IssueSearchOptions,
  OrderCancelOptions,
  OrderCorrectionOptions,
  OrderDetailOptions,
  OrderInquiryOptions,
  PlaceCashOrderOptions,
  PlaceOrderCancelOptions,
  PlaceOrderCorrectionOptions,
  TradeRecordInquiryOptions,
} from './types'
import { requireUsMarket } from '../markets'

const COUNTRY_US = 'US'
const DEFAULT_CHART_COUNT = 120
const DEFAULT_US_INQUIRY_LOOKBACK_DAYS = 90
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
  positions: async (options?: CashPositionOptions): Promise<CashPositionList> =>
    fetchUsCashPositions(session, options),
  positionsDetail: async (options?: CashPositionOptions): Promise<CashPositionList> =>
    fetchUsCashPositionDetail(session, options),
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
  orderDetail: async (options: OrderDetailOptions): Promise<Order> =>
    fetchUsOrderDetail(session, options),
  tradeRecords: async (options: TradeRecordInquiryOptions): Promise<TradeRecordList> =>
    fetchUsTradeRecords(session, options),
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
  estimateCorrection: async (options: OrderCorrectionOptions): Promise<OrderPreview> => {
    requireUsOrderCorrectionOptions(options, 'orders.cash.estimateCorrection')
    const order = await resolveUsOrderForAction(session, options)
    const input = usOrderCorrectionInput(options, order)
    const market = requireUsOrderMarket(order, 'orders.cash.estimateCorrection')
    const data = await callUsGraphql(
      session,
      'GetOrderUpdatingInitialData',
      ORDER_UPDATE_INITIAL_DATA,
      {
        countryCode: COUNTRY_US,
        securitiesCode: order.issue.code,
        baseDate: undefined,
        orderSubNo: input.orderSubNo,
        rics: [usRic(order.issue.code, market)],
      },
    )
    const init = objectAt(data, ['getForeignStockUpdatedOrderInitialization'])
    const initOrder = objectAt(init, ['order'])
    return {
      issue: order.issue,
      side: order.side,
      quantity: numberAt(initOrder, ['orderQuantity']) ?? order.quantity ?? options.quantity,
      price: usd(stringAt(initOrder, ['orderPrice']) ?? String(options.price ?? '')),
      estimatedAmount: usd(stringAt(initOrder, ['frnNetAmount'])),
      commission: usd(stringAt(initOrder, ['frnCommissionAmount'])),
      tax: usd(stringAt(initOrder, ['frnCommissionCtax'])),
      warnings: [],
      confirmationId: input.orderSubNo,
      correction: usOrderCorrectionPreOrderFromOrder(order, init),
    }
  },
  estimateCorrectionConfirm: async (options: OrderCorrectionOptions): Promise<OrderPreview> => {
    requireUsOrderCorrectionOptions(options, 'orders.cash.estimateCorrectionConfirm')
    const order = await resolveUsOrderForAction(session, options)
    const input = usOrderCorrectionInput(options, order)
    const data = await callUsGraphql(
      session,
      'ConfirmOrderUpdating',
      CONFIRM_ORDER_UPDATE,
      { input: { order: input } },
      { tradePassword: requireUsTradePassword(session, 'orders.cash.estimateCorrectionConfirm') },
    )
    return orderUpdatePreviewFromConfirmation(data, order, options)
  },
  placeCorrection: async (options: PlaceOrderCorrectionOptions): Promise<OrderReceipt> => {
    requireUsOrderCorrectionOptions(options, 'orders.cash.placeCorrection')
    if (options.allowTrading !== true) {
      throw new Error('orders.cash.placeCorrection requires allowTrading: true')
    }
    const order = await resolveUsOrderForAction(session, options)
    const input = usOrderCorrectionInput(options, order)
    const data = await callUsGraphql(
      session,
      'SubmitOrderUpdating',
      SUBMIT_ORDER_UPDATE,
      { input: { order: input } },
      { tradePassword: requireUsTradePassword(session, 'orders.cash.placeCorrection') },
    )
    const updatedOrder = objectAt(data, ['updateForeignStockOrder', 'order'])
    return orderReceiptFromUsOrder(updatedOrder, 'updateForeignStockOrder')
  },
  estimateCancel: async (options: OrderCancelOptions): Promise<OrderPreview> => {
    const order = await resolveUsOrderForAction(session, options)
    const orderSubNo = requireUsOrderSubNo(order, options, 'orders.cash.estimateCancel')
    await callUsGraphql(session, 'ConfirmCancelOrderInitialization', CONFIRM_CANCEL_ORDER, {
      input: { orderSubNo },
    })
    return {
      issue: order.issue,
      side: order.side,
      quantity: order.unexecutedQuantity ?? order.quantity ?? undefined,
      price: order.price,
      estimatedAmount: usd(stringAt(order, ['frnNetAmount'])),
      commission: usd(''),
      tax: usd(''),
      warnings: [],
      confirmationId: orderSubNo,
      correction: usOrderCorrectionPreOrderFromOrder(order),
    }
  },
  placeCancel: async (options: PlaceOrderCancelOptions): Promise<OrderReceipt> => {
    if (options.allowTrading !== true) {
      throw new Error('orders.cash.placeCancel requires allowTrading: true')
    }
    const order = await resolveUsOrderForAction(session, options)
    const orderSubNo = requireUsOrderSubNo(order, options, 'orders.cash.placeCancel')
    await callUsGraphql(session, 'ConfirmCancelOrderInitialization', CONFIRM_CANCEL_ORDER, {
      input: { orderSubNo },
    })
    const data = await callUsGraphql(
      session,
      'SubmitOrderCancelling',
      SUBMIT_ORDER_CANCEL,
      { input: { orderSubNo } },
      {
        tradePassword:
          options.tradePassword ?? requireUsTradePassword(session, 'orders.cash.placeCancel'),
      },
    )
    const deletedOrder = objectAt(data, ['deleteForeignStockOrder', 'order'])
    return orderReceiptFromUsOrder(deletedOrder, 'deleteForeignStockOrder')
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

const fetchUsCashPositions = async (
  session: SbiSession,
  options?: CashPositionOptions,
): Promise<CashPositionList> => {
  const data = await callUsGraphql(session, 'GetSecuritiesBalanceList', SECURITIES_BALANCES, {
    input: { countryCode: COUNTRY_US, page: { pageNum: 1, pageSize: 999 } },
  })
  const balances = arrayAt(data, ['listSecuritiesBalances', 'securitiesBalances'])
  const positions = balances
    .map((balance) => cashPositionFromUsBalance(balance))
    .filter((position) => {
      if (options?.issueCode && position.issue.code !== options.issueCode) return false
      if (options?.market && position.issue.market !== options.market) return false
      if (options?.accountType && position.accountType !== options.accountType) return false
      return true
    })
  const limited = limitList(positions, options)
  return {
    positions: limited,
    totalCount: positions.length,
    totalMarketValue: sumAmounts(limited.map((position) => position.marketValue)),
    totalProfitLoss: sumSigned(limited.map((position) => position.profitLoss)),
  }
}

const fetchUsCashPositionDetail = async (
  session: SbiSession,
  options?: CashPositionOptions,
): Promise<CashPositionList> => {
  if (options?.market) requireUsMarket(options.market, 'account.positions.cashDetail')
  if (!options?.issueCode) {
    throw new Error('account.positions.cashDetail requires issueCode for US stock positions')
  }

  const baseList = await fetchUsCashPositions(session, options)
  const base = baseList.positions[0]
  if (!base) {
    throw new Error('account.positions.cashDetail could not find the requested US stock position')
  }

  const data = await callUsGraphql(
    session,
    'GetSecuritiesBalanceDetail',
    SECURITIES_BALANCE_DETAIL,
    {
      inputSecuritiesBalance: {
        productCode: 'FOREIGN_STOCK',
        countryCode: COUNTRY_US,
        currencyCode: 'USD',
        specificAccountCode: usSpecificAccountCode(base.accountType),
        securitiesCode: base.issue.code,
      },
      inputExchangeRate: { currencyPair: 'USDJPY' },
      inputStockSecurities: {
        countryCode: COUNTRY_US,
        securitiesCode: base.issue.code,
      },
    },
  )
  const balance = objectAt(data, ['getSecuritiesBalance'])
  if (!balance) {
    throw new Error('account.positions.cashDetail returned no US stock balance detail')
  }
  const position = cashPositionFromUsBalance(balance, base.issue.market)
  return {
    positions: [position],
    totalCount: 1,
    totalMarketValue: position.marketValue,
    totalProfitLoss: position.profitLoss,
  }
}

const fetchUsOrders = async (
  session: SbiSession,
  options?: OrderInquiryOptions,
): Promise<OrderList> => {
  const dateRange = usInquiryDateRange(options)
  const data = await callUsGraphql(session, 'GetOrderList', ORDER_LIST, {
    input: {
      countryCode: COUNTRY_US,
      securitiesCode: options?.issueCode,
      orderDateFrom: dateRange.from,
      orderDateTo: dateRange.to,
      orderDateType: 'ORDER_INPUT_DATE',
      page: { pageNum: options?.index ?? 1, pageSize: options?.limit ?? 999 },
    },
  })
  const orders = arrayAt(data, ['listForeignStockOrders', 'orderDecodes']).map((order) =>
    orderFromGraphql(order),
  )
  const list = objectAt(data, ['listForeignStockOrders'])
  return {
    orders: orders.filter((order) => {
      if (options?.issueCode && order.issue.code !== options.issueCode) return false
      if (options?.market && order.issue.market !== options.market) return false
      if (options?.status && order.status !== options.status) return false
      return true
    }),
    hasMore: booleanAt(list, ['page', 'hasNextPage']),
  }
}

const fetchUsOrderDetail = async (
  session: SbiSession,
  options: OrderDetailOptions,
): Promise<Order> => {
  requireUsMarket(options.market, 'orders.inquiry.detail')
  const base = await resolveUsOrderForAction(session, options)
  const orderNo = base.orderNumber ?? options.orderNumber
  if (!orderNo) throw new Error('orders.inquiry.detail requires orderNumber for US stock orders')
  const data = await callUsGraphql(session, 'GetOrderDetail', ORDER_DETAIL, {
    input: { orderNo },
    inputStockSecurities: {
      countryCode: COUNTRY_US,
      securitiesCode: base.issue.code,
    },
    inputStockPrice: {
      countryCode: COUNTRY_US,
      rics: [usRic(base.issue.code, requireUsOrderMarket(base, 'orders.inquiry.detail'))],
    },
  })
  const detail = objectAt(data, ['getForeignStockOrderDetail', 'orderDetail'])
  const order = objectAt(detail, ['order'])
  if (!order) throw new Error('orders.inquiry.detail returned no US stock order detail')
  return orderFromGraphql(order, {
    issue: base.issue,
    cancelable: booleanAt(detail, ['cancelable']),
    correctable: booleanAt(detail, ['correctable']),
  })
}

const fetchUsTradeRecords = async (
  session: SbiSession,
  options: TradeRecordInquiryOptions,
): Promise<TradeRecordList> => {
  if (options.market) requireUsMarket(options.market, 'orders.inquiry.tradeRecords')
  const dateRange = usInquiryDateRange(options)
  const data = await callUsGraphql(session, 'GetTradeRecordList', TRADE_RECORD_LIST, {
    input: {
      productCode: 'FOREIGN_STOCK',
      countryCode: COUNTRY_US,
      securitiesCode: options.issueCode,
      specificAccountCode: usSpecificAccountCode(options.accountType),
      tradeHistoryType: 'TRADE_RECORD',
      searchDateType: 'TRADE_DATE_BASE',
      searchDateFrom: dateRange.from,
      searchDateTo: dateRange.to,
      page: { pageNum: options.index ?? 1, pageSize: options.limit ?? 999 },
    },
  })
  const list = objectAt(data, ['listTradeRecords'])
  const records = arrayAt(list, ['tradeRecords']).map((record) =>
    tradeRecordFromGraphql(record, options.market),
  )
  return {
    records,
    hasMore: booleanAt(list, ['page', 'hasNextPage']),
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

const orderFromGraphql = (
  value: unknown,
  extra: { issue?: Order['issue']; cancelable?: boolean; correctable?: boolean } = {},
): Order => {
  const market = extra.issue?.market ?? usMarketFromGraphql(objectAt(value, ['market']))
  const securities = objectAt(value, ['securities'])
  const orderNo = stringAt(value, ['orderNo'])
  const orderSubNo = stringAt(value, ['orderSubNo'])
  return {
    id: orderSubNo ?? orderNo ?? '',
    issue: {
      code: extra.issue?.code ?? stringAt(securities, ['securitiesCode']) ?? '',
      market,
      name:
        extra.issue?.name ??
        stringAt(securities, ['securitiesName']) ??
        stringAt(securities, ['securitiesShortName']),
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
    expiresAt: stringAt(value, ['expiredDatetime']) ?? stringAt(value, ['orderTerm']),
    orderNumber: orderNo,
    orderSubNo,
    accountType: mapUsSpecificAccount(stringAt(value, ['specificAccountCode'])),
    depositType: mapUsSpecificAccount(stringAt(value, ['specificAccountCode'])),
    cancelable: extra.cancelable,
    correctable: extra.correctable,
  }
}

const cashPositionFromUsBalance = (balance: unknown, fallbackMarket?: MarketCode): CashPosition => {
  const securities = objectAt(balance, ['securities'])
  const evaluation = objectAt(balance, ['evaluationProfitLoss'])
  const market = usMarketFromGraphql(objectAt(balance, ['market']), fallbackMarket)
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
}

const resolveUsOrderForAction = async (
  session: SbiSession,
  options: {
    orderNumber?: string
    orderId?: string
    issueCode?: string
    market?: MarketCode
  },
): Promise<Order> => {
  if (options.market) requireUsMarket(options.market, 'US stock order action')
  const orders = await fetchUsOrders(session, {
    issueCode: options.issueCode,
    market: options.market,
    limit: 999,
  })
  const order = orders.orders.find((candidate) => {
    const ids = [candidate.id, candidate.orderNumber, candidate.orderSubNo].filter(Boolean)
    return (
      (options.orderId != null && ids.includes(options.orderId)) ||
      (options.orderNumber != null && ids.includes(options.orderNumber))
    )
  })
  if (!order) {
    throw new Error('US stock order action could not find the requested order in order inquiry')
  }
  return order
}

const requireUsOrderSubNo = (
  order: Order,
  options: { orderId?: string; orderNumber?: string },
  methodName: string,
) => {
  const orderSubNo = order.orderSubNo ?? order.id ?? options.orderId ?? options.orderNumber
  if (!orderSubNo) throw new Error(`${methodName} requires US stock orderSubNo`)
  return orderSubNo
}

const requireUsOrderMarket = (order: Order, methodName: string) => {
  if (!order.issue.market) throw new Error(`${methodName} requires US stock order market`)
  requireUsMarket(order.issue.market, methodName)
  return order.issue.market
}

const requireUsOrderCorrectionOptions = (options: OrderCorrectionOptions, methodName: string) => {
  if (options.market) requireUsMarket(options.market, methodName)
  if (options.orderMethod && options.orderMethod !== 'normal') {
    throw new Error(`${methodName} does not support stop/OCO/IFD correction for US stocks`)
  }
  if (options.secondaryPriceCondition || options.secondaryPrice || options.ifdPriceCondition) {
    throw new Error(`${methodName} does not support OCO/IFD correction for US stocks`)
  }
  if (
    options.triggerZone ||
    options.triggerPrice ||
    options.ifdOrderMethod ||
    options.ifdTriggerZone
  ) {
    throw new Error(`${methodName} does not support stop correction for US stocks`)
  }
  if (!Number.isFinite(options.quantity) || options.quantity == null || options.quantity <= 0) {
    throw new Error(`${methodName} requires quantity for US stock correction`)
  }
  const priceCondition = options.priceCondition ?? 'limit'
  if (priceCondition !== 'market' && priceCondition !== 'limit') {
    throw new Error(`${methodName} supports only market or limit correction for US stocks`)
  }
  if (priceCondition === 'limit' && options.price == null) {
    throw new Error(`${methodName} requires price for limit US stock correction`)
  }
  if (priceCondition === 'market' && options.price != null) {
    throw new Error(`${methodName} cannot specify price for market US stock correction`)
  }
}

const usOrderCorrectionInput = (options: OrderCorrectionOptions, order: Order) => {
  const priceCondition = options.priceCondition ?? 'limit'
  const orderSubNo = requireUsOrderSubNo(order, options, 'orders.cash.correction')
  return {
    orderSubNo,
    countryCode: COUNTRY_US,
    orderQuantity: String(options.quantity),
    orderPriceKindCode: priceCondition === 'market' ? 'MARKET' : 'LIMIT',
    orderPrice: priceCondition === 'market' ? undefined : String(options.price),
    stopPrice: undefined,
  }
}

const usOrderCorrectionPreOrderFromOrder = (order: Order, init?: Record<string, unknown>) => ({
  issue: order.issue,
  details: [],
  orderNumber: order.orderNumber,
  orderId: order.orderSubNo ?? order.id,
  status: order.status,
  statusText: order.statusText,
  quantity: order.unexecutedQuantity ?? order.quantity,
  price: order.price?.value,
  priceAmount: order.price,
  priceSteps: arrayAt(init, ['tickSizes']).map((tick) => ({
    from: usd(stringAt(tick, ['tickSize']) ?? stringAt(tick, ['basePriceFrom'])),
    to: usd(stringAt(tick, ['basePriceTo'])),
  })),
  marketName: order.issue.market,
})

const orderUpdatePreviewFromConfirmation = (
  data: Record<string, unknown>,
  order: Order,
  options: OrderCorrectionOptions,
): OrderPreview => {
  const confirmation = objectAt(data, ['confirmForeignStockUpdatedOrder'])
  const confirmedOrder = objectAt(confirmation, ['order'])
  return {
    issue: order.issue,
    side: order.side,
    quantity: options.quantity,
    price: usd(stringAt(confirmedOrder, ['orderPrice']) ?? String(options.price ?? '')),
    estimatedAmount: usd(stringAt(confirmedOrder, ['frnNetAmount'])),
    commission: usd(stringAt(confirmedOrder, ['frnCommissionAmount'])),
    tax: usd(stringAt(confirmedOrder, ['frnCommissionCtax'])),
    warnings: stringArrayAt(confirmation, ['warningStatuses']),
    confirmationId: stringAt(confirmedOrder, ['orderSubNo']) ?? order.orderSubNo,
    correction: usOrderCorrectionPreOrderFromOrder(order),
  }
}

const orderReceiptFromUsOrder = (order: unknown, sourceName: string): OrderReceipt => {
  if (!order) throw new Error(`${sourceName} returned no US stock order`)
  return {
    accepted: true,
    orderId: stringAt(order, ['orderSubNo']) ?? stringAt(order, ['orderNo']),
    acceptedAt: stringAt(order, ['orderInputDatetime']),
    message: stringAt(order, ['orderStatus']) ?? sourceName,
  }
}

const tradeRecordFromGraphql = (
  value: unknown,
  fallbackMarket: MarketCode = 'XNAS',
): TradeRecord => {
  const securities = objectAt(value, ['securities'])
  const code = stringAt(securities, ['securitiesCode']) ?? ''
  const tradeDate = stringAt(value, ['tradeDate'])
  const typeCode = stringAt(value, ['tradeRecordTypeCode'])
  return {
    id: [code, tradeDate, typeCode, stringAt(value, ['valueDate'])].filter(Boolean).join(':'),
    issue: {
      code,
      market: fallbackMarket,
      name:
        stringAt(securities, ['securitiesName']) ?? stringAt(securities, ['securitiesShortName']),
    },
    tradeRecordTypeCode: typeCode,
    tradeCurrencyCode: stringAt(value, ['tradeCurrencyCode']),
    listedSecuritiesStatus: stringAt(value, ['listedSecuritiesStatus']),
    orderPriceKindCode: stringAt(value, ['orderPriceKindCode']),
    accountType: mapUsSpecificAccount(stringAt(value, ['specificAccountCode'])),
    settlementCurrencyCode: stringAt(value, ['settlementCurrencyCode']),
    amount: usd(stringAt(value, ['amount'])),
    quantity: numberAt(value, ['quantity']),
    price: usd(stringAt(value, ['price'])),
    tradeDate,
    valueDate: stringAt(value, ['valueDate']),
    marginCloseLimitType: stringAt(value, ['marginCloseLimitType']),
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

const usInquiryDateRange = (options?: { from?: string; to?: string }) => {
  const to = normalizeUsOptionalDate(options?.to) ?? formatUsDate(new Date())
  const from =
    normalizeUsOptionalDate(options?.from) ??
    formatUsDate(addDays(parseUsDate(to), -DEFAULT_US_INQUIRY_LOOKBACK_DAYS))
  return { from, to }
}

const parseUsDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new Error('US stock inquiry date must be yyyy-MM-dd or yyyyMMdd')
  }
  return date
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const formatUsDate = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

const booleanAt = (source: unknown, path: string[]) => {
  const value = valueAt(source, path)
  return typeof value === 'boolean' ? value : undefined
}

const limitList = <T>(items: T[], options?: { index?: number; limit?: number }) => {
  const start = Math.max((options?.index ?? 1) - 1, 0)
  const end = options?.limit ? start + options.limit : undefined
  return items.slice(start, end)
}

const normalizeUsOptionalDate = (value: string | undefined) =>
  value ? normalizeUsOrderDate(value) : undefined

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
      orderPrice executionAveragePrice orderInputDatetime orderTerm specificAccountCode
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
    page { hasNextPage pageNum pageSize }
  }
}`

const ORDER_UPDATE_INITIAL_DATA = `
query GetOrderUpdatingInitialData($countryCode: common_enums_CountryEnum_Country, $securitiesCode: String, $baseDate: String, $orderSubNo: String, $rics: [String]) {
  getForeignStockUpdatedOrderInitialization(input: { orderSubNo: $orderSubNo }) {
    priceRangeLimitMax priceRangeLimitMin priceRangeNoLimit
    tickSizes { basePriceFrom basePriceTo tickSize }
    orderPriceKindCodes buyPossibleAmount
    order {
      orderNo orderSubNo buySellCode orderStatus orderQuantity unexecutedQuantity executionQuantity
      orderPrice executionAveragePrice orderInputDatetime orderTerm frnNetAmount frnCommissionAmount frnCommissionCtax
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
  }
  getForeignStockSecurities(input: { countryCode: $countryCode securitiesCode: $securitiesCode }) {
    securities { countryCode securitiesCode securitiesName securitiesShortName ric }
    market { marketCode marketName marketShortName timeZone }
  }
  checkJrNisaRestrictedReleaseBefore(input: { baseDate: $baseDate }) { restrictedReleaseBefore }
  listMarketPrices(input: { countryCode: $countryCode rics: $rics }) {
    marketPrices { ask askSize bid bidSize price { last lastDatetime change changePercent } }
  }
  checkJrNisaOpen { opened }
}`

const CONFIRM_ORDER_UPDATE = `
query ConfirmOrderUpdating($input: Input_fstock_order_ConfirmForeignStockUpdatedOrderRequest) {
  confirmForeignStockUpdatedOrder(input: $input) {
    buyPossibleAmount nisaBuyLimitAmount warningStatuses
    order {
      orderNo orderSubNo buySellCode orderStatus orderQuantity unexecutedQuantity executionQuantity
      orderPrice executionAveragePrice orderInputDatetime orderTerm frnNetAmount frnCommissionAmount frnCommissionCtax
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
  }
  checkJrNisaOpen { opened }
}`

const SUBMIT_ORDER_UPDATE = `
mutation SubmitOrderUpdating($input: Input_fstock_order_UpdateForeignStockOrderRequest) {
  updateForeignStockOrder(input: $input) {
    warningStatuses
    order {
      orderNo orderSubNo buySellCode orderStatus orderQuantity unexecutedQuantity executionQuantity
      orderPrice executionAveragePrice orderInputDatetime orderTerm
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
  }
}`

const CONFIRM_CANCEL_ORDER = `
query ConfirmCancelOrderInitialization($input: Input_fstock_order_GetForeignStockDeletedOrderInitializationRequest) {
  getForeignStockDeletedOrderInitialization(input: $input) { __typename }
}`

const SUBMIT_ORDER_CANCEL = `
mutation SubmitOrderCancelling($input: Input_fstock_order_DeleteForeignStockOrderRequest) {
  deleteForeignStockOrder(input: $input) {
    order {
      orderNo orderSubNo buySellCode orderStatus orderQuantity unexecutedQuantity executionQuantity
      orderPrice executionAveragePrice orderInputDatetime orderTerm
      securities { securitiesCode securitiesName securitiesShortName }
      market { marketCode marketName marketShortName }
    }
  }
}`

const ORDER_DETAIL = `
query GetOrderDetail($input: Input_fstock_order_GetForeignStockOrderDetailRequest, $inputStockSecurities: Input_fstock_securities_GetForeignStockSecuritiesRequest, $inputStockPrice: Input_information_marketprice_ListMarketPricesRequest) {
  getForeignStockOrderDetail(input: $input) {
    orderDetail {
      cancelable correctable
      order {
        orderNo orderSubNo buySellCode specificAccountCode orderQuantity unexecutedQuantity
        orderPriceKindCode stopPrice trailingStopAmount noLimitPrice orderLimitCode orderTerm
        settlementMethodCode settlementCurrencyCode orderPrice executionAveragePrice orderInputDatetime
        executionDatetime orderStatus tradeCurrencyCode expiredDatetime executionQuantity frnTradeDate
        tradeDate valueDate frnCommissionAmount commissionAmount frnCommissionCtax commissionCtax
        frnLocalCharge localCharge frnLocalNetAmount localNetAmount frnGrossAmount grossAmount
        frnNetAmount netAmount executionNetAmount exchangeRate executionStatus workingStatus stockTradeType
        market { marketCode marketName marketShortName timeZone }
      }
    }
  }
  getForeignStockSecurities(input: $inputStockSecurities) {
    securities { countryCode securitiesCode securitiesName securitiesShortName ric }
    market { marketCode marketName marketShortName timeZone }
  }
  listMarketPrices(input: $inputStockPrice) {
    marketPrices { ask askSize bid bidSize price { last lastDatetime change changePercent } }
  }
  checkJrNisaOpen { opened }
}`

const TRADE_RECORD_LIST = `
query GetTradeRecordList($input: Input_account_ListTradeRecordsRequest) {
  listTradeRecords(input: $input) {
    tradeRecords {
      securities { countryCode securitiesCode securitiesName securitiesShortName ric }
      tradeRecordTypeCode tradeCurrencyCode listedSecuritiesStatus orderPriceKindCode
      specificAccountCode settlementCurrencyCode amount quantity price tradeDate valueDate marginCloseLimitType
    }
    page { hasNextPage }
  }
  checkJrNisaOpen { opened }
}`

const SECURITIES_BALANCE_DETAIL = `
query GetSecuritiesBalanceDetail($inputSecuritiesBalance: Input_account_balance_GetSecuritiesBalanceRequest, $inputExchangeRate: Input_exchange_master_GetExchangeRateRequest, $inputStockSecurities: Input_fstock_securities_GetForeignStockSecuritiesRequest) {
  getSecuritiesBalance(input: $inputSecuritiesBalance) {
    securities { countryCode securitiesCode securitiesName securitiesShortName ric }
    listedSecuritiesStatus stockPrice { last lastDatetime tickArrow change changePercent open high low prevClose volume }
    evaluationProfitLoss {
      frnEvaluationAmount frnEvaluationProfitLoss evaluationAmount evaluationProfitLoss evaluationProfitLossPercent frnEvaluationProfitLossPercent
    }
    specificAccountCode securitiesQuantity sellFixedOrderQuantity frnAcquisitionPrice acquisitionPrice
    frnAcquisitionAmount acquisitionAmount countryCode currencyCode attentionSecurities
    market { marketCode marketName marketShortName timeZone }
  }
  getExchangeRate(input: $inputExchangeRate) { rateDatetime exchangeRate }
  getForeignStockSecurities(input: $inputStockSecurities) {
    securities { countryCode securitiesCode securitiesName securitiesShortName ric }
    market { marketCode marketName marketShortName timeZone }
  }
  checkJrNisaOpen { opened }
}`
