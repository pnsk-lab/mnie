import { computed, ref, watch, type Ref } from 'vue'
import {
  createRpcSocket,
  listHistory,
  listLatestAssetValuations,
  type AccountProfile,
  type AssetValuation,
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
  isOrderPreview,
  issueFrom,
  marketDateKey,
  marketIndexFromApi,
  numberValue,
  orderDetailFromApi,
  orderFromApi,
  orderHistoryKey,
  chartNoticeFromIssueChart,
  pricePointsFromIssueChart,
  positionFromApi,
  stockFromBoard,
  stockFromIssue,
  stockFromPosition,
  tradeRecordFromApi,
  textValue,
  type RecordLike,
} from './trading-data'

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
  const providerOperations = ref(new Set<string>())
  const rpcPending = new Map<number, RpcResolver>()
  const sbiConnected = ref(false)
  const smbcQrUrl = ref('')
  const smbcBalance = ref<{ amount: number; displayValue: string } | null>(null)
  const dataLoading = ref(false)
  const searchLoading = ref(false)
  const storedTotalAssetValue = ref<number | null>(null)
  const storedSbiHoldingsMarketValue = ref(0)
  const storedSbiBuyingPower = ref(0)
  const assetValuations = ref<AssetValuation[]>([])
  const assetHistory = ref<
    Array<{ at: string; profileId: string; label: string; value: number; color: string }>
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

  const isExpectedRpcInterruption = (cause: unknown) =>
    cause instanceof Error &&
    (cause.message === 'RPC socket reconnecting' || cause.message === 'RPC socket closed')

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
  const recentOrders = computed(() => orders.value.slice(0, 2))
  const totalAssetValue = computed(() => storedTotalAssetValue.value ?? 0)

  const loadStoredAssetValuations = async () => {
    assetHistoryLoading.value = true
    try {
      const from = new Date(0).toISOString()
      const valuationsPromise = listLatestAssetValuations()
        .then(({ valuations }) => {
          assetValuations.value = valuations
          const jpy = valuations.filter((item) => item.currency === 'JPY')
          storedTotalAssetValue.value = jpy.length
            ? jpy.reduce((sum, item) => sum + item.value, 0)
            : null
          const sbi = jpy.find((item) => item.provider === 'sbisec')
          storedSbiHoldingsMarketValue.value = sbi?.holdingsValue ?? 0
          storedSbiBuyingPower.value = sbi?.cashValue ?? 0
        })
        .finally(() => {
          storedAssetsLoaded.value = true
        })
      const historyPromise = listHistory({ from, kinds: ['snapshot', 'transaction'] })
        .then((history) => {
          const sortedHistory = history.items.sort((a, b) =>
            a.occurredAt.localeCompare(b.occurredAt),
          )
          const historyValues = new Map<string, number>()
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
            return [
              {
                at: item.occurredAt,
                profileId: item.profileId,
                label:
                  profiles.value.find((profile) => profile.id === item.profileId)?.label ??
                  item.profileId,
                value,
                color: profileColor(
                  profiles.value.find((profile) => profile.id === item.profileId) ?? {
                    provider: 'sbisec',
                    color: null,
                  },
                ),
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
              return {
                at: occurredAt,
                profileId,
                label:
                  profiles.value.find((profile) => profile.id === profileId)?.label ?? profileId,
                value: pointValue,
                color: profileColor(
                  profiles.value.find((profile) => profile.id === profileId) ?? {
                    provider: 'sbisec',
                    color: null,
                  },
                ),
              }
            })
          })
          assetHistory.value = [...backwardPoints, ...forwardPoints].sort((a, b) =>
            a.at.localeCompare(b.at),
          )
          if (history.errors.length) {
            reportDataError(
              history.errors.map((item) => `${item.providerId}: ${item.message}`).join('; '),
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
      .filter((item) => item.provider !== 'sbisec' && item.currency === 'JPY')
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
  const stockAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (storedSbiHoldingsMarketValue.value / totalAssetValue.value) * 100
  })
  const cashAssetRatio = computed(() => {
    if (!totalAssetValue.value) return 0
    return (storedSbiBuyingPower.value / totalAssetValue.value) * 100
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
      pending.reject(new Error(response.error.message || 'RPC request failed'))
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

  const loadOrderHistoryFromSdk = async () => {
    orderHistoryLoaded.value = false
    orderHistoryNotice.value = ''
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

  const loadTradingData = async () => {
    dataLoading.value = true
    try {
      const [assetsResult, positionsResult, balancesResult, indexesResult] =
        await Promise.allSettled([
          rpcCallOptional<RecordLike>('assets.valuation.get', undefined, 20_000),
          rpcCallOptional<RecordLike>('investments.positions.list', undefined, 15_000),
          rpcCallOptional<unknown[]>('balances.list', undefined, 15_000),
          rpcCallOptional<unknown[]>('market.index.major', undefined, 15_000),
        ])
      marketIndexes.value =
        indexesResult.status === 'fulfilled'
          ? indexesResult.value
              .map(marketIndexFromApi)
              .filter((index): index is MarketIndex => Boolean(index))
          : []
      const positionList = positionsResult.status === 'fulfilled' ? positionsResult.value : {}
      const nextPositions = asArray(positionList.items)
        .map(positionFromApi)
        .filter((position): position is Position => Boolean(position))
      positions.value = nextPositions
      mergeStocks(nextPositions.map(stockFromPosition))
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

      const hasAccountAssets = assetsResult.status === 'fulfilled'
      if (hasAccountAssets) {
        applyAccountAssets(assetsResult.value)
      } else {
        reportDataError(
          errorMessage(assetsResult.reason, 'My資産の取得に失敗しました'),
          assetsResult.reason,
        )
      }

      const orderHistoryResult = await Promise.allSettled([loadOrderHistoryFromSdk()])
      const powerResult = balancesResult

      if (!hasAccountAssets && powerResult.status === 'fulfilled') {
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

  const connect = () => {
    void loadStoredAssetValuations().catch((cause) =>
      reportDataError(errorMessage(cause, '保存済み資産額の取得に失敗しました'), cause),
    )
    const previousSocket = ws.value
    rejectPendingRpc(new Error('RPC socket reconnecting'))
    stopBoardPolling()
    previousSocket?.close()
    sbiConnected.value = false
    smbcQrUrl.value = ''
    smbcBalance.value = null
    dataLoading.value = true
    const selectedProfile = profiles.value.find((profile) => profile.id === selectedProfileId.value)
    if (!selectedProfile) {
      dataLoading.value = false
      reportDataError('口座プロフィールを選択してください')
      return
    }
    const socket = createRpcSocket()
    socket.addEventListener('open', async () => {
      try {
        if (selectedProfile.provider === 'smbc-direct') {
          const connection = (await rpcCall('provider.connect', {
            provider: selectedProfile.provider,
            profileId: selectedProfile.id,
          })) as { requires2fa?: boolean; qrurl?: string }
          if (connection.requires2fa) {
            if (!connection.qrurl) throw new Error('SMBC Direct QR code was not returned')
            smbcQrUrl.value = connection.qrurl
            return
          }
        }
        providerOperations.value = new Set(
          await rpcCall<string[]>('profile.operations', { profileId: selectedProfile.id }),
        )
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
      providerOperations.value = new Set()
      dataLoading.value = false
    })
    ws.value = socket
  }

  const finishSmbc2fa = async () => {
    if (!smbcQrUrl.value) throw new Error('SMBC Direct QR approval is not pending')
    dataLoading.value = true
    try {
      await rpcCall('provider.finish2fa')
      providerOperations.value = new Set(
        await rpcCall<string[]>('profile.operations', { profileId: selectedProfileId.value }),
      )
      const balances = await rpcCall<RecordLike[]>('balances.list')
      const balance = balances[0]
      smbcBalance.value = {
        amount: numberValue(asRecord(asRecord(asRecord(balance).amount).money).value),
        displayValue: textValue(asRecord(asRecord(asRecord(balance).amount).money).value),
      }
      smbcQrUrl.value = ''
    } catch (cause) {
      reportDataError(errorMessage(cause, 'SMBC Direct の認証に失敗しました'), cause)
    } finally {
      dataLoading.value = false
    }
  }

  const startBoardPolling = async () => {
    stopBoardPolling()
    realtimePricePoints.value = []

    const stock = selectedStock.value
    if (
      !connected.value ||
      !stock.code ||
      !providerOperations.value.has('market.issue.pollBoard.subscribe')
    )
      return
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

  const estimateCashOrder = async () => {
    if (!providerOperations.value.has('investments.orders.preview')) {
      throw new Error('この provider は注文見積に未対応です')
    }
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
    if (!providerOperations.value.has('investments.orders.create')) {
      throw new Error('この provider は注文実行に未対応です')
    }
    if (!canPlaceCashOrder.value || !lastCashEstimate.value) return
    const receipt = await rpcCall<RecordLike>('orders.cash.place', {
      ...cashOrderParams(),
      confirmationId: lastCashEstimate.value.confirmationId,
      allowTrading: true,
    })
    orders.value = [
      {
        id: textValue(receipt.orderId, `ord-${Date.now()}`),
        code: selectedStock.value.code,
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
    if (!providerOperations.value.has('investments.orders.cancel')) {
      reportDataError('この provider は注文取消に未対応です')
      return
    }
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
        orderId: order.orderSubNo || order.id,
        issueCode: order.code,
        market: order.market,
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

  const loadOrderDetail = async (order: OrderRow): Promise<OrderDetail> => {
    if (!isUsMarket(order.market)) {
      throw new Error('注文詳細は米国株のみ対応しています')
    }
    if (!order.orderNumber && !order.id && !order.orderSubNo) {
      throw new Error('注文番号を取得できないため詳細を取得できません')
    }
    const detail = await rpcCall<RecordLike>('orders.inquiry.detail', {
      orderNumber: order.orderNumber,
      orderId: order.orderSubNo || order.id,
      issueCode: order.code,
      market: order.market,
    })
    const parsed = orderDetailFromApi(detail)
    if (!parsed) throw new Error('注文詳細を読み取れませんでした')
    return parsed
  }

  const loadTradeRecords = async (): Promise<TradeRecordRow[]> => {
    const result = await rpcCall<RecordLike>('orders.inquiry.tradeRecords', { limit: 50 })
    return asArray(result.records)
      .map(tradeRecordFromApi)
      .filter((record): record is TradeRecordRow => Boolean(record))
  }

  const loadPositionDetail = async (position: Position): Promise<Position> => {
    if (!isUsMarket(position.market)) {
      throw new Error('保有詳細は米国株のみ対応しています')
    }
    const detail = await rpcCall<RecordLike>('account.positions.cashDetail', {
      issueCode: position.code,
      market: position.market,
      accountType: position.accountType,
      limit: 1,
    })
    const parsed = asArray(detail.positions).map(positionFromApi)[0]
    if (!parsed) throw new Error('保有詳細を読み取れませんでした')
    return parsed
  }

  const orderCorrectionParams = (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ) => ({
    orderNumber: order.orderNumber,
    orderId: order.orderSubNo || order.id,
    issueCode: order.code,
    market: order.market,
    quantity: draft.quantity,
    priceCondition: draft.priceCondition,
    price: draft.priceCondition === 'limit' ? draft.price : undefined,
    orderMethod: 'normal',
  })

  const estimateOrderCorrection = async (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ): Promise<OrderPreview> => {
    if (!providerOperations.value.has('investments.orders.preview')) {
      throw new Error('この provider は注文見積に未対応です')
    }
    if (!isUsMarket(order.market)) throw new Error('注文訂正は米国株のみ対応しています')
    const preview = await rpcCall<unknown>(
      'orders.cash.estimateCorrection',
      orderCorrectionParams(order, draft),
    )
    if (!isOrderPreview(preview)) throw new Error('注文訂正の見積を読み取れませんでした')
    return preview
  }

  const placeOrderCorrection = async (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ) => {
    if (!providerOperations.value.has('investments.orders.replace')) {
      throw new Error('この provider は注文訂正に未対応です')
    }
    if (!isUsMarket(order.market)) throw new Error('注文訂正は米国株のみ対応しています')
    await rpcCall('orders.cash.placeCorrection', {
      ...orderCorrectionParams(order, draft),
      allowTrading: true,
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
    marketIndexes,
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
    portfolioBuyingPower: storedSbiBuyingPower,
    portfolioHoldingsMarketValue: storedSbiHoldingsMarketValue,
    stockAssetRatio,
    cashAssetRatio,
    otherAssetBreakdown,
    assetHistory,
    assetHistoryLoading,
    hasQuote,
    selectStock,
    selectStockByCode,
    connect,
    loadTradingData,
    loadStoredAssetValuations,
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
