import type {
  ChartNotice,
  MarketIndex,
  OrderDetail,
  OrderPreview,
  OrderRow,
  Position,
  RealtimePricePoint,
  Stock,
  TradeRecordRow,
} from '../../types/trading'
import { currency } from '../../utils/format'

export type RecordLike = Record<string, unknown>
interface IssueLike {
  code: string
  market: string
  name: string
  searchText?: string
}

export const emptyStock: Stock = {
  code: '',
  name: '未選択',
  symbol: '',
  searchText: '',
  country: '日本',
  market: '',
  sector: '',
  price: 0,
  change: 0,
  changeAmount: 0,
  volume: 0,
  open: 0,
  high: 0,
  low: 0,
  prevClose: 0,
  sShare: false,
  history: [0, 0],
  box: { min: 0, q1: 0, median: 0, q3: 0, max: 0 },
}

export const isRecord = (value: unknown): value is RecordLike =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const asRecord = (value: unknown): RecordLike => (isRecord(value) ? value : {})

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const numberValue = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d.-]/g, '')
    if (!normalized) return fallback
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) return parsed
  }
  const record = asRecord(value)
  if ('value' in record) return numberValue(record.value, fallback)
  if ('text' in record) return numberValue(record.text, fallback)
  return fallback
}

const nullableNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d.-]/g, '')
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  const record = asRecord(value)
  if ('value' in record) return nullableNumberValue(record.value)
  if ('text' in record) return nullableNumberValue(record.text)
  return null
}

export const textValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value ? value : fallback

const issueSymbol = (code: string, market: string) => (market ? `${market}:${code}` : code)

const countryFromMarket = (market: string) =>
  market === 'XNAS' || market === 'XNYS' || market === 'ARCX' ? '米国' : '日本'

export const issueFrom = (value: unknown) => {
  const issue = asRecord(value)
  const code = textValue(issue.code, textValue(issue.issueCode))
  const market = textValue(issue.market, textValue(issue.marketCode, ''))
  const name = textValue(
    issue.name,
    textValue(issue.issueName, textValue(issue.stockName, textValue(issue.displayName))),
  )
  const searchText = [
    code,
    market,
    name,
    textValue(issue.extract),
    textValue(issue.extractWord),
    textValue(issue.hitString),
  ]
    .filter(Boolean)
    .join(' ')
  return {
    code,
    market,
    name,
    searchText,
  }
}

const quoteFrom = (value: unknown) => {
  const quote = asRecord(value)
  return {
    price: numberValue(quote.price),
    change: numberValue(quote.change),
    changeRate: numberValue(quote.changeRate),
    open: numberValue(quote.open),
    high: numberValue(quote.high),
    low: numberValue(quote.low),
    prevClose: numberValue(quote.previousClose),
    volume: numberValue(quote.volume),
  }
}

const historyFromQuote = (quote: ReturnType<typeof quoteFrom>) => {
  const base = quote.prevClose || quote.open || quote.price
  const low = quote.low || Math.min(base, quote.price)
  const high = quote.high || Math.max(base, quote.price)
  return [base, quote.open || base, low, (low + high) / 2, high, quote.price]
}

const boxFromHistory = (history: number[]) => {
  const sorted = [...history].sort((a, b) => a - b)
  const at = (pct: number) => sorted[Math.floor((sorted.length - 1) * pct)] ?? 0
  return { min: at(0), q1: at(0.25), median: at(0.5), q3: at(0.75), max: at(1) }
}

export const stockFromIssue = (issue: IssueLike): Stock => ({
  code: issue.code,
  name: issue.name || issue.code,
  symbol: issue.code ? issueSymbol(issue.code, issue.market) : '',
  searchText: issue.searchText,
  country: countryFromMarket(issue.market),
  market: issue.market,
  sector: '',
  price: 0,
  change: 0,
  changeAmount: 0,
  volume: 0,
  open: 0,
  high: 0,
  low: 0,
  prevClose: 0,
  sShare: true,
  history: [0, 0],
  box: { min: 0, q1: 0, median: 0, q3: 0, max: 0 },
})

