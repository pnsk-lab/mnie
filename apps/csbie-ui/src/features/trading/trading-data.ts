import type {
  OrderPreview,
  OrderRow,
  Position,
  RealtimePricePoint,
  Stock,
} from '../../types/trading'
import { currency } from '../../utils/format'

export type RecordLike = Record<string, unknown>

export const emptyStock: Stock = {
  code: '',
  name: '未選択',
  symbol: '',
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

export const issueFrom = (value: unknown) => {
  const issue = asRecord(value)
  return {
    code: textValue(issue.code, textValue(issue.issueCode)),
    market: textValue(issue.market, textValue(issue.marketCode, '')),
    name: textValue(
      issue.name,
      textValue(issue.issueName, textValue(issue.stockName, textValue(issue.displayName))),
    ),
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

export const stockFromIssue = (issue: ReturnType<typeof issueFrom>): Stock => ({
  code: issue.code,
  name: issue.name || issue.code,
  symbol: issue.code ? `${issue.code}${issue.market ? `.${issue.market}` : ''}` : '',
  country: '日本',
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

export const stockFromBoard = (
  value: unknown,
  fallbackIssue?: ReturnType<typeof issueFrom>,
): Stock => {
  const board = asRecord(value)
  const quoteRecord = asRecord(board.quote)
  const boardIssue = issueFrom(board.issue)
  const quoteIssue = issueFrom(quoteRecord.issue)
  const issue = {
    code: quoteIssue.code || boardIssue.code || fallbackIssue?.code || '',
    market: quoteIssue.market || boardIssue.market || fallbackIssue?.market || '',
    name: quoteIssue.name || boardIssue.name || fallbackIssue?.name || '',
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
    symbol: issue.code ? `${issue.code}${issue.market ? `.${issue.market}` : ''}` : '',
    country: '日本',
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

const chartDateTimeToIso = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return ''
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const hour = Number(digits.slice(8, 10) || '0')
  const minute = Number(digits.slice(10, 12) || '0')
  const date = new Date(year, month - 1, day, hour, minute)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export const pricePointsFromIssueChart = (value: unknown): RealtimePricePoint[] =>
  asArray(asRecord(value).prices)
    .map((entry) => {
      const price = asRecord(entry)
      const at = chartDateTimeToIso(textValue(price.dateTime))
      return { at, price: numberValue(price.close) }
    })
    .filter((point) => point.at && point.price > 0)

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
  return {
    code: issue.code,
    name: issue.name,
    market: issue.market,
    quantity,
    avgPrice,
    marketValue: numberValue(item.marketValue ?? item.valuationPrice),
    profitLoss,
    profitLossRate,
    type: textValue(item.depositTypeText) || undefined,
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
  const kind = item.kind === 's' ? 's' : 'standard'
  const status = orderStatusText(textValue(item.status, 'executed'))
  const executedQuantity = nullableNumberValue(item.executedQuantity)
  const orderedQuantity = nullableNumberValue(item.quantity)
  const unexecutedQuantity = nullableNumberValue(item.unexecutedQuantity)
  const quantity =
    status === '約定済'
      ? (executedQuantity ?? orderedQuantity ?? unexecutedQuantity)
      : (orderedQuantity ?? unexecutedQuantity ?? executedQuantity)
  const price =
    status === '約定済'
      ? (nullableNumberValue(item.executedPrice) ?? nullableNumberValue(item.price))
      : (nullableNumberValue(item.price) ?? nullableNumberValue(item.executedPrice))
  return {
    id: textValue(item.id, textValue(item.orderNumber, `${issue.code}-${item.orderedAt ?? ''}`)),
    date: textValue(item.orderedAt, textValue(item.expiresAt)),
    stock: issue.name || issue.code,
    side,
    kind,
    quantity,
    price,
    status,
    orderNumber: textValue(item.orderNumber),
    tradeId: textValue(item.tradeId),
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
