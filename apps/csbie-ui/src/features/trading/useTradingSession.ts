import { computed, ref, watch, type Ref } from 'vue'
import { createRpcSocket } from '../../api'
import {
  cashOrderAccountTypeOptions as defaultCashOrderAccountTypeOptions,
  cashOrderMarketOptions as defaultCashOrderMarketOptions,
  sKabuOrderMarketOptions,
} from '../../constants/trade'
import type {
  ChartMode,
  ChartRange,
  ChartNotice,
  CashOrderAccountType,
  CashOrderMarket,
  CashOrderMethod,
  CashOrderPriceCondition,
  CashOrderTerm,
  CashOrderTriggerZone,
  JsonRpcResponse,
  OrderKind,
  OrderPreview,
  OrderRow,
  Position,
  RealtimePricePoint,
  RpcMessage,
  Stock,
  TradeSide,
} from '../../types/trading'
import {
  asArray,
  asRecord,
  emptyStock,
  fulfilledValues,
  isOrderPreview,
  issueFrom,
  numberValue,
  orderFromApi,
  orderHistoryKey,
  orderHistoryResultNotice,
  chartNoticeFromIssueChart,
  pricePointsFromIssueChart,
  positionFromApi,
  startOfMarketDateUtcMs,
  stockFromBoard,
  stockFromIssue,
  stockFromPosition,
  textValue,
  type RecordLike,
} from './trading-data'

type RpcResolver = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type CashOrderTermOption = {
  label: string
  value: CashOrderTerm
}

type CashOrderAccountTypeOption = {
  label: string
  value: CashOrderAccountType
}

type CashOrderMarketOption = {
  label: string
  value: CashOrderMarket
}

type CashOrderDateOption = {
  label: string
  value: string
}

const priceBasedCashOrderConditions = new Set<CashOrderPriceCondition>([
  'limit',
  'limitAtOpen',
  'limitAtClose',
  'limitIoc',
  'funari',
])

const cashOrderPriceConditionRequiresPrice = (condition: CashOrderPriceCondition) =>
  priceBasedCashOrderConditions.has(condition)

const chartRangeOptions = {
  '1D': { period: 'minute', unit: 5, count: 120 },
  '7D': { period: 'day', unit: 1, count: 7 },
  '1M': { period: 'day', unit: 1, count: 31 },
  '3M': { period: 'day', unit: 1, count: 93 },
  '1Y': { period: 'day', unit: 1, count: 365 },
  ALL: { period: 'month', unit: 1, count: 9999 },
} as const satisfies Record<
  ChartRange,
  { period: 'minute' | 'day' | 'week' | 'month'; unit: number; count: number }
>

const marketTimeZones: Record<string, string> = {
  FKO: 'Asia/Tokyo',
  NGY: 'Asia/Tokyo',
  PTS: 'Asia/Tokyo',
  PTX: 'Asia/Tokyo',
  SOR: 'Asia/Tokyo',
  SPR: 'Asia/Tokyo',
  STK: 'Asia/Tokyo',
  TKY: 'Asia/Tokyo',
  AMEX: 'America/New_York',
  ARCX: 'America/New_York',
  NAS: 'America/New_York',
  NASDAQ: 'America/New_York',
  NYS: 'America/New_York',
  NYSE: 'America/New_York',
  XNAS: 'America/New_York',
  XNYS: 'America/New_York',
}

const countryTimeZones: Record<string, string> = {
  アメリカ: 'America/New_York',
  日本: 'Asia/Tokyo',
  米国: 'America/New_York',
  US: 'America/New_York',
  USA: 'America/New_York',
}

const timeZoneForStock = (stock: Stock) =>
  marketTimeZones[stock.market.toUpperCase()] ?? countryTimeZones[stock.country] ?? null

const normalizeApkOrderTermDate = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 6) return `20${digits}`
  if (digits.length === 8) return digits
  return ''
}

const displayApkOrderTermDate = (value: string) => {
  const normalized = normalizeApkOrderTermDate(value)
  if (!normalized) return value
  return `${normalized.slice(0, 4)}/${normalized.slice(4, 6)}/${normalized.slice(6, 8)}`
}

const apkExchangeMarketCodes: CashOrderMarket[] = ['SOR', 'TKY', 'NGY', 'FKO', 'SPR', 'PTS', 'PTX']

const parseApkExchangeMarkets = (value: string) => {
  const markets: CashOrderMarket[] = []
  for (let index = 0; index < value.length; index += 3) {
    const code = value.slice(index, index + 3) as CashOrderMarket
    if (apkExchangeMarketCodes.includes(code) && !markets.includes(code)) markets.push(code)
  }
  return markets
}

const priceMatchesStep = (price: number, step: number) => {
  if (!Number.isFinite(price) || !Number.isFinite(step) || step <= 0) return true
  return Math.abs(price / step - Math.round(price / step)) < 1e-8
}