export const stockFromPosition = (position: Position): Stock => {
  const price = position.quantity ? Math.round(position.marketValue / position.quantity) : 0
  return {
    ...stockFromIssue({
      code: position.code,
      market: position.market,
      name: position.name,
    }),
    price,
    history: [price, price],
    box: { min: price, q1: price, median: price, q3: price, max: price },
  }
}

const accountTypeLabels: Record<string, string> = {
  specific: '特定',
  general: '一般',
  growthInvestment: 'NISA成長投資枠',
  nisa: 'NISA',
}

const accountTypeLabel = (value: string) => accountTypeLabels[value] ?? value

export const stockFromBoard = (value: unknown, fallbackIssue?: IssueLike): Stock => {
  const board = asRecord(value)
  const quoteRecord = asRecord(board.quote)
  const boardIssue = issueFrom(board.issue)
  const quoteIssue = issueFrom(quoteRecord.issue)
  const issue = {
    code: quoteIssue.code || boardIssue.code || fallbackIssue?.code || '',
    market: quoteIssue.market || boardIssue.market || fallbackIssue?.market || '',
    name: quoteIssue.name || boardIssue.name || fallbackIssue?.name || '',
    searchText: quoteIssue.searchText || boardIssue.searchText || fallbackIssue?.searchText || '',
  }
  const quote = quoteFrom(quoteRecord)
  const codeAsNumber = Number(issue.code)
  const quotePrice = quote.price === codeAsNumber ? 0 : quote.price
  const price = quotePrice || quote.prevClose || quote.open
  const history = historyFromQuote({ ...quote, price })
  const hasValidQuote = price > 0
  return {
    code: issue.code,
    name: issue.name,
    symbol: issue.code ? issueSymbol(issue.code, issue.market) : '',
    searchText: issue.searchText,
    country: countryFromMarket(issue.market),
    market: issue.market,
    sector: '',
    price,
    change: hasValidQuote ? quote.changeRate : 0,
    changeAmount: hasValidQuote ? quote.change : 0,
    volume: hasValidQuote ? quote.volume : 0,
    open: hasValidQuote ? quote.open : 0,
    high: hasValidQuote ? quote.high : 0,
    low: hasValidQuote ? quote.low : 0,
    prevClose: hasValidQuote ? quote.prevClose : 0,
    sShare: true,
    history,
    box: boxFromHistory(history),
  }
}

const signedValueFrom = (value: unknown) => {
  const record = asRecord(value)
  const parsedValue = nullableNumberValue(record.value)
  const text = textValue(record.text, parsedValue == null ? '' : String(parsedValue))
  const rawSign = textValue(record.sign)
  const sign: MarketIndex['sign'] =
    rawSign === 'positive' || rawSign === 'negative' || rawSign === 'zero'
      ? rawSign
      : parsedValue == null || parsedValue === 0
        ? 'zero'
        : parsedValue > 0
          ? 'positive'
          : 'negative'
  return { value: parsedValue, text, sign }
}

const percentValueFrom = (value: unknown) => {
  const record = asRecord(value)
  const parsedValue = nullableNumberValue(record.value)
  return {
    value: parsedValue,
    text: textValue(record.text, parsedValue == null ? '' : `${parsedValue}%`),
  }
}

export const marketIndexFromApi = (value: unknown): MarketIndex | null => {
  const index = asRecord(value)
  const name = textValue(index.name)
  if (!name) return null

  const parsedValue = nullableNumberValue(index.value)
  const change = signedValueFrom(index.change)
  const changeRate = percentValueFrom(index.changeRate)
  return {
    code: textValue(index.code) || undefined,
    name,
    value: parsedValue,
    valueText: textValue(index.valueText, parsedValue == null ? '' : String(parsedValue)),
    change: change.value,
    changeText: change.text,
    changeRate: changeRate.value,
    changeRateText: changeRate.text,
    sign: change.sign,
    timestamp: textValue(index.timestamp) || undefined,
  }
}

const zonedPartsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const zonedParts = (date: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    zonedPartsFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>>

  const missing = (['year', 'month', 'day', 'hour', 'minute', 'second'] as const).filter(
    (part) => parts[part] == null,
  )
  if (missing.length) {
    throw new Error(`Failed to read ${missing.join(', ')} from ${timeZone} date parts`)
  }

  return {
    year: parts.year as number,
    month: parts.month as number,
    day: parts.day as number,
    hour: parts.hour as number,
    minute: parts.minute as number,
    second: parts.second as number,
  }
}

const timeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = zonedParts(date, timeZone)
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    date.getTime()
  )
}

const zonedDateTimeToUtcMs = (
  timeZone: string,
  parts: {
    year: number
    month: number
    day: number
    hour?: number
    minute?: number
    second?: number
  },
) => {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  )
  return utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone)
}

export const startOfMarketDateUtcMs = (timeZone: string, now = new Date()) => {
  const parts = zonedParts(now, timeZone)
  return zonedDateTimeToUtcMs(timeZone, {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  })
}

export const marketDateKey = (timeZone: string, now = new Date()) => {
  const parts = zonedParts(now, timeZone)
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

const chartDateTimeToIso = (value: string, timeZone = 'Asia/Tokyo') => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return ''
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const hour = Number(digits.slice(8, 10) || '0')
  const minute = Number(digits.slice(10, 12) || '0')
  const time = zonedDateTimeToUtcMs(timeZone, { year, month, day, hour, minute })
  return Number.isNaN(time) ? '' : new Date(time).toISOString()
}

export const pricePointsFromIssueChart = (
  value: unknown,
  timeZone = 'Asia/Tokyo',
): RealtimePricePoint[] =>
  asArray(asRecord(value).prices)
    .map((entry) => {
      const price = asRecord(entry)
      const at = chartDateTimeToIso(textValue(price.dateTime), timeZone)
      const close = numberValue(price.close)
      return {
        at,
        price: close,
        open: numberValue(price.open),
        high: numberValue(price.high),
        low: numberValue(price.low),
        close,
        volume: numberValue(price.volume, 0),
      }
    })
    .filter((point) => point.at && point.price > 0)

const japanDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const chartDateTimeToLocalDate = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

const japanToday = () => japanDateFormatter.format(new Date())

const isWeekendInJapan = () => {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(new Date())
  return weekday === 'Sat' || weekday === 'Sun'
}

export const chartNoticeFromIssueChart = (value: unknown): ChartNotice | null => {
  const chart = asRecord(value)
  const latestDate = chartDateTimeToLocalDate(textValue(chart.latestDateTime))
  const today = japanToday()
  if (!latestDate || latestDate >= today) return null

  if (!isWeekendInJapan()) return null

  const formattedLatestDate = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(`${latestDate}T00:00:00+09:00`))

  return {
    title: '本日は休場日です',
    detail: `最新のチャートは${formattedLatestDate}です`,
  }
}

export const positionFromApi = (value: unknown): Position | null => {
  const item = asRecord(value)
  const issue = issueFrom(item.issue)
  if (!issue.code) return null
  const quantity = numberValue(item.quantity)
  const avgPrice = numberValue(item.averagePrice ?? item.purchasePrice)
  const profitLoss = numberValue(item.profitLoss)
  const costBasis = avgPrice * quantity
  const profitLossRate =
    numberValue(item.profitLossRate) || (costBasis ? (profitLoss / costBasis) * 100 : 0)
  const accountType = textValue(item.accountType, textValue(item.depositType))
  return {
    code: issue.code,
    name: issue.name,
    market: issue.market,
    quantity,
    avgPrice,
    currentPrice: nullableNumberValue(item.currentPrice),
    marketValue: numberValue(item.marketValue ?? item.valuationPrice),
    profitLoss,
    profitLossRate,
    type:
      textValue(item.depositTypeText) || (accountType ? accountTypeLabel(accountType) : undefined),
    accountType: accountType || undefined,
  }
}

const orderStatusText = (status: string): OrderRow['status'] => {
  if (status === 'open') return '注文中'
  if (status === 'cancelled' || status === 'expired' || status === 'rejected') return '取消済'
  return '約定済'
}

