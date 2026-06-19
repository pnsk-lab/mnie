import { computed, ref, watch, type Ref } from 'vue'
import { createRpcSocket } from '../../api'
import {
  cashOrderAccountTypeOptions as defaultCashOrderAccountTypeOptions,
  cashOrderMarketOptions as defaultCashOrderMarketOptions,
  searchableMarkets,
} from '../../constants/trade'
import { countryTimeZones, marketSessions, marketTimeZones } from '../../constants/market'
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
  marketDateKey,
  numberValue,
  orderFromApi,
  orderHistoryKey,
  orderHistoryResultNotice,
  chartNoticeFromIssueChart,
  pricePointsFromIssueChart,
  positionFromApi,
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
  '3D': { period: 'minute', unit: 15, count: 9999 },
  '3M': { period: 'day', unit: 1, count: 93 },
  '1Y': { period: 'day', unit: 1, count: 365 },
  ALL: { period: 'month', unit: 1, count: 9999 },
} as const satisfies Record<
  ChartRange,
  { period: 'minute' | 'day' | 'week' | 'month'; unit: number; count: number }
>

const timeZoneForStock = (stock: Stock) =>
  marketTimeZones[stock.market.toUpperCase()] ?? countryTimeZones[stock.country] ?? null

const marketClockFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const marketClockParts = (timeZone: string, now = new Date()) => {
  const parts = Object.fromEntries(
    marketClockFormatter(timeZone)
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Partial<Record<'weekday' | 'hour' | 'minute', string>>

  return {
    weekday: parts.weekday ?? '',
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
  }
}

const hasMarketOpenedToday = (market: string, timeZone: string) => {
  const sessions = marketSessions[market.toUpperCase()]
  const openMinutes = sessions?.[0]?.[0]
  if (openMinutes == null) return true

  const parts = marketClockParts(timeZone)
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false
  return parts.hour * 60 + parts.minute >= openMinutes
}

const isMarketSessionOpen = (market: string, timeZone: string) => {
  const sessions = marketSessions[market.toUpperCase()]
  if (!sessions?.length) return true

  const parts = marketClockParts(timeZone)
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false

  const minutes = parts.hour * 60 + parts.minute
  return sessions.some(([open, close]) => minutes >= open && minutes < close)
}

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

const usMarkets = new Set(['XNAS', 'XNYS', 'ARCX'])

const parseApkExchangeMarkets = (value: string) => {
  const markets: CashOrderMarket[] = []
  for (let index = 0; index < value.length; index += 3) {
    const code = value.slice(index, index + 3) as CashOrderMarket
    if (searchableMarkets.includes(code) && !markets.includes(code)) markets.push(code)
  }
  return markets
}

const priceMatchesStep = (price: number, step: number) => {
  if (!Number.isFinite(price) || !Number.isFinite(step) || step <= 0) return true
  return Math.abs(price / step - Math.round(price / step)) < 1e-8
}

export const useTradingSession = (selectedPasskeyId: Ref<string>) => {
  const selectedStockCode = ref('')
  const selectedStockId = ref('')
  const viewedStockCodes = ref<string[]>([])
  const tradeSide = ref<TradeSide>('buy')
  const orderKind = ref<OrderKind>('standard')
  const cashOrderAccountType = ref<CashOrderAccountType>('specific')
  const cashOrderMarket = ref<CashOrderMarket>('auto')
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
  const totalAssetValueFromAssets = ref<number | null>(null)
  const buyingPower = ref(0)
  const holdingsMarketValue = ref(0)
  const totalProfitLoss = ref(0)
  const totalProfitLossRate = ref(0)
  const orders = ref<OrderRow[]>([])
  const cancelingOrderKey = ref('')
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

  const stockId = (stock: Pick<Stock, 'code' | 'market'>) =>
    stock.market ? `${stock.market}:${stock.code}` : stock.code

  const stockRefFromId = (id: string) => {
    const normalized = id.trim()
    const separator = normalized.indexOf(':')
    if (separator <= 0) return { code: normalized, market: '' }

    const market = normalized.slice(0, separator).toUpperCase()
    const code = normalized.slice(separator + 1)
    if (!searchableMarkets.includes(market as CashOrderMarket)) {
      return { code: normalized, market: '' }
    }
    return { code, market }
  }

  const codeFromStockId = (id: string) => stockRefFromId(id).code

  const reportDataError = (message: string, cause?: unknown) => {
    if (cause) {
      console.error(`[csbie-ui] データ取得エラー: ${message}`, cause)
      return
    }
    console.error(`[csbie-ui] データ取得エラー: ${message}`)
  }

  const selectedStock = computed(() => {
    const selectedRef = stockRefFromId(selectedStockId.value)
    const exact =
      stockById.value.get(selectedStockId.value) ??
      stocks.value.find((stock) => stock.symbol === selectedStockId.value)
    if (exact) return exact

    if (!selectedRef.market) {
      const codeMatch = stockByCode.value.get(selectedStockCode.value)
      if (codeMatch) return codeMatch
    }

    if (selectedStockCode.value) {
      return stockFromIssue({
        code: selectedStockCode.value,
        market: selectedRef.market,
        name: selectedStockCode.value,
      })
    }

    return stocks.value[0] ?? emptyStock
  })
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
  const selectedStockIsUs = computed(() => usMarkets.has(selectedStock.value.market))
  const resolvedCashOrderMarket = computed(() => {
    return cashOrderMarket.value === 'auto' ? selectedStock.value.market : cashOrderMarket.value
  })
  const cashOrderKind = computed(() =>
    orderKind.value === 'standard' ? undefined : orderKind.value,
  )
  const cashOrderPreOrderMarket = computed(() =>
    cashOrderKind.value === 's' ? resolvedCashOrderMarket.value : undefined,
  )
  const cashOrderRequestMarket = computed(() =>
    cashOrderKind.value === 's' ? 'STK' : resolvedCashOrderMarket.value,
  )
  const sKabuAvailable = computed(() => {
    return true
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
    if (selectedStockIsUs.value) {
      return defaultCashOrderMarketOptions.filter(
        (option) => option.value === 'auto' || option.value === selectedStock.value.market,
      )
    }
    const exchangeList = textValue(cashPreOrder.value?.exchangeList)
    if (!exchangeList) {
      return defaultCashOrderMarketOptions.filter(
        (option) => option.value === 'auto' || option.value === 'XTKS',
      )
    }
    const markets = parseApkExchangeMarkets(exchangeList)
    const options = markets
      .map((market) => defaultCashOrderMarketOptions.find((option) => option.value === market))
      .filter((option): option is CashOrderMarketOption => Boolean(option))
    return options.length ? options : defaultCashOrderMarketOptions
  })
  const preferredCashOrderMarket = computed(() => {
    if (selectedStockIsUs.value) return 'auto'
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
    if (selectedStockIsUs.value) return [{ label: '当日中', value: 'day' }]
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
      market: cashOrderRequestMarket.value,
      side: tradeSide.value,
      quantity: orderQuantity.value,
      kind: cashOrderKind.value,
      preOrderMarket: cashOrderPreOrderMarket.value,
      accountType: cashOrderAccountType.value,
      depositType: cashOrderAccountType.value,
      priceCondition: cashOrderPriceCondition.value,
      price: cashOrderPrimaryRequiresPrice.value ? orderPrice.value : undefined,
      orderTerm: cashOrderTerm.value,
      orderDate: cashOrderTerm.value === 'date' ? cashOrderDateInput.value : undefined,
      orderMethod: cashOrderMethod.value,
      triggerZone: cashOrderMethod.value !== 'normal' ? cashOrderTriggerZone.value : undefined,
      triggerPrice: cashOrderMethod.value !== 'normal' ? cashOrderTriggerPrice.value : undefined,
      secondaryPriceCondition:
        cashOrderMethod.value === 'oco' ? cashOrderSecondaryPriceCondition.value : undefined,
      secondaryPrice:
        cashOrderMethod.value === 'oco' && cashOrderSecondaryRequiresPrice.value
          ? cashOrderSecondaryPrice.value
          : undefined,
      ippanMarginPaymentLimit: cashOrderIppanMarginPaymentLimit.value,
    }),
  )
  const canRequestCashEstimate = computed(() => {
    if (!connected.value || !selectedStock.value.code || orderQuantity.value <= 0) return false
    if (!resolvedCashOrderMarket.value) return false
    if (cashOrderKind.value === 's' && selectedStockIsUs.value) return false
    if (!sKabuAvailable.value) return false
    if (cashOrderPrimaryRequiresPrice.value && orderPrice.value <= 0) return false
    if (selectedStockIsUs.value && cashOrderMethod.value !== 'normal') return false
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
    ...new Set([
      ...searchableMarkets.filter((market) => market !== 'auto'),
      ...stocks.value.map((stock) => stock.market).filter(Boolean),
    ]),
  ])
  const stockById = computed(() => new Map(stocks.value.map((stock) => [stockId(stock), stock])))
  const stockByCode = computed(() => new Map(stocks.value.map((stock) => [stock.code, stock])))
  const viewedStocks = computed(() =>
    viewedStockCodes.value
      .map((code) => stockById.value.get(code) ?? stockByCode.value.get(code))
      .filter((stock): stock is Stock => Boolean(stock)),
  )
  const filteredStocks = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    const matchesFilters = (stock: Stock) => {
      const matchesCountry = countryFilter.value === 'all' || stock.country === countryFilter.value
      const matchesMarket = marketFilter.value === 'all' || stock.market === marketFilter.value
      return matchesCountry && matchesMarket
    }
    const baseStocks = query
      ? stocks.value.filter((stock) => {
          const matchesQuery =
            stock.name.toLowerCase().includes(query) ||
            stock.code.includes(query) ||
            stock.symbol.toLowerCase().includes(query)
          return matchesQuery && matchesFilters(stock)
        })
      : viewedStocks.value.filter(matchesFilters)

    if (!selectedStockCode.value) return baseStocks

    const exists = baseStocks.some((stock) => stockId(stock) === selectedStockId.value)
    const selected =
      stockById.value.get(selectedStockId.value) ?? stockByCode.value.get(selectedStockCode.value)
    if (!exists && selected && matchesFilters(selected)) {
      return [selected, ...baseStocks]
    }
    return baseStocks
  })
  const selectedPosition = computed(() =>
    positions.value.find(
      (position) =>
        position.code === selectedStock.value.code &&
        position.market === selectedStock.value.market,
    ),
  )
  const recentOrders = computed(() => orders.value.slice(0, 2))
  const totalAssetValue = computed(
    () => totalAssetValueFromAssets.value ?? holdingsMarketValue.value + buyingPower.value,
  )
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
    const timeZone = selectedStockTimeZone.value

    if (chartRange.value !== '1D') {
      return points
    }

    if (!timeZone) return points

    const keyForPoint = (point: RealtimePricePoint) => {
      const time = Date.parse(point.at)
      return Number.isFinite(time) ? marketDateKey(timeZone, new Date(time)) : ''
    }
    const todayKey = marketDateKey(timeZone)
    const latestHistorical = historicalPricePoints.value.reduce<{
      key: string
      time: number
    } | null>((latest, point) => {
      const time = Date.parse(point.at)
      if (!Number.isFinite(time) || (latest && time <= latest.time)) return latest
      return { key: marketDateKey(timeZone, new Date(time)), time }
    }, null)
    const hasHistoricalToday = historicalPricePoints.value.some(
      (point) => keyForPoint(point) === todayKey,
    )
    const targetKey =
      hasHistoricalToday || hasMarketOpenedToday(selectedStock.value.market, timeZone)
        ? todayKey
        : (latestHistorical?.key ?? todayKey)
    const targetPoints =
      targetKey === todayKey
        ? [...historicalPricePoints.value, ...realtimePricePoints.value]
        : historicalPricePoints.value

    return targetPoints.filter((point) => {
      return keyForPoint(point) === targetKey
    })
  })
  const recordViewedStock = (code: string) => {
    if (!code) return
    viewedStockCodes.value = [code, ...viewedStockCodes.value.filter((entry) => entry !== code)]
  }

  const selectStock = (stock: Stock) => {
    selectedStockCode.value = stock.code
    selectedStockId.value = stockId(stock)
    recordViewedStock(stockId(stock))
    showSearch.value = false
    lastCashEstimate.value = null
    lastCashEstimateKey.value = ''
  }

  const selectStockByCode = (id: string) => {
    if (!id) return
    const code = codeFromStockId(id)
    selectedStockCode.value = code
    selectedStockId.value = id
    recordViewedStock(id)
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
    const timeZone = selectedStockTimeZone.value
    if (!timeZone || !isMarketSessionOpen(stock.market, timeZone)) {
      stopBoardPolling()
      return
    }
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
          const message = reason instanceof Error ? reason.message : 'RPC request failed'
          reject(new Error(`${method}: ${message}`))
        },
      })
    })
  }

  const mergeStocks = (nextStocks: Stock[]) => {
    const merged = new Map(stocks.value.map((stock) => [stockId(stock), stock]))
    for (const stock of nextStocks) {
      if (!stock.code) continue
      const id = stockId(stock)
      const current = merged.get(id)
      merged.set(id, {
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
        selectedStockId.value = stockId(stocks.value[0] ?? { code: nextCode, market: '' })
        recordViewedStock(selectedStockId.value)
      }
    }
  }

  const loadOrderHistoryFromSdk = async () => {
    orderHistoryLoaded.value = false
    orderHistoryNotice.value = ''
    const [openOrdersResult, executionsTodayResult] = await Promise.allSettled([
      rpcCallOptional<RecordLike>('orders.inquiry.open'),
      rpcCallOptional<RecordLike>('orders.inquiry.executionsToday'),
      rpcCallOptional<RecordLike>('orders.inquiry.open', { market: 'XNAS' }),
      rpcCallOptional<RecordLike>('orders.inquiry.executionsToday', { market: 'XNAS' }),
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

  const optionalNumber = (value: unknown) => {
    const parsed = numberValue(value, Number.NaN)
    return Number.isFinite(parsed) ? parsed : null
  }

  const applyAccountAssets = (value: RecordLike) => {
    const summary = asRecord(value.summary)
    const summaryWithoutDeposit = asRecord(value.summaryWithoutDeposit)
    const valuation = optionalNumber(summary.valuation)
    const valuationWithoutDeposit = optionalNumber(summaryWithoutDeposit.valuation)
    const profitLoss = optionalNumber(summary.profitLoss)
    const profitLossRate = optionalNumber(summary.profitLossRate)

    if (valuation !== null) totalAssetValueFromAssets.value = valuation
    if (valuationWithoutDeposit !== null) holdingsMarketValue.value = valuationWithoutDeposit
    if (valuation !== null && valuationWithoutDeposit !== null) {
      buyingPower.value = Math.max(valuation - valuationWithoutDeposit, 0)
    }
    if (profitLoss !== null) totalProfitLoss.value = profitLoss
    if (profitLossRate !== null) totalProfitLossRate.value = profitLossRate
  }

  const loadTradingData = async () => {
    dataLoading.value = true
    try {
      const [assetsResult, ...positionResults] = await Promise.allSettled([
        rpcCallOptional<RecordLike>('account.assets.current', undefined, 20_000),
        rpcCallOptional<RecordLike>('account.positions.cash', undefined, 15_000),
        rpcCallOptional<RecordLike>('account.positions.cash', { market: 'XNAS' }, 15_000),
      ])
      const cashPositionLists = fulfilledValues(positionResults)
      const cashPositions = cashPositionLists[0] ?? {}
      const nextPositions = cashPositionLists
        .flatMap((list) => asArray(list.positions))
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

      const hasAccountAssets = assetsResult.status === 'fulfilled'
      if (hasAccountAssets) {
        applyAccountAssets(assetsResult.value)
      } else {
        totalAssetValueFromAssets.value = null
        reportDataError(
          errorMessage(assetsResult.reason, 'My資産の取得に失敗しました'),
          assetsResult.reason,
        )
      }

      const [orderHistoryResult, powerResult] = await Promise.allSettled([
        loadOrderHistoryFromSdk(),
        rpcCallOptional<RecordLike>('account.power.buyingPower'),
      ])

      if (!hasAccountAssets && powerResult.status === 'fulfilled') {
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
              market: position.market,
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
    const timeZone = selectedStockTimeZone.value
    if (!timeZone || !isMarketSessionOpen(stock.market, timeZone)) return

    appendRealtimePricePoint(stock.price)

    const requestId = ++boardPollingRequestId
    try {
      const subscribed = await rpcCall<RecordLike>('market.issue.pollBoard.subscribe', {
        issueCode: stock.code,
        market: stock.market,
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
        market: stock.market,
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
    const marketsToSearch =
      marketFilter.value !== 'all'
        ? [marketFilter.value as CashOrderMarket]
        : searchableMarkets.filter((market) => market !== 'auto')
    const results = await Promise.allSettled(
      marketsToSearch.map((market) =>
        rpcCall<RecordLike>('market.issue.search', { query, market, limit: 12 }),
      ),
    )
    const issues = fulfilledValues(results)
      .flatMap((result) => asArray(result.issues))
      .map(issueFrom)
      .filter((issue) => issue.code)
    mergeStocks(issues.map(stockFromIssue))
    const boards = await Promise.allSettled(
      issues.map((issue) =>
        rpcCall<RecordLike>('market.issue.board', {
          issueCode: issue.code,
          market: issue.market,
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
    market: cashOrderRequestMarket.value,
    side: tradeSide.value,
    quantity: orderQuantity.value,
    kind: cashOrderKind.value,
    preOrderMarket: cashOrderPreOrderMarket.value,
    accountType: cashOrderAccountType.value,
    depositType: cashOrderAccountType.value,
    price: cashOrderPrimaryRequiresPrice.value ? orderPrice.value : undefined,
    priceCondition: cashOrderPriceCondition.value,
    orderTerm: cashOrderTerm.value,
    orderDate: cashOrderTerm.value === 'date' ? cashOrderDateInput.value : undefined,
    orderMethod: cashOrderMethod.value,
    triggerZone: cashOrderMethod.value !== 'normal' ? cashOrderTriggerZone.value : undefined,
    triggerPrice: cashOrderMethod.value !== 'normal' ? cashOrderTriggerPrice.value : undefined,
    secondaryPriceCondition:
      cashOrderMethod.value === 'oco' ? cashOrderSecondaryPriceCondition.value : undefined,
    secondaryPrice:
      cashOrderMethod.value === 'oco' && cashOrderSecondaryRequiresPrice.value
        ? cashOrderSecondaryPrice.value
        : undefined,
    ippanMarginPaymentLimit: cashOrderIppanMarginPaymentLimit.value,
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
        market: cashOrderRequestMarket.value,
        side: tradeSide.value,
        kind: cashOrderKind.value,
        preOrderMarket: cashOrderPreOrderMarket.value,
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
        market: selectedStock.value.market,
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
    if (!order.orderNumber) {
      reportDataError('注文番号を取得できないため取消できません')
      return
    }
    const key = orderHistoryKey(order)
    if (cancelingOrderKey.value) return
    cancelingOrderKey.value = key
    try {
      const params = {
        orderNumber: order.orderNumber,
        orderId: order.id,
        tradeId: order.tradeId || undefined,
      }
      await rpcCall('orders.cash.placeCancel', {
        ...params,
        allowTrading: true,
      })
      order.status = '取消済'
      await loadTradingData()
    } catch (cause) {
      reportDataError(errorMessage(cause, '注文取消に失敗しました'), cause)
    } finally {
      cancelingOrderKey.value = ''
    }
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
  watch(orderKind, () => {
    cashOrderMarket.value = 'auto'
    cashOrderPriceCondition.value = 'market'
    cashOrderTerm.value = 'day'
    cashOrderDateInput.value = ''
    cashOrderMethod.value = 'normal'
    cashOrderTriggerPriceInput.value = ''
    cashOrderSecondaryPriceInput.value = ''
    priceInput.value = ''
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
    selectedStockId,
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
    cancelingOrderKey,
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
    selectStockByCode,
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