export const useTradingSession = (selectedPasskeyId: Ref<string>) => {
  const selectedStockCode = ref('')
  const viewedStockCodes = ref<string[]>([])
  const tradeSide = ref<TradeSide>('buy')
  const orderKind = ref<OrderKind>('s')
  const cashOrderAccountType = ref<CashOrderAccountType>('specific')
  const cashOrderMarket = ref<CashOrderMarket>('STK')
  const cashOrderPriceCondition = ref<CashOrderPriceCondition>('market')
  const cashOrderTerm = ref<CashOrderTerm>('day')
  const cashOrderDateInput = ref('')
  const cashOrderMethod = ref<CashOrderMethod>('normal')
  const cashOrderTriggerZone = ref<CashOrderTriggerZone>('above')
  const cashOrderTriggerPriceInput = ref('')
  const cashOrderSecondaryPriceCondition = ref<CashOrderPriceCondition>('limit')
  const cashOrderSecondaryPriceInput = ref('')
  const quantityInput = ref('')
  const priceInput = ref('')
  const chartMode = ref<ChartMode>('line')
  const chartRange = ref<ChartRange>('1D')
  const showSearch = ref(false)
  const searchQuery = ref('')
  const countryFilter = ref('all')
  const marketFilter = ref('all')
  const showEstimateDialog = ref(false)
  const showOrderDialog = ref(false)
  const pendingCashEstimateId = ref<number | null>(null)
  const lastCashEstimate = ref<OrderPreview | null>(null)
  const lastCashEstimateKey = ref('')
  const cashPreOrder = ref<RecordLike | null>(null)
  const ws = ref<WebSocket | null>(null)
  const rpcPending = new Map<number, RpcResolver>()
  const sbiConnected = ref(false)
  const dataLoading = ref(false)
  const searchLoading = ref(false)
  const buyingPower = ref(0)
  const holdingsMarketValue = ref(0)
  const totalProfitLoss = ref(0)
  const totalProfitLossRate = ref(0)
  const orders = ref<OrderRow[]>([])
  const orderHistoryLoaded = ref(false)
  const orderHistoryNotice = ref('')
  const positions = ref<Position[]>([])
  const stocks = ref<Stock[]>([])
  const historicalPricePoints = ref<RealtimePricePoint[]>([])
  const chartNotice = ref<ChartNotice | null>(null)
  const realtimePricePoints = ref<RealtimePricePoint[]>([])
  const pricePolling = ref(false)
  let rpcId = 0
  let boardPollingSubscriptionId = ''
  let boardPollingRequestId = 0
  let chartHistoryRequestId = 0
  let cashPreOrderRequestId = 0

  const maxRealtimePricePoints = 120
  const errorMessage = (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback

  const reportDataError = (message: string, cause?: unknown) => {
    if (cause) {
      console.error(`[csbie-ui] データ取得エラー: ${message}`, cause)
      return
    }
    console.error(`[csbie-ui] データ取得エラー: ${message}`)
  }

  const selectedStock = computed(
    () =>
      stocks.value.find((stock) => stock.code === selectedStockCode.value) ??
      stocks.value[0] ??
      emptyStock,
  )
  const socketReady = computed(() => ws.value?.readyState === WebSocket.OPEN)
  const connected = computed(() => sbiConnected.value && socketReady.value)
  const orderQuantity = computed(() => Number(quantityInput.value || 0))
  const orderPrice = computed(() => Number(priceInput.value || selectedStock.value.price))
  const cashOrderPrimaryRequiresPrice = computed(() =>
    cashOrderPriceConditionRequiresPrice(cashOrderPriceCondition.value),
  )
  const cashOrderSecondaryRequiresPrice = computed(() =>
    cashOrderPriceConditionRequiresPrice(cashOrderSecondaryPriceCondition.value),
  )
  const cashOrderTriggerPrice = computed(() => Number(cashOrderTriggerPriceInput.value || 0))
  const cashOrderSecondaryPrice = computed(() => Number(cashOrderSecondaryPriceInput.value || 0))
  const resolvedCashOrderMarket = computed(() => {
    if (orderKind.value === 's') return 'STK'
    return cashOrderMarket.value === 'auto' ? selectedStock.value.market : cashOrderMarket.value
  })
  const sKabuAvailable = computed(() => {
    if (orderKind.value !== 's') return true
    const sKabu = cashPreOrder.value ? asRecord(cashPreOrder.value.sKabu) : null
    return sKabu?.available !== false
  })
  const cashOrderIppanMarginPaymentLimit = computed(() => {
    const margin = cashPreOrder.value ? asRecord(cashPreOrder.value.margin) : {}
    return textValue(margin.ippanPaymentLimit) || undefined
  })
  const cashOrderAccountTypeOptions = computed<CashOrderAccountTypeOption[]>(() => {
    const nisa = cashPreOrder.value ? asRecord(cashPreOrder.value.nisa) : {}
    const options = defaultCashOrderAccountTypeOptions.filter(
      (option) => option.value === 'specific' || option.value === 'general',
    )
    if (textValue(nisa.growthServiceKbn) === '1') {
      const growth = defaultCashOrderAccountTypeOptions.find(
        (option) => option.value === 'growthInvestment',
      )
      if (growth) options.push(growth)
    }
    if (textValue(nisa.serviceKbn) === '1') {
      const nisaOption = defaultCashOrderAccountTypeOptions.find(
        (option) => option.value === 'nisa',
      )
      if (nisaOption) options.push(nisaOption)
    }
    return options
  })
  const cashOrderMarketOptions = computed<CashOrderMarketOption[]>(() => {
    if (orderKind.value === 's') return sKabuOrderMarketOptions
    const exchangeList = textValue(cashPreOrder.value?.exchangeList)
    if (!exchangeList) return defaultCashOrderMarketOptions
    const markets = parseApkExchangeMarkets(exchangeList)
    const options = markets
      .map((market) => defaultCashOrderMarketOptions.find((option) => option.value === market))
      .filter((option): option is CashOrderMarketOption => Boolean(option))
    return options.length ? options : defaultCashOrderMarketOptions
  })
  const preferredCashOrderMarket = computed(() => {
    if (orderKind.value === 's') return 'STK'
    const index = Number(textValue(cashPreOrder.value?.exchangeListIndexFlag))
    const indexedOption =
      Number.isInteger(index) && index > 0 ? cashOrderMarketOptions.value[index - 1] : undefined
    return (
      indexedOption?.value ??
      cashOrderMarketOptions.value.find((option) => option.value === selectedStock.value.market)
        ?.value ??
      cashOrderMarketOptions.value[0]?.value ??
      'auto'
    )
  })
  const apkOrderTerms = computed(() =>
    asArray(cashPreOrder.value?.orderTerms)
      .map((value) => textValue(value))
      .filter(Boolean),
  )
  const apkOrderTermDates = computed(() =>
    asArray(cashPreOrder.value?.orderTermDates)
      .map((value) => textValue(value))
      .filter(Boolean),
  )
  const cashOrderTermOptions = computed<CashOrderTermOption[]>(() => {
    if (orderKind.value === 's') return [{ label: '当日中', value: 'day' }]
    const terms = apkOrderTerms.value
    if (!terms.length) {
      return [
        { label: '当日中', value: 'day' },
        { label: '今週中', value: 'week' },
        { label: '日付指定', value: 'date' },
      ]
    }
    const options: CashOrderTermOption[] = []
    if (terms.some((term) => term === '当日中')) options.push({ label: '当日中', value: 'day' })
    if (terms.some((term) => term === '今週中')) options.push({ label: '今週中', value: 'week' })
    if (apkOrderTermDates.value.length || terms.some((term) => /\d/.test(term))) {
      options.push({ label: '日付指定', value: 'date' })
    }
    return options.length ? options : [{ label: '当日中', value: 'day' }]
  })
  const cashOrderDateOptions = computed<CashOrderDateOption[]>(() => {
    const dates = apkOrderTermDates.value.length
      ? apkOrderTermDates.value
      : apkOrderTerms.value.filter((term) => /\d/.test(term))
    return dates
      .map((date) => ({
        label: displayApkOrderTermDate(date),
        value: normalizeApkOrderTermDate(date),
      }))
      .filter((option) => option.value)
  })
  const cashOrderPriceStep = computed(() => {
    const steps = asArray(cashPreOrder.value?.priceSteps)
      .map((value) => {
        const record = asRecord(value)
        return {
          upper: numberValue(record.from),
          step: numberValue(record.to),
        }
      })
      .filter((step) => step.upper > 0 && step.step > 0)
      .sort((left, right) => left.upper - right.upper)
    if (!steps.length) return 1
    const referencePrice = orderPrice.value > 0 ? orderPrice.value : selectedStock.value.price
    return steps.find((step) => referencePrice <= step.upper)?.step ?? steps.at(-1)?.step ?? 1
  })
  const estimatedAmount = computed(() => Math.max(0, orderQuantity.value * orderPrice.value))
  const hasQuote = (stock: Stock) => stock.price > 0
  const hasAccountSummary = computed(
    () =>
      connected.value ||
      Boolean(positions.value.length) ||
      orderHistoryLoaded.value ||
      holdingsMarketValue.value > 0 ||
      buyingPower.value > 0,
  )
  const showPortfolioSpinner = computed(() => dataLoading.value || !hasAccountSummary.value)
  const cashOrderKey = computed(() =>
    JSON.stringify({
      issueCode: selectedStock.value.code,
      market: resolvedCashOrderMarket.value,
      preOrderMarket: orderKind.value === 's' ? selectedStock.value.market : undefined,
      side: tradeSide.value,
      quantity: orderQuantity.value,
      kind: orderKind.value,
      accountType: cashOrderAccountType.value,
      depositType: cashOrderAccountType.value,
      priceCondition: orderKind.value === 's' ? undefined : cashOrderPriceCondition.value,
      price:
        orderKind.value !== 's' && cashOrderPrimaryRequiresPrice.value
          ? orderPrice.value
          : undefined,
      orderTerm: orderKind.value === 's' ? undefined : cashOrderTerm.value,
      orderDate:
        orderKind.value !== 's' && cashOrderTerm.value === 'date'
          ? cashOrderDateInput.value
          : undefined,
      orderMethod: orderKind.value === 's' ? undefined : cashOrderMethod.value,
      triggerZone:
        orderKind.value !== 's' && cashOrderMethod.value !== 'normal'
          ? cashOrderTriggerZone.value
          : undefined,
      triggerPrice:
        orderKind.value !== 's' && cashOrderMethod.value !== 'normal'
          ? cashOrderTriggerPrice.value
          : undefined,
      secondaryPriceCondition:
        orderKind.value !== 's' && cashOrderMethod.value === 'oco'
          ? cashOrderSecondaryPriceCondition.value
          : undefined,
      secondaryPrice:
        orderKind.value !== 's' &&
        cashOrderMethod.value === 'oco' &&
        cashOrderSecondaryRequiresPrice.value
          ? cashOrderSecondaryPrice.value
          : undefined,
      ippanMarginPaymentLimit:
        orderKind.value !== 's' ? cashOrderIppanMarginPaymentLimit.value : undefined,
    }),
  )
  const canRequestCashEstimate = computed(() => {
    if (!connected.value || !selectedStock.value.code || orderQuantity.value <= 0) return false
    if (orderKind.value === 's' && !selectedStock.value.market) return false
    if (!sKabuAvailable.value) return false
    if (orderKind.value === 's') return true
    if (cashOrderPrimaryRequiresPrice.value && orderPrice.value <= 0) return false
    if (
      cashOrderPrimaryRequiresPrice.value &&
      !priceMatchesStep(orderPrice.value, cashOrderPriceStep.value)
    ) {
      return false
    }
    if (cashOrderTerm.value === 'date' && !cashOrderDateInput.value) return false
    if (cashOrderMethod.value !== 'normal' && cashOrderTriggerPrice.value <= 0) return false
    if (
      cashOrderMethod.value !== 'normal' &&
      !priceMatchesStep(cashOrderTriggerPrice.value, cashOrderPriceStep.value)
    ) {
      return false
    }
    if (
      cashOrderMethod.value === 'oco' &&
      cashOrderSecondaryRequiresPrice.value &&
      cashOrderSecondaryPrice.value <= 0
    ) {
      return false
    }
    if (
      cashOrderMethod.value === 'oco' &&
      cashOrderSecondaryRequiresPrice.value &&
      !priceMatchesStep(cashOrderSecondaryPrice.value, cashOrderPriceStep.value)
    ) {
      return false
    }
    return true
  })
  const canPlaceCashOrder = computed(
    () =>
      canRequestCashEstimate.value &&
      Boolean(lastCashEstimate.value) &&
      lastCashEstimateKey.value === cashOrderKey.value,
  )
  const countries = computed(() => [...new Set(stocks.value.map((stock) => stock.country))])
  const markets = computed(() => [
    ...new Set(stocks.value.map((stock) => stock.market).filter(Boolean)),
  ])
  const stockByCode = computed(() => new Map(stocks.value.map((stock) => [stock.code, stock])))
  const viewedStocks = computed(() =>
    viewedStockCodes.value
      .map((code) => stockByCode.value.get(code))
      .filter((stock): stock is Stock => Boolean(stock)),
  )
  const filteredStocks = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    const matchesFilters = (stock: Stock) => {
      const matchesCountry = countryFilter.value === 'all' || stock.country === countryFilter.value
      const matchesMarket = marketFilter.value === 'all' || stock.market === marketFilter.value
      return matchesCountry && matchesMarket
    }

    if (!query) return viewedStocks.value.filter(matchesFilters)

    return stocks.value.filter((stock) => {
      const matchesQuery =
        stock.name.toLowerCase().includes(query) ||
        stock.code.includes(query) ||
        stock.symbol.toLowerCase().includes(query)
      return matchesQuery && matchesFilters(stock)
    })
  })
  const selectedPosition = computed(() =>
    positions.value.find((position) => position.code === selectedStock.value.code),
  )
  const recentOrders = computed(() => orders.value.slice(0, 2))
  const totalAssetValue = computed(() => holdingsMarketValue.value + buyingPower.value)
  const stockAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (holdingsMarketValue.value / totalAssetValue.value) * 100
  })
  const cashAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (buyingPower.value / totalAssetValue.value) * 100
  })
  const selectedStockTimeZone = computed(() => timeZoneForStock(selectedStock.value))
  const chartPricePoints = computed(() => {
    const points = [...historicalPricePoints.value, ...realtimePricePoints.value]
    if (chartRange.value !== '1D') return points

    const timeZone = selectedStockTimeZone.value
    if (!timeZone) return points

    const start = startOfMarketDateUtcMs(timeZone)
    return points.filter((point) => {
      const time = Date.parse(point.at)
      return Number.isFinite(time) && time >= start
    })
  })
  const recordViewedStock = (code: string) => {
    if (!code) return
    viewedStockCodes.value = [code, ...viewedStockCodes.value.filter((entry) => entry !== code)]
  }

  const selectStock = (stock: Stock) => {
    selectedStockCode.value = stock.code
    recordViewedStock(stock.code)
    showSearch.value = false
    lastCashEstimate.value = null
    lastCashEstimateKey.value = ''
  }

  const rejectPendingRpc = (reason: Error) => {
    for (const pending of rpcPending.values()) pending.reject(reason)
    rpcPending.clear()
  }

  const appendRealtimePricePoint = (price: number, at = new Date()) => {
    if (!Number.isFinite(price) || price <= 0) return
    realtimePricePoints.value = [
      ...realtimePricePoints.value,
      { at: at.toISOString(), price, open: price, high: price, low: price, close: price },
    ].slice(-maxRealtimePricePoints)
  }

  const stopBoardPolling = () => {
    const subscriptionId = boardPollingSubscriptionId
    boardPollingSubscriptionId = ''
    boardPollingRequestId += 1
    pricePolling.value = false
    if (subscriptionId) {
      call('market.issue.pollBoard.unsubscribe', { subscriptionId })
    }
  }

  const handleBoardPollingUpdate = (params: unknown) => {
    const payload = asRecord(params)
    const subscriptionId = textValue(payload.subscriptionId)
    if (!subscriptionId || subscriptionId !== boardPollingSubscriptionId) return

    const stock = stockFromBoard(payload.board, {
      code: selectedStock.value.code,
      market: selectedStock.value.market,
      name: selectedStock.value.name,
    })
    if (stock.code && stock.code !== selectedStock.value.code) return

    mergeStocks([stock])
    appendRealtimePricePoint(stock.price)
  }

  const handleRpcMessage = (data: string) => {
    let response: JsonRpcResponse
    try {
      response = JSON.parse(data) as JsonRpcResponse
    } catch {
      return
    }
    if (response.method === 'market.issue.pollBoard.update') {
      handleBoardPollingUpdate(response.params)
      return
    }
    if (response.method === 'market.issue.pollBoard.error') {
      const payload = asRecord(response.params)
      if (textValue(payload.subscriptionId) === boardPollingSubscriptionId) {
        pricePolling.value = false
        reportDataError(textValue(payload.message, '価格ポーリングに失敗しました'))
      }
      return
    }
    if (typeof response.id !== 'number') return
    const pending = rpcPending.get(response.id)
    if (!pending) return
    rpcPending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message || 'RPC request failed'))
    } else {
      pending.resolve(response.result)
    }
  }

  const call = (method: string, params?: unknown) => {
    const socket = ws.value
    if (!socket || socket.readyState !== WebSocket.OPEN) return undefined
    const payload: RpcMessage = { id: ++rpcId, method, params }
    socket.send(JSON.stringify({ jsonrpc: '2.0', ...payload }))
    return payload.id
  }

  const rpcCall = async <T>(method: string, params?: unknown): Promise<T> => {
    const id = call(method, params)
    if (!id) throw new Error('SBI session is not connected')
    return new Promise<T>((resolve, reject) => {
      rpcPending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
  }

  const rpcCallOptional = async <T>(
    method: string,
    params?: unknown,
    timeoutMs = 8_000,
  ): Promise<T> => {
    const id = call(method, params)
    if (!id) throw new Error('SBI session is not connected')
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        rpcPending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      rpcPending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timeout)
          resolve(value as T)
        },
        reject: (reason) => {
          window.clearTimeout(timeout)
          reject(reason)
        },
      })
    })
  }

  const mergeStocks = (nextStocks: Stock[]) => {
    const merged = new Map(stocks.value.map((stock) => [stock.code, stock]))
    for (const stock of nextStocks) {
      if (!stock.code) continue
      const current = merged.get(stock.code)
      merged.set(stock.code, {
        ...current,
        ...stock,
        name: stock.name || current?.name || stock.code,
        price: stock.price || current?.price || 0,
        change: stock.change || current?.change || 0,
        changeAmount: stock.changeAmount || current?.changeAmount || 0,
        history: stock.price ? stock.history : (current?.history ?? stock.history),
        box: stock.price ? stock.box : (current?.box ?? stock.box),
      })
    }
    stocks.value = [...merged.values()]
    if (!selectedStockCode.value) {
      const nextCode = stocks.value[0]?.code ?? ''
      if (nextCode) {
        selectedStockCode.value = nextCode
        recordViewedStock(nextCode)
      }
    }
  }

  const loadOrderHistoryFromSdk = async () => {
    orderHistoryLoaded.value = false
    orderHistoryNotice.value = ''
    const [openOrdersResult, executionsTodayResult] = await Promise.allSettled([
      rpcCallOptional<RecordLike>('orders.inquiry.open'),
      rpcCallOptional<RecordLike>('orders.inquiry.executionsToday'),
    ])
    if (openOrdersResult.status === 'rejected' && executionsTodayResult.status === 'rejected') {
      throw openOrdersResult.reason
    }
    const nextOrders = fulfilledValues([openOrdersResult, executionsTodayResult])
      .flatMap((orderList) => asArray(orderList.orders))
      .map(orderFromApi)
      .filter((order): order is OrderRow => Boolean(order))

    const deduped = new Map<string, OrderRow>()
    for (const order of nextOrders) deduped.set(orderHistoryKey(order), order)
    orders.value = [...deduped.values()]
    orderHistoryLoaded.value = true
    if (!orders.value.length) {
      const notices = fulfilledValues([openOrdersResult, executionsTodayResult])
        .map(orderHistoryResultNotice)
        .filter(Boolean)
      orderHistoryNotice.value = [...new Set(notices)].join(' / ')
    }
  }

  const loadTradingData = async () => {
    dataLoading.value = true
    try {
      const cashPositions = await rpcCallOptional<RecordLike>(
        'account.positions.cash',
        undefined,
        15_000,
      )
      const nextPositions = asArray(cashPositions.positions)
        .map(positionFromApi)
        .filter((position): position is Position => Boolean(position))
      positions.value = nextPositions
      mergeStocks(nextPositions.map(stockFromPosition))
      const nextHoldingsMarketValue = numberValue(
        cashPositions.totalMarketValue,
        nextPositions.reduce((sum, position) => sum + position.marketValue, 0),
      )
      holdingsMarketValue.value = nextHoldingsMarketValue
      totalProfitLoss.value = numberValue(cashPositions.totalProfitLoss)
      totalProfitLossRate.value = numberValue(cashPositions.totalProfitLossRate)

      const [orderHistoryResult, powerResult] = await Promise.allSettled([
        loadOrderHistoryFromSdk(),
        rpcCallOptional<RecordLike>('account.power.buyingPower'),
      ])

      if (powerResult.status === 'fulfilled') {
        buyingPower.value = numberValue(
          powerResult.value.cashBuyingPower ?? powerResult.value.withdrawableAmount,
        )
      }
      if (orderHistoryResult.status === 'rejected') {
        reportDataError(
          errorMessage(orderHistoryResult.reason, '取引履歴の取得に失敗しました'),
          orderHistoryResult.reason,
        )
      }

      const boards = await Promise.allSettled(
        nextPositions.slice(0, 20).map((position) =>
          rpcCallOptional<RecordLike>(
            'market.issue.board',
            {
              issueCode: position.code,
            },
            8_000,
          ),
        ),
      )
      mergeStocks(
        boards.flatMap((result, index) =>
          result.status === 'fulfilled'
            ? [
                stockFromBoard(result.value, {
                  code: nextPositions[index]?.code ?? '',
                  market: nextPositions[index]?.market ?? '',
                  name: nextPositions[index]?.name ?? '',
                }),
              ]
            : [],
        ),
      )
    } finally {
      dataLoading.value = false
    }
  }

  const connect = () => {
    const previousSocket = ws.value
    rejectPendingRpc(new Error('RPC socket reconnecting'))
    stopBoardPolling()
    previousSocket?.close()
    sbiConnected.value = false
    dataLoading.value = true
    if (!selectedPasskeyId.value) {
      dataLoading.value = false
      reportDataError('SBIパスキーを選択してください')
      return
    }
    const socket = createRpcSocket()
    socket.addEventListener('open', async () => {
      try {
        await rpcCall('sbi.connect', { passkeyId: selectedPasskeyId.value })
        sbiConnected.value = true
        await loadTradingData()
      } catch (cause) {
        sbiConnected.value = false
        reportDataError(errorMessage(cause, '接続に失敗しました'), cause)
        socket.close()
      } finally {
        dataLoading.value = false
      }
    })
    socket.addEventListener('message', (event) => handleRpcMessage(String(event.data)))
    socket.addEventListener('error', () => {
      if (ws.value !== socket) return
      reportDataError('SBI接続に失敗しました')
    })
    socket.addEventListener('close', () => {
      if (ws.value !== socket) return
      rejectPendingRpc(new Error('RPC socket closed'))
      boardPollingSubscriptionId = ''
      chartHistoryRequestId += 1
      historicalPricePoints.value = []
      chartNotice.value = null
      realtimePricePoints.value = []
      pricePolling.value = false
      sbiConnected.value = false
      dataLoading.value = false
    })
    ws.value = socket
  }

  const startBoardPolling = async () => {
    stopBoardPolling()
    realtimePricePoints.value = []

    const stock = selectedStock.value
    if (!connected.value || !stock.code) return
    appendRealtimePricePoint(stock.price)

    const requestId = ++boardPollingRequestId
    try {
      const subscribed = await rpcCall<RecordLike>('market.issue.pollBoard.subscribe', {
        issueCode: stock.code,
        market: stock.market || undefined,
      })
      if (requestId !== boardPollingRequestId) {
        const staleSubscriptionId = textValue(subscribed.subscriptionId)
        if (staleSubscriptionId) {
          call('market.issue.pollBoard.unsubscribe', { subscriptionId: staleSubscriptionId })
        }
        return
      }
      boardPollingSubscriptionId = textValue(subscribed.subscriptionId)
      pricePolling.value = Boolean(boardPollingSubscriptionId)
    } catch (cause) {
      if (requestId === boardPollingRequestId) {
        pricePolling.value = false
        reportDataError(errorMessage(cause, '価格ポーリングの開始に失敗しました'), cause)
      }
    }
  }

  const loadSelectedStockChart = async () => {
    historicalPricePoints.value = []
    chartNotice.value = null
    const stock = selectedStock.value
    if (!connected.value || !stock.code) return

    const requestId = ++chartHistoryRequestId
    const chartOptions = chartRangeOptions[chartRange.value]
    try {
      const timeZone = selectedStockTimeZone.value
      if (!timeZone) {
        throw new Error(`Unsupported market timezone for ${stock.market || stock.country}`)
      }
      const chart = await rpcCall<RecordLike>('market.issue.chart', {
        issueCode: stock.code,
        market: stock.market || undefined,
        period: chartOptions.period,
        unit: chartOptions.unit,
        count: chartOptions.count,
      })
      if (requestId !== chartHistoryRequestId) return
      historicalPricePoints.value = pricePointsFromIssueChart(chart, timeZone)
      chartNotice.value = chartNoticeFromIssueChart(chart)
    } catch (cause) {
      if (requestId === chartHistoryRequestId) {
        reportDataError(errorMessage(cause, '価格履歴の取得に失敗しました'), cause)
      }
    }
  }

  const searchIssues = async (query: string) => {
    if (!connected.value || query.trim().length < 2) return
    const result = await rpcCall<RecordLike>('market.issue.search', { query, limit: 12 })
    const issues = asArray(result.issues)
      .map(issueFrom)
      .filter((issue) => issue.code)
    mergeStocks(issues.map(stockFromIssue))
    const boards = await Promise.allSettled(
      issues.map((issue) =>
        rpcCall<RecordLike>('market.issue.board', {
          issueCode: issue.code,
          market: issue.market || undefined,
        }).then((board) => stockFromBoard(board, issue)),
      ),
    )
    mergeStocks(
      boards
        .filter((result): result is PromiseFulfilledResult<Stock> => result.status === 'fulfilled')
        .map((result) => result.value),
    )
  }

  const estimateCashOrder = async () => {
    if (!canRequestCashEstimate.value) return
    lastCashEstimate.value = null
    lastCashEstimateKey.value = ''
    pendingCashEstimateId.value = null
    const preview = await rpcCall<unknown>('orders.cash.estimate', cashOrderParams())
    if (isOrderPreview(preview)) {
      lastCashEstimate.value = preview
      lastCashEstimateKey.value = cashOrderKey.value
      showEstimateDialog.value = true
    }
  }

  const cashOrderParams = () => ({
    issueCode: selectedStock.value.code,
    market: resolvedCashOrderMarket.value || undefined,
    preOrderMarket: orderKind.value === 's' ? selectedStock.value.market || undefined : undefined,
    side: tradeSide.value,
    quantity: orderQuantity.value,
    kind: orderKind.value === 's' ? 's' : undefined,
    accountType: cashOrderAccountType.value,
    depositType: cashOrderAccountType.value,
    price:
      orderKind.value !== 's' && cashOrderPrimaryRequiresPrice.value ? orderPrice.value : undefined,
    priceCondition: orderKind.value !== 's' ? cashOrderPriceCondition.value : undefined,
    orderTerm: orderKind.value !== 's' ? cashOrderTerm.value : undefined,
    orderDate:
      orderKind.value !== 's' && cashOrderTerm.value === 'date'
        ? cashOrderDateInput.value
        : undefined,
    orderMethod: orderKind.value !== 's' ? cashOrderMethod.value : undefined,
    triggerZone:
      orderKind.value !== 's' && cashOrderMethod.value !== 'normal'
        ? cashOrderTriggerZone.value
        : undefined,
    triggerPrice:
      orderKind.value !== 's' && cashOrderMethod.value !== 'normal'
        ? cashOrderTriggerPrice.value
        : undefined,
    secondaryPriceCondition:
      orderKind.value !== 's' && cashOrderMethod.value === 'oco'
        ? cashOrderSecondaryPriceCondition.value
        : undefined,
    secondaryPrice:
      orderKind.value !== 's' &&
      cashOrderMethod.value === 'oco' &&
      cashOrderSecondaryRequiresPrice.value
        ? cashOrderSecondaryPrice.value
        : undefined,
    ippanMarginPaymentLimit:
      orderKind.value !== 's' ? cashOrderIppanMarginPaymentLimit.value : undefined,
  })

  const refreshCashPreOrder = async () => {
    const requestId = ++cashPreOrderRequestId
    if (!connected.value || !selectedStock.value.code || !resolvedCashOrderMarket.value) {
      cashPreOrder.value = null
      return
    }
    try {
      const preOrder = await rpcCall<RecordLike>('orders.cash.preOrder', {
        issueCode: selectedStock.value.code,
        market: resolvedCashOrderMarket.value,
        preOrderMarket:
          orderKind.value === 's' ? selectedStock.value.market || undefined : undefined,
        side: tradeSide.value,
        kind: orderKind.value === 's' ? 's' : undefined,
        accountType: cashOrderAccountType.value,
        depositType: cashOrderAccountType.value,
      })
      if (requestId === cashPreOrderRequestId) cashPreOrder.value = preOrder
    } catch (cause) {
      if (requestId === cashPreOrderRequestId) {
        cashPreOrder.value = null
        reportDataError(errorMessage(cause, '注文前情報の取得に失敗しました'), cause)
      }
    }
  }

  const askPlaceOrder = () => {
    if (!canPlaceCashOrder.value) return
    showEstimateDialog.value = false
    showOrderDialog.value = true
  }

  const placeCashOrder = async () => {
    if (!canPlaceCashOrder.value || !lastCashEstimate.value) return
    const receipt = await rpcCall<RecordLike>('orders.cash.place', {
      ...cashOrderParams(),
      confirmationId: lastCashEstimate.value.confirmationId,
      allowTrading: true,
    })
    orders.value = [
      {
        id: textValue(receipt.orderId, `ord-${Date.now()}`),
        date: textValue(receipt.acceptedAt, new Date().toLocaleString('ja-JP')),
        stock: selectedStock.value.name,
        side: tradeSide.value,
        kind: orderKind.value,
        quantity: orderQuantity.value,
        price: orderPrice.value,
        status: '注文中',
      },
      ...orders.value,
    ]
    showOrderDialog.value = false
    await loadTradingData()
  }

  const cancelOrder = async (order: OrderRow) => {
    await rpcCall('orders.cash.placeCancel', {
      orderNumber: order.orderNumber || order.id,
      orderId: order.id,
      tradeId: order.tradeId || undefined,
      allowTrading: true,
    })
    order.status = '取消済'
    await loadTradingData()
  }

  const downloadCsv = () => {
    const header = ['code', 'name', 'symbol', 'market', 'price'].join(',')
    const rows = selectedStock.value.history.map((price) =>
      [
        selectedStock.value.code,
        selectedStock.value.name,
        selectedStock.value.symbol,
        selectedStock.value.market,
        price,
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selectedStock.value.code}-history.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openTradeForStock = (stock: Stock, navigate: () => void) => {
    selectStock(stock)
    navigate()
  }

  const openTradeForPosition = (code: string, navigate: () => void) => {
    const stock = stocks.value.find((candidate) => candidate.code === code)
    openTradeForStock(stock ?? selectedStock.value, navigate)
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchRequestId = 0
  watch(orderKind, (kind) => {
    if (kind === 's') {
      cashOrderMarket.value = 'STK'
      cashOrderPriceCondition.value = 'market'
      cashOrderTerm.value = 'day'
      cashOrderDateInput.value = ''
      cashOrderMethod.value = 'normal'
      cashOrderTriggerPriceInput.value = ''
      cashOrderSecondaryPriceInput.value = ''
      priceInput.value = ''
      return
    }
    if (cashOrderMarket.value === 'STK') {
      cashOrderMarket.value = 'auto'
    }
  })

  watch(cashOrderPriceCondition, (condition) => {
    if (!cashOrderPriceConditionRequiresPrice(condition)) priceInput.value = ''
  })

  watch(cashOrderSecondaryPriceCondition, (condition) => {
    if (!cashOrderPriceConditionRequiresPrice(condition)) cashOrderSecondaryPriceInput.value = ''
  })

  watch(cashOrderTerm, (term) => {
    if (term !== 'date') {
      cashOrderDateInput.value = ''
      return
    }
    const firstDate = cashOrderDateOptions.value[0]?.value
    if (firstDate && !cashOrderDateInput.value) cashOrderDateInput.value = firstDate
  })

  watch(cashOrderAccountTypeOptions, (options) => {
    if (options.some((option) => option.value === cashOrderAccountType.value)) return
    cashOrderAccountType.value = options[0]?.value ?? 'specific'
  })

  watch(cashOrderMarketOptions, (options) => {
    if (options.some((option) => option.value === cashOrderMarket.value)) return
    cashOrderMarket.value = preferredCashOrderMarket.value
  })

  watch(cashOrderTermOptions, (options) => {
    if (options.some((option) => option.value === cashOrderTerm.value)) return
    cashOrderTerm.value = options[0]?.value ?? 'day'
  })

  watch(cashOrderDateOptions, (options) => {
    if (cashOrderTerm.value !== 'date') return
    const firstOption = options[0]
    if (!firstOption) return
    if (options.some((option) => option.value === cashOrderDateInput.value)) return
    cashOrderDateInput.value = firstOption.value
  })

  watch(cashOrderMethod, (method) => {
    if (method === 'normal') {
      cashOrderTriggerPriceInput.value = ''
      cashOrderSecondaryPriceInput.value = ''
      return
    }
    if (method === 'stop') cashOrderSecondaryPriceInput.value = ''
  })

  watch(
    [
      connected,
      () => selectedStock.value.code,
      () => selectedStock.value.market,
      resolvedCashOrderMarket,
      tradeSide,
      orderKind,
      cashOrderAccountType,
    ],
    () => {
      void refreshCashPreOrder()
    },
    { immediate: true },
  )

  watch(searchQuery, (query) => {
    clearTimeout(searchTimer)
    const trimmed = query.trim()
    if (trimmed.length < 2 || !connected.value) {
      searchLoading.value = false
      return
    }
    searchLoading.value = true
    searchTimer = setTimeout(async () => {
      const requestId = ++searchRequestId
      try {
        await searchIssues(query)
      } catch (cause) {
        reportDataError(errorMessage(cause, '銘柄検索に失敗しました'), cause)
      } finally {
        if (requestId === searchRequestId) {
          searchLoading.value = false
        }
      }
    }, 350)
  })

  watch(
    [connected, () => selectedStock.value.code, () => selectedStock.value.market, chartRange],
    () => {
      void loadSelectedStockChart()
      void startBoardPolling()
    },
    { immediate: true },
  )

  return {
    selectedStockCode,
    tradeSide,
    orderKind,
    cashOrderAccountType,
    cashOrderMarket,
    cashOrderPriceCondition,
    cashOrderTerm,
    cashOrderDateInput,
    cashOrderMethod,
    cashOrderTriggerZone,
    cashOrderTriggerPriceInput,
    cashOrderSecondaryPriceCondition,
    cashOrderSecondaryPriceInput,
    quantityInput,
    priceInput,
    chartMode,
    chartRange,
    showSearch,
    searchQuery,
    countryFilter,
    marketFilter,
    showEstimateDialog,
    showOrderDialog,
    lastCashEstimate,
    connected,
    dataLoading,
    searchLoading,
    buyingPower,
    holdingsMarketValue,
    totalProfitLoss,
    totalProfitLossRate,
    orders,
    orderHistoryLoaded,
    orderHistoryNotice,
    positions,
    realtimePricePoints,
    chartPricePoints,
    chartNotice,
    pricePolling,
    selectedStock,
    orderQuantity,
    orderPrice,
    cashOrderPrimaryRequiresPrice,
    cashOrderTriggerPrice,
    cashOrderSecondaryPrice,
    cashOrderAccountTypeOptions,
    cashOrderMarketOptions,
    cashOrderTermOptions,
    cashOrderDateOptions,
    cashOrderPriceStep,
    estimatedAmount,
    showPortfolioSpinner,
    canRequestCashEstimate,
    canPlaceCashOrder,
    countries,
    markets,
    viewedStocks,
    filteredStocks,
    selectedPosition,
    recentOrders,
    totalAssetValue,
    stockAssetRatio,
    cashAssetRatio,
    hasQuote,
    selectStock,
    connect,
    loadTradingData,
    estimateCashOrder,
    askPlaceOrder,
    placeCashOrder,
    cancelOrder,
    downloadCsv,
    openTradeForStock,
    openTradeForPosition,
  }
}
