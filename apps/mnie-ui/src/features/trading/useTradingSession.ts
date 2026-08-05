import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  createRpcSocket,
  getPortfolioOverview,
  listHistory,
  listLatestAssetValuations,
  type AccountProfile,
  type AssetValuation,
  type ProviderDefinition,
  type PortfolioOverview,
} from '../../api'
import {
  cashOrderAccountTypeOptions as defaultCashOrderAccountTypeOptions,
  cashOrderMarketOptions as defaultCashOrderMarketOptions,
  searchableMarkets,
} from '../../constants/trade'
import { countryTimeZones, marketSessions, marketTimeZones } from '../../constants/market'
import { profileColor } from '../../constants/provider'
import type {
  ChartMode,
  AmountSellMode,
  ChartRange,
  ChartNotice,
  CashOrderAccountType,
  CashOrderMarket,
  CashOrderMethod,
  CashOrderPriceCondition,
  CashOrderTerm,
  CashOrderTriggerZone,
  JsonRpcResponse,
  MarketIndex,
  OrderDetail,
  OrderKind,
  OrderPreview,
  OrderRow,
  Position,
  ProviderPosition,
  RealtimePricePoint,
  RpcMessage,
  Stock,
  TradeRecordRow,
  TradeSide,
} from '../../types/trading'
import {
  asArray,
  asRecord,
  emptyStock,
  fulfilledValues,
  groupBrokerageAssets,
  homeAssetHistoryFrom,
  isOrderPreview,
  issueFrom,
  marketDateKey,
  marketIndexFromApi,
  mergeInvestmentInstrument,
  numberValue,
  orderDetailFromApi,
  orderFromApi,
  orderHistoryKey,
  orderSizingForSide,
  chartNoticeFromIssueChart,
  pricePointsFromIssueChart,
  positionFromApi,
  positionsForStock,
  stockFromBoard,
  stockFromIssue,
  stockFromInvestmentInstrument,
  stockFromPosition,
  tradeRecordFromApi,
  uniqueStocksByIdentity,
  textValue,
  type RecordLike,
} from './trading-data'
import { tradeAdapterFor, type AmountOrderDraft } from './trade-adapters'