export const orderFromApi = (value: unknown): OrderRow | null => {
  const item = asRecord(value)
  const issue = issueFrom(item.issue)
  if (!issue.code) return null
  const side = item.side === 'sell' ? 'sell' : 'buy'
  const kind = 'standard'
  const status = orderStatusText(textValue(item.status, 'executed'))
  const executedQuantity = nullableNumberValue(item.executedQuantity)
  const orderedQuantity = nullableNumberValue(item.quantity)
  const unexecutedQuantity = nullableNumberValue(item.unexecutedQuantity)
  const quantity =
    status === '約定済'
      ? (executedQuantity ?? orderedQuantity ?? unexecutedQuantity)
      : (unexecutedQuantity ?? orderedQuantity ?? executedQuantity)
  const price =
    status === '約定済'
      ? (nullableNumberValue(item.executedPrice) ?? nullableNumberValue(item.price))
      : (nullableNumberValue(item.price) ?? nullableNumberValue(item.executedPrice))
  return {
    id: textValue(item.id, textValue(item.orderNumber, `${issue.code}-${item.orderedAt ?? ''}`)),
    code: issue.code,
    date: textValue(item.orderedAt, textValue(item.expiresAt)),
    stock: issue.name || issue.code,
    market: issue.market,
    side,
    kind,
    quantity,
    unexecutedQuantity,
    executedQuantity,
    price,
    status,
    orderNumber: textValue(item.orderNumber),
    orderSubNo: textValue(item.orderSubNo),
    tradeId: textValue(item.tradeId),
    accountType: textValue(item.accountType, textValue(item.depositType)),
    cancelable: typeof item.cancelable === 'boolean' ? item.cancelable : undefined,
    correctable: typeof item.correctable === 'boolean' ? item.correctable : undefined,
  }
}

export const orderDetailFromApi = (value: unknown): OrderDetail | null => {
  const row = orderFromApi(value)
  if (!row) return null
  const item = asRecord(value)
  return {
    ...row,
    expiresAt: textValue(item.expiresAt) || undefined,
    statusText: textValue(item.statusText) || undefined,
    depositType: textValue(item.depositType) || undefined,
    accountInformation: textValue(item.accountInformation) || undefined,
  }
}

export const tradeRecordFromApi = (value: unknown): TradeRecordRow | null => {
  const item = asRecord(value)
  const issue = issueFrom(item.issue)
  if (!issue.code) return null
  const tradeDate = textValue(item.tradeDate)
  const valueDate = textValue(item.valueDate)
  const type = textValue(item.tradeRecordTypeCode, textValue(item.type, '取引'))
  return {
    id: textValue(item.id, [issue.code, tradeDate, valueDate, type].filter(Boolean).join(':')),
    code: issue.code,
    stock: issue.name || issue.code,
    market: issue.market,
    type,
    quantity: nullableNumberValue(item.quantity),
    price: nullableNumberValue(item.price),
    amount: nullableNumberValue(item.amount),
    tradeDate: tradeDate || undefined,
    valueDate: valueDate || undefined,
    accountType: textValue(item.accountType) || undefined,
    settlementCurrencyCode: textValue(item.settlementCurrencyCode) || undefined,
  }
}

export const orderHistoryKey = (order: OrderRow) =>
  [order.orderNumber || order.id, order.tradeId, order.stock, order.date].filter(Boolean).join(':')

export const orderQuantityText = (order: OrderRow) =>
  typeof order.quantity === 'number' ? `${order.quantity}株` : '数量不明'

export const orderAmountText = (order: OrderRow) =>
  typeof order.price === 'number' && typeof order.quantity === 'number'
    ? currency(order.price * order.quantity)
    : '約定代金不明'

export const orderHistoryResultNotice = (value: unknown) => {
  const error = asRecord(asRecord(value).error)
  const code = textValue(error.code, textValue(error.status))
  if (!code) return ''
  const message = textValue(error.message)
  return message ? `${code}: ${message}` : code
}

export const isOrderPreview = (value: unknown): value is OrderPreview => {
  if (!value || typeof value !== 'object') return false
  const preview = value as Partial<OrderPreview>
  return (
    typeof preview.issue === 'object' &&
    preview.issue !== null &&
    typeof preview.issue.code === 'string' &&
    typeof preview.issue.market === 'string' &&
    typeof preview.side === 'string' &&
    typeof preview.quantity === 'number' &&
    Array.isArray(preview.warnings)
  )
}

export const fulfilledValues = <T>(results: Array<PromiseSettledResult<T>>): T[] =>
  results
    .filter((result): result is PromiseFulfilledResult<T> => result.status === 'fulfilled')
    .map((result) => result.value)