interface RpcResolver {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

interface CashOrderTermOption {
  label: string
  value: CashOrderTerm
}

interface CashOrderAccountTypeOption {
  label: string
  value: CashOrderAccountType
}

interface CashOrderMarketOption {
  label: string
  value: CashOrderMarket
}

interface CashOrderDateOption {
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
const isUsMarket = (market: string) => usMarkets.has(market)
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

export const useTradingSession = (
  selectedProfileId: Ref<string>,
  profiles: Ref<AccountProfile[]>,
  providerDefinitions: Ref<ProviderDefinition[]>,
) => {
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
  const amountInput = ref('')
  const amountSellMode = ref<AmountSellMode>('amount')
  const selectedHoldingId = ref('')
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
  const orderNotice = ref('')
  const orderError = ref('')
  const orderBusy = ref(false)
  const previewNow = ref(Date.now())
  const previewTimer = window.setInterval(() => (previewNow.value = Date.now()), 1_000)
  onUnmounted(() => window.clearInterval(previewTimer))
  const cashPreOrder = ref<RecordLike | null>(null)
  const ws = ref<WebSocket | null>(null)
  const providerOperations = ref(new Set<string>())
  const providerOrderRules = ref<RecordLike>({})
  const providerAccountId = ref('')
  const rpcPending = new Map<number, RpcResolver>()
  let profileInteractionId = ''
  const profileConnected = ref(false)
  const connectedProfileId = ref('')
  const smbcQrUrl = ref('')
  const smbcUrl = ref('')
  const smbcBalance = ref<{ amount: number; displayValue: string } | null>(null)
  const dataLoading = ref(false)
  const searchLoading = ref(false)
  const storedTotalAssetValue = ref<number | null>(null)
  const storedBrokerageHoldingsValue = ref(0)
  const storedBrokerageCashValue = ref(0)
  const quoteLoading = ref(false)
  const assetValuations = ref<AssetValuation[]>([])
  const assetHistory = ref<
    Array<{
      at: string
      profileId: string
      groupId: string
      label: string
      value: number
      color: string
    }>
  >([])
  const storedAssetsLoaded = ref(false)
  const assetHistoryLoading = ref(false)
  const buyingPower = ref(0)
  const holdingsMarketValue = ref(0)
  const totalProfitLoss = ref(0)
  const totalProfitLossRate = ref(0)
  const marketIndexes = ref<MarketIndex[]>([])
  const orders = ref<OrderRow[]>([])
  const cancelingOrderKey = ref('')
  const orderHistoryLoaded = ref(false)
  const orderHistoryNotice = ref('')
  const positions = ref<Position[]>([])
  const storedProviderPositions = ref<ProviderPosition[]>([])
  const portfolioPositions = ref<Position[]>([])
  const portfolioOrders = ref<OrderRow[]>([])
  const portfolioOverview = ref<PortfolioOverview | null>(null)
  const portfolioOverviewLoading = ref(false)
  const portfolioOrderHistoryNotice = ref('')
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
  let instrumentDetailRequestId = 0
  let connectingProfileId = ''

  const maxRealtimePricePoints = 120
  const errorMessage = (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback

  const isExpectedRpcInterruption = (cause: unknown) =>
    cause instanceof Error &&
    (cause.message === 'RPC socket reconnecting' ||
      cause.message === 'RPC socket closed' ||
      (dataLoading.value && cause.message === '証券口座に接続されていません'))

  const stockId = (stock: Pick<Stock, 'code' | 'market'>) =>
    stock.market ? `${stock.market}:${stock.code}` : stock.code

  const stockRefFromId = (id: string) => {
    const normalized = id.trim()
    const separator = normalized.indexOf(':')
    if (separator <= 0) return { code: normalized, market: '' }

    const market = normalized.slice(0, separator)
    const code = normalized.slice(separator + 1)
    if (!code) return { code: normalized, market: '' }
    return { code, market }
  }

  const codeFromStockId = (id: string) => stockRefFromId(id).code

  const reportDataError = (message: string, cause?: unknown) => {
    if (isExpectedRpcInterruption(cause)) return
    if (cause) {
      console.error(`[mnie-ui] データ取得エラー: ${message}`, cause)
      return
    }
    console.error(`[mnie-ui] データ取得エラー: ${message}`)
  }

  const selectedStock = computed(() => {
    const selectedRef = stockRefFromId(selectedStockId.value)
    const exact = stockById.value.get(selectedStockId.value)
    const codeMatch = stockByCode.value.get(selectedStockCode.value)

    // A route may contain only an issue code (for example `/trade/1306`). In that
    // case a previously created market-less placeholder must not shadow the
    // market-qualified issue loaded from search, positions, or the watchlist.
    if (!selectedRef.market && !exact?.market && codeMatch?.market) return codeMatch

    const symbolMatch = stocks.value.find((stock) => stock.symbol === selectedStockId.value)
    const resolvedExact = exact ?? symbolMatch
    if (resolvedExact) return resolvedExact

    if (!selectedRef.market) {
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
  const connected = computed(() => profileConnected.value && socketReady.value)
  const orderInputMode = computed(() =>
    asArray(providerOrderRules.value.sizing).some(
      (sizing) => textValue(asRecord(sizing).kind) === 'amount',
    )
      ? ('amount' as const)
      : ('quantity' as const),
  )
  const tradeAdapter = computed(() => tradeAdapterFor(orderInputMode.value))
  const orderQuantity = computed(() => Number(quantityInput.value || 0))
  const orderAmount = computed(() => Number(amountInput.value || 0))
  const amountSizing = computed(() =>
    orderSizingForSide(providerOrderRules.value.sizing, 'amount', tradeSide.value),
  )
  const orderAmountMinimum = computed(() => numberValue(amountSizing.value?.minimum, 1))
  const orderAmountIncrement = computed(() => numberValue(amountSizing.value?.increment, 1))
  const selectedHolding = computed(() =>
    positions.value.find((position) => position.id === selectedHoldingId.value),
  )
  const amountOrderDraft = (): AmountOrderDraft => ({
    profileId: selectedProfileId.value,
    side: tradeSide.value,
    stock: selectedStock.value,
    holding: selectedHolding.value,
    accountType: cashOrderAccountType.value,
    amount: amountInput.value,
    sellAll: tradeSide.value === 'sell' && amountSellMode.value === 'all',
  })
  const chartAvailable = computed(() => providerOperations.value.has('market.issue.chart'))
  const searchQuotesAvailable = computed(() => providerOperations.value.has('market.issue.board'))
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
    if (cashOrderKind.value !== 's') return true
    return asRecord(cashPreOrder.value?.sKabu).available === true
  })
  const cashOrderIppanMarginPaymentLimit = computed(() => {
    const margin = cashPreOrder.value ? asRecord(cashPreOrder.value.margin) : {}
    return textValue(margin.ippanPaymentLimit) || undefined
  })
  const cashOrderAccountTypeOptions = computed<CashOrderAccountTypeOption[]>(() => {
    const available = new Set(
      asArray(cashPreOrder.value?.accountTypes ?? providerOrderRules.value.accountTypes).map(
        (value) => textValue(value),
      ),
    )
    if (available.size) {
      return defaultCashOrderAccountTypeOptions.filter((option) => available.has(option.value))
    }
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
    if (terms.some((term) => term === 'day' || term === 'session' || term === '当日中')) {
      options.push({ label: '当日中', value: 'day' })
    }
    if (terms.some((term) => term === 'week' || term === '今週中')) {
      options.push({ label: '今週中', value: 'week' })
    }
    if (
      terms.includes('date') ||
      apkOrderTermDates.value.length ||
      terms.some((term) => /\d/.test(term))
    ) {
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
  const showPortfolioSpinner = computed(() => !storedAssetsLoaded.value)
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
  const amountOrderKey = computed(() =>
    JSON.stringify({
      profileId: selectedProfileId.value,
      side: tradeSide.value,
      instrumentId:
        tradeSide.value === 'sell' ? selectedHolding.value?.code : selectedStock.value.code,
      accountType:
        tradeSide.value === 'sell'
          ? selectedHolding.value?.accountType
          : cashOrderAccountType.value,
      positionId: tradeSide.value === 'sell' ? selectedHolding.value?.id : undefined,
      sellMode: amountSellMode.value,
      amount: amountInput.value,
    }),
  )
  const activeOrderKey = computed(() =>
    orderInputMode.value === 'amount' ? amountOrderKey.value : cashOrderKey.value,
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
  const canRequestOrderEstimate = computed(() => {
    if (orderInputMode.value === 'quantity') return canRequestCashEstimate.value
    if (!connected.value || !providerOperations.value.has('investments.orders.preview'))
      return false
    if (tradeSide.value === 'buy' && !selectedStock.value.code) return false
    if (tradeSide.value === 'sell' && !selectedHolding.value) return false
    return tradeSide.value === 'sell' && amountSellMode.value === 'all'
      ? true
      : Number.isSafeInteger(orderAmount.value) &&
          orderAmount.value >= orderAmountMinimum.value &&
          orderAmount.value % orderAmountIncrement.value === 0
  })
  const previewExpired = computed(
    () =>
      Boolean(lastCashEstimate.value?.expiresAt) &&
      previewNow.value >= Date.parse(lastCashEstimate.value!.expiresAt!),
  )
  const canPlaceCashOrder = computed(
    () =>
      canRequestOrderEstimate.value &&
      Boolean(lastCashEstimate.value) &&
      lastCashEstimateKey.value === activeOrderKey.value &&
      !previewExpired.value &&
      !orderBusy.value,
  )
  const countries = computed(() => [...new Set(stocks.value.map((stock) => stock.country))])
  const markets = computed(() => {
    const discovered = stocks.value.map((stock) => stock.market).filter(Boolean)
    if (providerOperations.value.has('investments.instruments.search')) {
      return [...new Set(discovered)]
    }
    return [...new Set([...searchableMarkets.filter((market) => market !== 'auto'), ...discovered])]
  })
  const stockById = computed(() => new Map(stocks.value.map((stock) => [stockId(stock), stock])))
  const stockByCode = computed(() => new Map(stocks.value.map((stock) => [stock.code, stock])))
  const viewedStocks = computed(() =>
    uniqueStocksByIdentity(
      viewedStockCodes.value
        .map((code) => stockById.value.get(code) ?? stockByCode.value.get(code))
        .filter((stock): stock is Stock => Boolean(stock)),
    ),
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
            stock.symbol.toLowerCase().includes(query) ||
            stock.searchText?.toLowerCase().includes(query)
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
  const sellPositions = computed(() => positionsForStock(positions.value, selectedStock.value))
  const recentOrders = computed(() => orders.value.slice(0, 2))
  const portfolioRecentOrders = computed(() =>
    [...portfolioOrders.value].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
  )
  const loadPortfolioOverview = async () => {
    portfolioOverviewLoading.value = true
    portfolioOrderHistoryNotice.value = ''
    try {
      const overview = await getPortfolioOverview()
      portfolioOverview.value = overview
      portfolioPositions.value = overview.components.flatMap((component) =>
        (component.positions ?? []).flatMap((item) => {
          const parsed = positionFromApi(item)
          return parsed
            ? [
                {
                  ...parsed,
                  profileId: component.profile.id,
                  profileLabel: component.profile.label,
                  providerId: component.profile.provider.id,
                  providerName: component.profile.provider.name,
                },
              ]
            : []
        }),
      )
      portfolioOrders.value = overview.components.flatMap((component) =>
        (component.orders ?? []).flatMap((item) => {
          const parsed = orderFromApi(item)
          return parsed
            ? [
                {
                  ...parsed,
                  cancelable: false,
                  profileId: component.profile.id,
                  profileLabel: component.profile.label,
                  providerId: component.profile.provider.id,
                  providerName: component.profile.provider.name,
                },
              ]
            : []
        }),
      )
      const orderHistoryErrors = overview.errors.filter(
        (item) => item.operation === 'investments.orders.list',
      )
      if (orderHistoryErrors.length) {
        portfolioOrderHistoryNotice.value = orderHistoryErrors
          .map((item) => `${item.providerId} (${item.operation}): ${item.message}`)
          .join('; ')
      }
    } finally {
      portfolioOverviewLoading.value = false
    }
  }

  const brokerageOverviewComponents = computed(
    () =>
      portfolioOverview.value?.components.filter((item) => item.profile.category === 'brokerage') ??
      [],
  )
  const componentHoldingsValue = (item: (typeof brokerageOverviewComponents.value)[number]) =>
    Number(item.valuation?.holdingsAmount?.value ?? 0)
  const componentCashValue = (item: (typeof brokerageOverviewComponents.value)[number]) =>
    Number(
      item.valuation?.cashAmount?.value ??
        Math.max(Number(item.valuation?.amount.value ?? 0) - componentHoldingsValue(item), 0),
    )
  const portfolioHoldingsMarketValue = computed(() =>
    brokerageOverviewComponents.value.reduce((sum, item) => sum + componentHoldingsValue(item), 0),
  )
  const portfolioBuyingPower = computed(() =>
    brokerageOverviewComponents.value.reduce((sum, item) => sum + componentCashValue(item), 0),
  )
  const portfolioBrokerageAssetBreakdown = computed(() =>
    groupBrokerageAssets(
      brokerageOverviewComponents.value.map((item) => {
        const profile = profiles.value.find((candidate) => candidate.id === item.profile.id)
        return {
          providerId: item.profile.provider.id,
          providerName: item.profile.provider.name,
          color: profile ? profileColor(profile) : item.profile.defaultColor,
          holdingsValue: componentHoldingsValue(item),
          cashValue: componentCashValue(item),
        }
      }),
    ),
  )
  const portfolioValuesByProfile = computed(() => {
    const values = new Map(
      assetValuations.value
        .filter((item) => item.currency === 'JPY' && Number.isFinite(item.value))
        .map((item) => [item.profileId, item.value]),
    )
    for (const component of portfolioOverview.value?.components ?? []) {
      if (component.valuation?.amount.currency !== 'JPY') continue
      const value = Number(component.valuation.amount.value)
      if (Number.isFinite(value)) values.set(component.profile.id, value)
    }
    return values
  })
  const totalAssetValue = computed(() =>
    [...portfolioValuesByProfile.value.values()].reduce((sum, value) => sum + value, 0),
  )
  const portfolioTotalProfitLoss = computed(() =>
    portfolioPositions.value.reduce((sum, position) => sum + position.profitLoss, 0),
  )
  const portfolioTotalProfitLossRate = computed(() => {
    const cost = portfolioPositions.value.reduce(
      (sum, position) => sum + position.marketValue - position.profitLoss,
      0,
    )
    return cost ? (portfolioTotalProfitLoss.value / cost) * 100 : 0
  })

  const loadStoredAssetValuations = async () => {
    assetHistoryLoading.value = true
    try {
      const from = homeAssetHistoryFrom()
      const valuationsPromise = listLatestAssetValuations()
        .then(({ valuations }) => {
          assetValuations.value = valuations
          const jpy = valuations.filter((item) => item.currency === 'JPY')
          storedTotalAssetValue.value = jpy.length
            ? jpy.reduce((sum, item) => sum + item.value, 0)
            : null
          storedBrokerageHoldingsValue.value = jpy.reduce(
            (sum, item) => sum + (item.holdingsValue ?? 0),
            0,
          )
          storedBrokerageCashValue.value = jpy.reduce((sum, item) => sum + (item.cashValue ?? 0), 0)
        })
        .finally(() => {
          storedAssetsLoaded.value = true
        })
      const historyPromise = listHistory({ from, kinds: ['snapshot', 'transaction'] })
        .then((history) => {
          const profileFor = (profileId: string) => {
            const profile = profiles.value.find((item) => item.id === profileId)
            if (!profile) throw new Error(`History profile was not found: ${profileId}`)
            return profile
          }
          const sortedHistory = history.items.sort((a, b) =>
            a.occurredAt.localeCompare(b.occurredAt),
          )
          const latestPositionSnapshots = new Map<string, (typeof history.items)[number]>()
          for (const item of sortedHistory) {
            if (item.kind === 'snapshot' && item.profileId && item.snapshot?.positions) {
              latestPositionSnapshots.set(item.profileId, item)
            }
          }
          storedProviderPositions.value = [...latestPositionSnapshots.entries()].flatMap(
            ([profileId, item]) => {
              const profile = profileFor(profileId)
              const providerName =
                providerDefinitions.value.find((provider) => provider.id === profile.provider)
                  ?.name ?? profile.provider
              return (item.snapshot?.positions ?? []).flatMap((raw) => {
                const position = positionFromApi(raw)
                return position
                  ? [
                      {
                        ...position,
                        profileId,
                        profileLabel: profile.label,
                        providerId: profile.provider,
                        providerName,
                        color: profileColor(profile),
                      },
                    ]
                  : []
              })
            },
          )
          const historyValues = new Map<string, number>()
          const historyGroup = (profileId: string) => {
            const profile = profiles.value.find((candidate) => candidate.id === profileId)
            return profile?.category === 'brokerage'
              ? {
                  groupId: `provider:${profile.provider}`,
                  label: profile.providerName,
                  color: profileColor(profile),
                }
              : {
                  groupId: profileId,
                  label: profile?.label ?? profileId,
                  color: profileColor(
                    profile ?? {
                      provider: 'sbisec',
                      color: null,
                    },
                  ),
                }
          }
          const forwardPoints = sortedHistory.flatMap((item) => {
            if (!item.profileId) return []
            let value: number | undefined
            if (item.kind === 'snapshot') {
              value = Number(item.snapshot?.valuation?.amount.value)
            } else if (item.kind === 'transaction' && item.transaction) {
              const transaction = item.transaction
              const balanceAfter = Number(transaction.balanceAfter?.money.value)
              if (Number.isFinite(balanceAfter)) {
                value = balanceAfter
              } else if (transaction.type !== 'investment-trade') {
                const amount = Number(transaction.amount?.money.value)
                const current = historyValues.get(item.profileId)
                if (
                  current != null &&
                  Number.isFinite(amount) &&
                  transaction.direction !== 'neutral'
                ) {
                  value = current + (transaction.direction === 'credit' ? amount : -amount)
                }
              }
            }
            if (value == null || !Number.isFinite(value)) return []
            historyValues.set(item.profileId, value)
            const group = historyGroup(item.profileId)
            return [
              {
                at: item.occurredAt,
                profileId: item.profileId,
                groupId: group.groupId,
                label: group.label,
                value,
                color: group.color,
              },
            ]
          })
          const backwardPoints = [
            ...new Set(sortedHistory.flatMap((item) => item.profileId ?? [])),
          ].flatMap((profileId) => {
            const profileHistory = sortedHistory.filter((item) => item.profileId === profileId)
            const firstSnapshotIndex = profileHistory.findIndex(
              (item) =>
                item.kind === 'snapshot' &&
                Number.isFinite(Number(item.snapshot?.valuation?.amount.value)),
            )
            if (firstSnapshotIndex < 0) return []
            let value = Number(
              profileHistory[firstSnapshotIndex]?.snapshot?.valuation?.amount.value,
            )
            const transactionGroups = Map.groupBy(
              profileHistory
                .slice(0, firstSnapshotIndex)
                .filter((item) => item.kind === 'transaction' && item.transaction),
              (item) => item.occurredAt,
            )
            return [...transactionGroups.entries()].reverse().map(([occurredAt, items]) => {
              const explicitBalance = items
                .map((item) => Number(item.transaction?.balanceAfter?.money.value))
                .find(Number.isFinite)
              if (explicitBalance != null) value = explicitBalance
              const pointValue = value
              for (const item of items) {
                const transaction = item.transaction
                if (!transaction) continue
                const amount = Number(transaction.amount?.money.value)
                if (
                  explicitBalance == null &&
                  transaction.type !== 'investment-trade' &&
                  Number.isFinite(amount) &&
                  transaction.direction !== 'neutral'
                ) {
                  value -= transaction.direction === 'credit' ? amount : -amount
                }
              }
              const group = historyGroup(profileId)
              return {
                at: occurredAt,
                profileId,
                groupId: group.groupId,
                label: group.label,
                value: pointValue,
                color: group.color,
              }
            })
          })
          assetHistory.value = [...backwardPoints, ...forwardPoints].sort((a, b) =>
            a.at.localeCompare(b.at),
          )
          const unexpectedErrors = history.errors.filter(
            (item) => item.reason !== 'INTERACTION_REQUIRED',
          )
          if (unexpectedErrors.length) {
            reportDataError(
              unexpectedErrors.map((item) => `${item.providerId}: ${item.message}`).join('; '),
            )
          }
        })
        .finally(() => {
          assetHistoryLoading.value = false
        })
      const [valuationsResult, historyResult] = await Promise.allSettled([
        valuationsPromise,
        historyPromise,
      ])
      const failure = [valuationsResult, historyResult].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (failure) throw failure.reason
    } finally {
      storedAssetsLoaded.value = true
      assetHistoryLoading.value = false
    }
  }
  const otherAssetBreakdown = computed(() =>
    assetValuations.value
      .filter(
        (item) => item.currency === 'JPY' && item.holdingsValue == null && item.cashValue == null,
      )
      .map((item) => ({
        profileId: item.profileId,
        label:
          profiles.value.find((profile) => profile.id === item.profileId)?.label ?? item.provider,
        provider: item.provider,
        color: profileColor(
          profiles.value.find((profile) => profile.id === item.profileId) ?? {
            provider: item.provider,
            color: null,
          },
        ),
        value: item.value,
        ratio: totalAssetValue.value ? (item.value / totalAssetValue.value) * 100 : 0,
      })),
  )
  const providerHoldingsBreakdown = computed(() => {
    const providerNames = new Map(
      providerDefinitions.value.map((provider) => [provider.id, provider.name]),
    )
    const grouped = new Map<
      string,
      { providerId: string; label: string; value: number; color: string; profiles: number }
    >()
    for (const valuation of assetValuations.value) {
      if (valuation.currency !== 'JPY' || valuation.holdingsValue == null) continue
      const profile = profiles.value.find((candidate) => candidate.id === valuation.profileId)
      const providerId = profile?.provider ?? valuation.provider
      const current = grouped.get(providerId)
      grouped.set(providerId, {
        providerId,
        label: current?.label ?? providerNames.get(providerId) ?? providerId,
        value: (current?.value ?? 0) + valuation.holdingsValue,
        color: current?.color ?? profileColor(profile ?? { provider: providerId, color: null }),
        profiles: (current?.profiles ?? 0) + 1,
      })
    }
    return [...grouped.values()].sort((a, b) => b.value - a.value)
  })
  const portfolioOtherAssetBreakdown = computed(() =>
    profiles.value
      .filter((profile) => profile.category !== 'brokerage')
      .flatMap((profile) => {
        const value = portfolioValuesByProfile.value.get(profile.id)
        if (value == null) return []
        return [
          {
            profileId: profile.id,
            label: profile.label,
            provider: profile.provider,
            color: profileColor(profile),
            value,
            ratio: totalAssetValue.value ? (value / totalAssetValue.value) * 100 : 0,
          },
        ]
      }),
  )
  const stockAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (portfolioHoldingsMarketValue.value / totalAssetValue.value) * 100
  })
  const cashAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (portfolioBuyingPower.value / totalAssetValue.value) * 100
  })
  const selectedStockTimeZone = computed(() => timeZoneForStock(selectedStock.value))
  const selectedStockProviderPositions = computed<ProviderPosition[]>(() => {
    const selectedProfile = profiles.value.find((profile) => profile.id === selectedProfileId.value)
    const providerName = selectedProfile
      ? (providerDefinitions.value.find((provider) => provider.id === selectedProfile.provider)
          ?.name ?? selectedProfile.provider)
      : ''
    const live = selectedProfile
      ? positions.value.map((position) => ({
          ...position,
          profileId: selectedProfile.id,
          profileLabel: selectedProfile.label,
          providerId: selectedProfile.provider,
          providerName,
          color: profileColor(selectedProfile),
        }))
      : []
    return [
      ...storedProviderPositions.value.filter(
        (position) => position.profileId !== selectedProfileId.value,
      ),
      ...live,
    ]
      .filter(
        (position) =>
          position.code === selectedStock.value.code &&
          (!selectedStock.value.market ||
            !position.market ||
            position.market === selectedStock.value.market),
      )
      .sort((a, b) => b.marketValue - a.marketValue)
  })
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
    if (subscriptionId && providerOperations.value.has('market.issue.pollBoard.unsubscribe')) {
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
      const rpcError = new Error(response.error.message || 'RPC request failed') as Error & {
        providerCode?: string
      }
      rpcError.providerCode = response.error.data?.providerCode
      pending.reject(rpcError)
    } else {
      pending.resolve(response.result)
    }
  }

  const call = (method: string, params?: unknown) => {
    const socket = ws.value
    if (!socket || socket.readyState !== WebSocket.OPEN) return undefined
    const controlMethod =
      method.startsWith('provider.') ||
      method.startsWith('profile.') ||
      method.startsWith('workspace.') ||
      method === 'rpc.methods'
    const payload: RpcMessage = controlMethod
      ? { id: ++rpcId, method, params }
      : {
          id: ++rpcId,
          method: 'profile.invoke',
          params: { profileId: selectedProfileId.value, operation: method, input: params ?? {} },
        }
    socket.send(JSON.stringify({ jsonrpc: '2.0', ...payload }))
    return payload.id
  }

  const rpcCall = async <T>(method: string, params?: unknown): Promise<T> => {
    const id = call(method, params)
    if (!id) throw new Error('証券口座に接続されていません')
    return new Promise<T>((resolve, reject) => {
      rpcPending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
  }

  const invokeProvider = (method: string, params?: unknown) => rpcCall(method, params)

  const rpcCallOptional = async <T>(
    method: string,
    params?: unknown,
    timeoutMs = 8_000,
  ): Promise<T> => {
    const id = call(method, params)
    if (!id) throw new Error('証券口座に接続されていません')
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
        searchText: stock.searchText || current?.searchText || '',
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

  const loadSelectedStockDetail = async () => {
    const stock = selectedStock.value
    if (!stock.code || !providerOperations.value.has('investments.instruments.get')) {
      quoteLoading.value = false
      return
    }
    const requestId = ++instrumentDetailRequestId
    quoteLoading.value = true
    try {
      const detail = await rpcCall<unknown>('investments.instruments.get', {
        instrumentId: stock.code,
      })
      if (requestId !== instrumentDetailRequestId) return
      const merged = mergeInvestmentInstrument(stock, detail)
      mergeStocks([merged])
      selectStock(merged)
    } catch (cause) {
      reportDataError(errorMessage(cause, '現在価格を取得できませんでした'), cause)
    } finally {
      if (requestId === instrumentDetailRequestId) quoteLoading.value = false
    }
  }

  const loadOrderHistoryFromSdk = async () => {
    orderHistoryLoaded.value = false
    orderHistoryNotice.value = ''
    if (!providerOperations.value.has('investments.orders.list')) {
      orders.value = []
      orderHistoryLoaded.value = true
      return
    }
    const orderList = await rpcCallOptional<RecordLike>('investments.orders.list')
    const nextOrders = asArray(orderList.items)
      .map(orderFromApi)
      .filter((order): order is OrderRow => Boolean(order))

    const deduped = new Map<string, OrderRow>()
    for (const order of nextOrders) deduped.set(orderHistoryKey(order), order)
    orders.value = [...deduped.values()]
    orderHistoryLoaded.value = true
  }

  const optionalNumber = (value: unknown) => {
    const parsed = numberValue(value, Number.NaN)
    return Number.isFinite(parsed) ? parsed : null
  }

  const applyAccountAssets = (value: RecordLike) => {
    const valuation = optionalNumber(asRecord(value.amount).value)
    const valuationWithoutDeposit = optionalNumber(asRecord(value.holdingsAmount).value)
    const profitLoss = null
    const profitLossRate = null

    if (valuationWithoutDeposit !== null) holdingsMarketValue.value = valuationWithoutDeposit
    if (valuation !== null && valuationWithoutDeposit !== null) {
      buyingPower.value = Math.max(valuation - valuationWithoutDeposit, 0)
    }
    if (profitLoss !== null) totalProfitLoss.value = profitLoss
    if (profitLossRate !== null) totalProfitLossRate.value = profitLossRate
  }

  const enrichStocksWithInstrumentDetails = async (
    baseStocks: Stock[],
    fallbackMessage: string,
  ) => {
    if (!providerOperations.value.has('investments.instruments.get')) return
    const uniqueStocks = uniqueStocksByIdentity(baseStocks)
    const concurrency = 4
    for (let offset = 0; offset < uniqueStocks.length; offset += concurrency) {
      const batch = uniqueStocks.slice(offset, offset + concurrency)
      const details = await Promise.allSettled(
        batch.map(async (stock) => {
          const detail = await rpcCallOptional<unknown>(
            'investments.instruments.get',
            { instrumentId: stock.code },
            15_000,
          )
          return mergeInvestmentInstrument(stock, detail)
        }),
      )
      mergeStocks(
        details
          .filter(
            (result): result is PromiseFulfilledResult<Stock> => result.status === 'fulfilled',
          )
          .map((result) => result.value),
      )
      for (const result of details) {
        if (result.status === 'rejected') {
          reportDataError(errorMessage(result.reason, fallbackMessage), result.reason)
        }
      }
    }
  }

  const enrichPositionStocks = (currentPositions: Position[]) =>
    enrichStocksWithInstrumentDetails(
      currentPositions.map(stockFromPosition),
      '保有銘柄の現在価格を取得できませんでした',
    )

  const loadTradingData = async () => {
    dataLoading.value = true
    try {
      const [accountsResult, assetsResult, positionsResult, balancesResult, indexesResult] =
        await Promise.allSettled([
          providerOperations.value.has('accounts.list')
            ? rpcCallOptional<RecordLike>('accounts.list', undefined, 15_000)
            : Promise.resolve(undefined),
          providerOperations.value.has('assets.valuation.get')
            ? rpcCallOptional<RecordLike>('assets.valuation.get', undefined, 20_000)
            : Promise.resolve(undefined),
          providerOperations.value.has('investments.positions.list')
            ? rpcCallOptional<RecordLike>('investments.positions.list', undefined, 15_000)
            : Promise.resolve(undefined),
          providerOperations.value.has('balances.list')
            ? rpcCallOptional<unknown[]>('balances.list', undefined, 15_000)
            : Promise.resolve(undefined),
          providerOperations.value.has('market.index.major')
            ? rpcCallOptional<unknown[]>('market.index.major', undefined, 15_000)
            : Promise.resolve(undefined),
        ])
      if (accountsResult.status === 'fulfilled' && accountsResult.value) {
        providerAccountId.value = textValue(asRecord(asArray(accountsResult.value.items)[0]).id)
      }
      marketIndexes.value =
        indexesResult.status === 'fulfilled' && indexesResult.value
          ? indexesResult.value
              .map(marketIndexFromApi)
              .filter((index): index is MarketIndex => Boolean(index))
          : []
      const positionList =
        positionsResult.status === 'fulfilled' && positionsResult.value ? positionsResult.value : {}
      const nextPositions = asArray(positionList.items)
        .map(positionFromApi)
        .filter((position): position is Position => Boolean(position))
      positions.value = nextPositions
      mergeStocks(nextPositions.map(stockFromPosition))
      await enrichPositionStocks(nextPositions)
      await loadSelectedStockDetail()
      const summedHoldingsMarketValue = nextPositions.reduce(
        (sum, position) => sum + position.marketValue,
        0,
      )
      const summedProfitLoss = nextPositions.reduce((sum, position) => sum + position.profitLoss, 0)
      const summedCostBasis = nextPositions.reduce(
        (sum, position) => sum + (position.marketValue - position.profitLoss),
        0,
      )
      const nextHoldingsMarketValue = nextPositions.length > 0 ? summedHoldingsMarketValue : 0
      holdingsMarketValue.value = nextHoldingsMarketValue
      totalProfitLoss.value = nextPositions.length > 0 ? summedProfitLoss : 0
      totalProfitLossRate.value =
        nextPositions.length > 0 && summedCostBasis ? (summedProfitLoss / summedCostBasis) * 100 : 0

      const hasAccountAssets = assetsResult.status === 'fulfilled' && Boolean(assetsResult.value)
      if (hasAccountAssets) {
        applyAccountAssets(assetsResult.value!)
      } else if (
        providerOperations.value.has('assets.valuation.get') &&
        assetsResult.status === 'rejected'
      ) {
        reportDataError(
          errorMessage(assetsResult.reason, 'My資産の取得に失敗しました'),
          assetsResult.reason,
        )
      }

      const orderHistoryResult = await Promise.allSettled([loadOrderHistoryFromSdk()])
      const powerResult = balancesResult

      if (!hasAccountAssets && powerResult.status === 'fulfilled' && powerResult.value) {
        const balance = asArray(powerResult.value)
          .map(asRecord)
          .find((item) => item.type === 'buying-power' || item.type === 'withdrawable')
        buyingPower.value = numberValue(asRecord(asRecord(balance?.amount).money).value)
      }
      if (orderHistoryResult[0]?.status === 'rejected') {
        reportDataError(
          errorMessage(orderHistoryResult[0].reason, '取引履歴の取得に失敗しました'),
          orderHistoryResult[0].reason,
        )
      }
    } finally {
      dataLoading.value = false
    }
  }

  const loadProviderOrderRules = async (profileId: string) => {
    providerOrderRules.value = {}
    if (!providerOperations.value.has('investments.orders.preview')) return
    const availability = asRecord(
      await rpcCall<RecordLike>('profile.availability', {
        profileId,
        operation: 'investments.orders.preview',
      }),
    )
    const operation = asRecord(asRecord(availability.operations)['investments.orders.preview'])
    if (operation.available !== true) {
      throw new Error(textValue(operation.message, 'このproviderでは注文を利用できません'))
    }
    providerOrderRules.value = asRecord(operation.orderRules)
  }

  const connect = () => {
    // Portfolio/history refresh spans every profile and may require unrelated
    // interactions such as SMBC 2FA. A trading connection must only touch the
    // profile selected below; portfolio data is refreshed by the portfolio flow.
    const selectedProfile = profiles.value.find((profile) => profile.id === selectedProfileId.value)
    if (!selectedProfile) {
      reportDataError('口座プロフィールを選択してください')
      return
    }
    if (
      connectedProfileId.value === selectedProfile.id &&
      profileConnected.value &&
      ws.value?.readyState === WebSocket.OPEN
    ) {
      return
    }
    if (
      connectingProfileId === selectedProfile.id &&
      (ws.value?.readyState === WebSocket.CONNECTING || ws.value?.readyState === WebSocket.OPEN)
    ) {
      return
    }

    const previousSocket = ws.value
    rejectPendingRpc(new Error('RPC socket reconnecting'))
    selectedStockCode.value = ''
    selectedStockId.value = ''
    viewedStockCodes.value = []
    stocks.value = []
    searchQuery.value = ''
    countryFilter.value = 'all'
    marketFilter.value = 'all'
    showSearch.value = false
    positions.value = []
    orders.value = []
    quantityInput.value = ''
    amountInput.value = ''
    amountSellMode.value = 'amount'
    selectedHoldingId.value = ''
    priceInput.value = ''
    lastCashEstimate.value = null
    lastCashEstimateKey.value = ''
    showEstimateDialog.value = false
    showOrderDialog.value = false
    orderNotice.value = ''
    orderError.value = ''
    orderBusy.value = false
    providerOrderRules.value = {}
    instrumentDetailRequestId += 1
    quoteLoading.value = false
    stopBoardPolling()
    previousSocket?.close()
    profileConnected.value = false
    connectedProfileId.value = ''
    smbcQrUrl.value = ''
    smbcUrl.value = ''
    smbcBalance.value = null
    dataLoading.value = true
    connectingProfileId = selectedProfile.id
    const socket = createRpcSocket()
    socket.addEventListener('open', async () => {
      try {
        const connection = (await rpcCall('profile.connect', {
          profileId: selectedProfile.id,
        })) as {
          status: 'connected' | 'interaction-required'
          interaction?: { id: string; kind: string; url?: string; qrUrl?: string }
        }
        if (connection.status === 'interaction-required') {
          if (connection.interaction?.kind !== 'qr' || !connection.interaction.qrUrl) {
            throw new Error('未対応の接続操作が要求されました')
          }
          profileInteractionId = connection.interaction.id
          smbcQrUrl.value = connection.interaction.qrUrl
          smbcUrl.value = connection.interaction.url ?? ''
          return
        }
        providerOperations.value = new Set(
          await rpcCall<string[]>('profile.operations', { profileId: selectedProfile.id }),
        )
        await loadProviderOrderRules(selectedProfile.id)
        profileConnected.value = true
        connectedProfileId.value = selectedProfile.id
        await loadTradingData()
      } catch (cause) {
        profileConnected.value = false
        connectedProfileId.value = ''
        reportDataError(errorMessage(cause, '接続に失敗しました'), cause)
        socket.close()
      } finally {
        if (connectingProfileId === selectedProfile.id) connectingProfileId = ''
        dataLoading.value = false
      }
    })
    socket.addEventListener('message', (event) => handleRpcMessage(String(event.data)))
    socket.addEventListener('error', () => {
      if (ws.value !== socket) return
      reportDataError('証券口座への接続に失敗しました')
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
      profileConnected.value = false
      connectedProfileId.value = ''
      providerOperations.value = new Set()
      providerOrderRules.value = {}
      if (connectingProfileId === selectedProfile.id) connectingProfileId = ''
      dataLoading.value = false
    })
    ws.value = socket
  }

  const finishSmbc2fa = async () => {
    if (!smbcQrUrl.value) throw new Error('SMBC Direct QR approval is not pending')
    dataLoading.value = true
    try {
      if (!profileInteractionId) throw new Error('SMBC Direct interaction is missing')
      await rpcCall('profile.connection.complete', {
        profileId: selectedProfileId.value,
        interactionId: profileInteractionId,
      })
      providerOperations.value = new Set(
        await rpcCall<string[]>('profile.operations', { profileId: selectedProfileId.value }),
      )
      await loadProviderOrderRules(selectedProfileId.value)
      profileConnected.value = true
      connectedProfileId.value = selectedProfileId.value
      await loadTradingData()
      const balances = await rpcCall<RecordLike[]>('balances.list')
      const balance = balances[0]
      smbcBalance.value = {
        amount: numberValue(asRecord(asRecord(asRecord(balance).amount).money).value),
        displayValue: textValue(asRecord(asRecord(asRecord(balance).amount).money).value),
      }
      smbcQrUrl.value = ''
      smbcUrl.value = ''
      profileInteractionId = ''
      return true
    } catch (cause) {
      reportDataError(errorMessage(cause, 'SMBC Direct の認証に失敗しました'), cause)
      return false
    } finally {
      dataLoading.value = false
    }
  }

  const startBoardPolling = async () => {
    stopBoardPolling()
    realtimePricePoints.value = []

    const stock = selectedStock.value
    if (!connected.value || !stock.code || !providerOperations.value.has('market.issue.board'))
      return
    const requestId = ++boardPollingRequestId
    try {
      const board = await rpcCallOptional<RecordLike>(
        'market.issue.board',
        {
          issueCode: stock.code,
          market: stock.market,
        },
        10_000,
      )
      if (requestId !== boardPollingRequestId) return

      const quotedStock = stockFromBoard(board, stock)
      mergeStocks([quotedStock])

      const timeZone = selectedStockTimeZone.value
      if (!timeZone || !isMarketSessionOpen(quotedStock.market, timeZone)) return

      appendRealtimePricePoint(quotedStock.price)
      if (!providerOperations.value.has('market.issue.pollBoard.subscribe')) return

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
    if (!providerOperations.value.has('market.issue.chart')) {
      chartNotice.value = {
        title: '価格データがありません',
        detail: 'この口座では価格チャートを取得できません。',
      }
      return
    }

    const requestId = ++chartHistoryRequestId
    try {
      if (!stock.market) {
        const domesticMarkets: CashOrderMarket[] = ['XTKS', 'XNGO', 'XFKA', 'XSAP']
        const results = await Promise.allSettled(
          domesticMarkets.map((market) =>
            rpcCall<RecordLike>('market.issue.search', {
              query: stock.code,
              market,
              limit: 12,
            }),
          ),
        )
        if (requestId !== chartHistoryRequestId) return

        const matches = fulfilledValues(results)
          .flatMap((result) => asArray(result.issues))
          .map(issueFrom)
          .filter((issue) => issue.code === stock.code && issue.market)
        const matchesByMarket = new Map(matches.map((issue) => [issue.market, issue]))
        if (matchesByMarket.size === 0) {
          throw new Error(`銘柄 ${stock.code} の市場を特定できませんでした`)
        }
        if (matchesByMarket.size > 1) {
          throw new Error(
            `銘柄 ${stock.code} は複数市場に存在します: ${[...matchesByMarket.keys()].join(', ')}`,
          )
        }

        const [resolvedIssue] = matchesByMarket.values()
        if (!resolvedIssue) throw new Error(`銘柄 ${stock.code} の市場を特定できませんでした`)
        const resolvedStock = stockFromIssue(resolvedIssue)
        mergeStocks([resolvedStock])
        selectStock(resolvedStock)
        return
      }

      const chartOptions = chartRangeOptions[chartRange.value]
      const timeZone = selectedStockTimeZone.value
      if (!timeZone) {
        throw new Error(`Unsupported market timezone for ${stock.market || stock.country}`)
      }
      const chart = await rpcCallOptional<RecordLike>(
        'market.issue.chart',
        {
          issueCode: stock.code,
          market: stock.market,
          period: chartOptions.period,
          unit: chartOptions.unit,
          count: chartOptions.count,
        },
        20_000,
      )
      if (requestId !== chartHistoryRequestId) return
      historicalPricePoints.value = pricePointsFromIssueChart(chart, timeZone)
      chartNotice.value = chartNoticeFromIssueChart(chart)
      if (!historicalPricePoints.value.length && !chartNotice.value) {
        chartNotice.value = {
          title: '価格データがありません',
          detail: '選択した期間のチャートデータは返されませんでした。',
        }
      }
    } catch (cause) {
      if (requestId === chartHistoryRequestId) {
        const message = errorMessage(cause, '価格履歴の取得に失敗しました')
        chartNotice.value = { title: '価格履歴の取得に失敗しました', detail: message }
        reportDataError(message, cause)
      }
    }
  }

  const suggestIssues = async (query: string) => {
    if (!connected.value || query.trim().length < 2) return
    if (providerOperations.value.has('investments.instruments.search')) {
      const result = await rpcCall<RecordLike>('investments.instruments.search', {
        query: query.trim(),
        ...(marketFilter.value !== 'all' ? { market: marketFilter.value } : {}),
      })
      const resultStocks = asArray(result.items)
        .map(stockFromInvestmentInstrument)
        .filter((stock): stock is Stock => Boolean(stock))
      mergeStocks(resultStocks)
      await enrichStocksWithInstrumentDetails(
        resultStocks,
        '検索した銘柄の現在価格を取得できませんでした',
      )
      return
    }
    if (!providerOperations.value.has('market.issue.suggest')) return
    const marketsToSearch =
      marketFilter.value !== 'all'
        ? [marketFilter.value as CashOrderMarket]
        : searchableMarkets.filter((market) => market !== 'auto')
    const results = await Promise.allSettled(
      marketsToSearch.map((market) =>
        rpcCall<RecordLike>('market.issue.suggest', { query, market, limit: 12 }),
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

  const selectTradeStock = async (stock: Stock) => {
    selectStock(stock)
    await loadSelectedStockDetail()
  }

  const estimateCashOrder = async () => {
    if (!providerOperations.value.has('investments.orders.preview')) {
      throw new Error('この provider は注文見積に未対応です')
    }
    if (!canRequestOrderEstimate.value) return
    lastCashEstimate.value = null
    lastCashEstimateKey.value = ''
    pendingCashEstimateId.value = null
    orderError.value = ''
    orderNotice.value = ''
    if (orderInputMode.value === 'amount') {
      const adapter = tradeAdapter.value
      if (!adapter.buildPreviewRequest || !adapter.normalizePreview) {
        throw new Error('この provider は金額指定注文の変換に未対応です')
      }
      orderBusy.value = true
      try {
        const draft = amountOrderDraft()
        const preview = await rpcCall<unknown>(
          'investments.orders.preview',
          adapter.buildPreviewRequest(draft),
        )
        lastCashEstimate.value = adapter.normalizePreview(preview, draft)
        lastCashEstimateKey.value = activeOrderKey.value
        showEstimateDialog.value = true
      } catch (cause) {
        orderError.value = errorMessage(cause, '注文プレビューに失敗しました')
        reportDataError(orderError.value, cause)
      } finally {
        orderBusy.value = false
      }
      return
    }
    const preview = asRecord(
      await rpcCall<unknown>('investments.orders.preview', commonCashOrderParams()),
    )
    const normalizedPreview: OrderPreview = {
      issue: { code: selectedStock.value.code, market: selectedStock.value.market },
      side: tradeSide.value,
      quantity: orderQuantity.value,
      price: {
        value: orderPrice.value || null,
        text: orderPrice.value ? String(orderPrice.value) : '成行',
        currency: selectedStockIsUs.value ? 'USD' : 'JPY',
      },
      warnings: asArray(preview.warnings)
        .map((warning) => textValue(warning))
        .filter(Boolean),
      confirmationId: textValue(preview.confirmationToken) || undefined,
    }
    if (isOrderPreview(normalizedPreview)) {
      lastCashEstimate.value = normalizedPreview
      lastCashEstimateKey.value = activeOrderKey.value
      showEstimateDialog.value = true
    }
  }

  const commonCashOrderParams = () => {
    if (!providerAccountId.value) throw new Error('取引口座を取得できません')
    const currency = selectedStockIsUs.value ? 'USD' : 'JPY'
    const limitPrice = cashOrderPrimaryRequiresPrice.value
      ? { currency, value: String(orderPrice.value) }
      : undefined
    const strategy =
      cashOrderMethod.value === 'normal'
        ? { kind: 'single' as const }
        : cashOrderMethod.value === 'stop'
          ? {
              kind: 'stop' as const,
              trigger: {
                condition:
                  cashOrderTriggerZone.value === 'above'
                    ? ('at-or-above' as const)
                    : ('at-or-below' as const),
                price: { currency, value: String(cashOrderTriggerPrice.value) },
              },
            }
          : cashOrderMethod.value === 'oco'
            ? {
                kind: 'oco' as const,
                alternative: {
                  priceType: cashOrderSecondaryRequiresPrice.value
                    ? ('limit' as const)
                    : ('market' as const),
                  limitPrice: cashOrderSecondaryRequiresPrice.value
                    ? { currency, value: String(cashOrderSecondaryPrice.value) }
                    : undefined,
                },
                trigger: {
                  condition:
                    cashOrderTriggerZone.value === 'above'
                      ? ('at-or-above' as const)
                      : ('at-or-below' as const),
                  price: { currency, value: String(cashOrderTriggerPrice.value) },
                },
              }
            : {
                kind: 'ifd' as const,
                exit: {
                  side: tradeSide.value === 'buy' ? ('sell' as const) : ('buy' as const),
                  priceType: 'market' as const,
                },
              }
    return {
      accountId: providerAccountId.value,
      instrumentId: selectedStock.value.code,
      instrumentVenue: cashOrderPreOrderMarket.value,
      side: tradeSide.value,
      quantity: String(orderQuantity.value),
      positionType: 'cash' as const,
      accountType: cashOrderAccountType.value,
      execution: {
        priceType: cashOrderPrimaryRequiresPrice.value ? ('limit' as const) : ('market' as const),
        limitPrice,
        timing: 'realtime' as const,
        venue: cashOrderRequestMarket.value,
        timeInForce: cashOrderTerm.value === 'date' ? ('date' as const) : cashOrderTerm.value,
        expiresOn: cashOrderTerm.value === 'date' ? cashOrderDateInput.value : undefined,
      },
      strategy,
    }
  }

  const refreshCashPreOrder = async () => {
    if (!providerOperations.value.has('investments.orders.preview')) {
      cashPreOrder.value = null
      return
    }
    const requestId = ++cashPreOrderRequestId
    if (!connected.value || !selectedStock.value.code || !resolvedCashOrderMarket.value) {
      cashPreOrder.value = null
      return
    }
    try {
      const availability = asRecord(
        await rpcCall<RecordLike>('profile.availability', {
          profileId: selectedProfileId.value,
          operation: 'investments.orders.preview',
          input:
            orderInputMode.value === 'amount' && canRequestOrderEstimate.value
              ? tradeAdapter.value.buildPreviewRequest?.(amountOrderDraft())
              : orderInputMode.value === 'quantity'
                ? commonCashOrderParams()
                : undefined,
        }),
      )
      const operation = asRecord(asRecord(availability.operations)['investments.orders.preview'])
      if (operation.available !== true) {
        throw new Error(textValue(operation.message, 'この注文は現在利用できません'))
      }
      const rules = asRecord(operation.orderRules)
      providerOrderRules.value = rules
      const preOrder = {
        exchangeList: asArray(rules.venues)
          .map((value) => textValue(value))
          .join(''),
        orderTerms: asArray(rules.timeInForce),
        orderTermDates: asArray(rules.expirationDates),
        accountTypes: asArray(rules.accountTypes),
        sKabu: { available: true },
        priceSteps: asArray(rules.priceIncrements).map((value) => {
          const increment = asRecord(value)
          return {
            from: numberValue(asRecord(increment.upTo).value),
            to: numberValue(asRecord(increment.increment).value),
          }
        }),
      }
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
    if (!providerOperations.value.has('investments.orders.create')) {
      throw new Error('この provider は注文実行に未対応です')
    }
    if (!canPlaceCashOrder.value || !lastCashEstimate.value) return
    if (orderInputMode.value === 'amount') {
      const adapter = tradeAdapter.value
      const confirmationToken = lastCashEstimate.value.confirmationId
      if (!confirmationToken || !adapter.buildCreateRequest) return
      orderBusy.value = true
      orderError.value = ''
      orderNotice.value = ''
      lastCashEstimate.value = null
      lastCashEstimateKey.value = ''
      showEstimateDialog.value = false
      showOrderDialog.value = false
      try {
        const receipt = asRecord(
          await rpcCall<unknown>(
            'investments.orders.create',
            adapter.buildCreateRequest(confirmationToken),
          ),
        )
        orderNotice.value = textValue(receipt.message, '注文を受け付けました。')
        amountInput.value = ''
        await loadTradingData()
      } catch (cause) {
        const providerCode = (cause as Error & { providerCode?: string })?.providerCode
        orderError.value = adapter.errorMessage
          ? adapter.errorMessage(providerCode, errorMessage(cause, '注文確定に失敗しました'))
          : errorMessage(cause, '注文確定に失敗しました')
        reportDataError(orderError.value, cause)
        await loadTradingData().catch(() => {})
      } finally {
        orderBusy.value = false
      }
      return
    }
    const receipt = await rpcCall<RecordLike>('investments.orders.create', {
      ...commonCashOrderParams(),
      confirmationToken: lastCashEstimate.value.confirmationId,
      allowTransaction: true,
    })
    orders.value = [
      {
        id: textValue(receipt.id, `ord-${Date.now()}`),
        code: selectedStock.value.code,
        date: textValue(receipt.orderedAt, new Date().toLocaleString('ja-JP')),
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
    if (!providerOperations.value.has('investments.orders.cancel')) {
      reportDataError('この provider は注文取消に未対応です')
      return
    }
    if (order.cancelable === false) {
      reportDataError('この注文は現在取り消せません')
      return
    }
    const key = orderHistoryKey(order)
    if (cancelingOrderKey.value) return
    cancelingOrderKey.value = key
    try {
      await rpcCall('investments.orders.cancel', {
        accountId: providerAccountId.value,
        orderId: order.orderSubNo || order.id,
        allowTransaction: true,
      })
      order.status = '取消済'
      await loadTradingData()
    } catch (cause) {
      reportDataError(errorMessage(cause, '注文取消に失敗しました'), cause)
    } finally {
      cancelingOrderKey.value = ''
    }
  }

  const loadOrderDetail = async (order: OrderRow): Promise<OrderDetail> => {
    if (!providerOperations.value.has('investments.orders.get')) {
      throw new Error('この provider は注文詳細に未対応です')
    }
    const detail = await rpcCall<RecordLike>('investments.orders.get', {
      accountId: providerAccountId.value,
      orderId: order.id,
      instrumentId: order.code,
      venue: order.market,
    })
    const parsed = orderDetailFromApi(detail)
    if (!parsed) throw new Error('注文詳細を読み取れませんでした')
    return parsed
  }

  const loadTradeRecords = async (): Promise<TradeRecordRow[]> => {
    if (!providerOperations.value.has('investments.trades.list')) {
      throw new Error('この provider は取引明細に未対応です')
    }
    const result = await rpcCall<RecordLike>('investments.trades.list', {
      accountId: providerAccountId.value,
      limit: 50,
    })
    return asArray(result.items)
      .map(tradeRecordFromApi)
      .filter((record): record is TradeRecordRow => Boolean(record))
  }

  const loadPositionDetail = async (position: Position): Promise<Position> => {
    if (!providerOperations.value.has('investments.positions.get')) {
      throw new Error('この provider は保有詳細に未対応です')
    }
    const detail = await rpcCall<RecordLike>('investments.positions.get', {
      accountId: providerAccountId.value,
      instrumentId: position.code,
      venue: position.market,
      positionType: 'cash',
      accountType: position.accountType,
    })
    const parsed = positionFromApi(detail)
    if (!parsed) throw new Error('保有詳細を読み取れませんでした')
    return parsed
  }

  const estimateOrderCorrection = async (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ): Promise<OrderPreview> => {
    if (!providerOperations.value.has('investments.orders.replace.preview')) {
      throw new Error('この provider は注文訂正見積に未対応です')
    }
    if (!isUsMarket(order.market)) throw new Error('注文訂正は米国株のみ対応しています')
    if (!providerAccountId.value) throw new Error('取引口座を取得できません')
    const preview = asRecord(
      await rpcCall<unknown>('investments.orders.replace.preview', {
        accountId: providerAccountId.value,
        orderId: order.orderSubNo || order.id,
        quantity: String(draft.quantity),
        limitPrice:
          draft.priceCondition === 'limit' && draft.price
            ? { currency: isUsMarket(order.market) ? 'USD' : 'JPY', value: String(draft.price) }
            : undefined,
        allowTransaction: true,
      }),
    )
    return {
      issue: { code: order.code, market: order.market },
      side: order.side,
      quantity: draft.quantity,
      warnings: asArray(preview.warnings)
        .map((warning) => textValue(warning))
        .filter(Boolean),
      confirmationId: textValue(preview.confirmationToken) || undefined,
    }
  }

  const placeOrderCorrection = async (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ) => {
    if (!providerOperations.value.has('investments.orders.replace')) {
      throw new Error('この provider は注文訂正に未対応です')
    }
    if (!isUsMarket(order.market)) throw new Error('注文訂正は米国株のみ対応しています')
    await rpcCall('investments.orders.replace', {
      accountId: providerAccountId.value,
      orderId: order.orderSubNo || order.id,
      quantity: String(draft.quantity),
      limitPrice:
        draft.priceCondition === 'limit' && draft.price
          ? { currency: isUsMarket(order.market) ? 'USD' : 'JPY', value: String(draft.price) }
          : undefined,
      allowTransaction: true,
    })
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

  watch(activeOrderKey, (key, previous) => {
    if (!lastCashEstimate.value || key === previous) return
    orderNotice.value = '入力が変更されました。再度プレビューしてください。'
  })

  watch(selectedHolding, (holding) => {
    if (!holding?.accountType || orderInputMode.value !== 'amount') return
    selectStock(stockFromPosition(holding))
    if (defaultCashOrderAccountTypeOptions.some((option) => option.value === holding.accountType)) {
      cashOrderAccountType.value = holding.accountType as CashOrderAccountType
    }
  })

  watch(
    [positions, () => selectedStock.value.code, () => selectedStock.value.market, orderInputMode],
    ([currentPositions, code, market, mode]) => {
      if (mode !== 'amount') return
      const matchingPositions = positionsForStock(currentPositions, { code, market })
      const selected = currentPositions.find((position) => position.id === selectedHoldingId.value)
      if (selected && !matchingPositions.includes(selected)) selectedHoldingId.value = ''
      if (!code || selectedHoldingId.value) return
      const holding = matchingPositions[0]
      if (!holding) return
      tradeSide.value = 'sell'
      selectedHoldingId.value = holding.id
    },
  )

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
        await suggestIssues(query)
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
    smbcQrUrl,
    smbcUrl,
    smbcBalance,
    finishSmbc2fa,
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
    amountInput,
    amountSellMode,
    selectedHoldingId,
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
    orderNotice,
    orderError,
    orderBusy,
    orderInputMode,
    orderAmountMinimum,
    orderAmountIncrement,
    selectedHolding,
    chartAvailable,
    quoteLoading,
    searchQuotesAvailable,
    previewExpired,
    connected,
    dataLoading,
    searchLoading,
    buyingPower,
    holdingsMarketValue,
    totalProfitLoss,
    totalProfitLossRate,
    marketIndexes,
    orders,
    cancelingOrderKey,
    orderHistoryLoaded,
    orderHistoryNotice,
    positions,
    sellPositions,
    portfolioPositions,
    realtimePricePoints,
    chartPricePoints,
    chartNotice,
    pricePolling,
    selectedStock,
    orderQuantity,
    orderAmount,
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
    canRequestOrderEstimate,
    canPlaceCashOrder,
    countries,
    markets,
    viewedStocks,
    filteredStocks,
    selectedPosition,
    selectedStockProviderPositions,
    recentOrders,
    portfolioRecentOrders,
    totalAssetValue,
    portfolioBuyingPower,
    portfolioHoldingsMarketValue,
    portfolioBrokerageAssetBreakdown,
    portfolioTotalProfitLoss,
    portfolioTotalProfitLossRate,
    stockAssetRatio,
    cashAssetRatio,
    otherAssetBreakdown,
    providerHoldingsBreakdown,
    portfolioOtherAssetBreakdown,
    portfolioOverviewLoading,
    portfolioOrderHistoryNotice,
    assetHistory,
    assetHistoryLoading,
    hasQuote,
    selectStock,
    selectTradeStock,
    selectStockByCode,
    connect,
    loadTradingData,
    invokeProvider,
    loadStoredAssetValuations,
    loadPortfolioOverview,
    estimateCashOrder,
    askPlaceOrder,
    placeCashOrder,
    cancelOrder,
    loadOrderDetail,
    loadTradeRecords,
    loadPositionDetail,
    estimateOrderCorrection,
    placeOrderCorrection,
    downloadCsv,
    openTradeForStock,
    openTradeForPosition,
  }
}
