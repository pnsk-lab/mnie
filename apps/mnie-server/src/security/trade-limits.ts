import { canonicalDecimal, compareDecimal, multiplyDecimal } from '../virtual-accounts'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeyTradeUsage, apiKeys } from '../db/schema'

type WindowName = '1h' | '6h' | '1d'

interface TradeLimitInput {
  apiKeyId: string
  params: unknown
  operation?: string
}

export const isTransactionOperation = (operation: string, input?: unknown) => {
  const params = record(input)
  if (params?.allowTransaction === true || params?.allowTrading === true) return true
  return /\.(create|send|place|cancel|change|replace|placeCorrection|placeCancel)$/.test(operation)
}

const windowBucket = (date: Date, window: WindowName) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  if (window === '1d') return `${year}-${month}-${day}`

  const hour = date.getUTCHours()
  const bucketHour = window === '6h' ? Math.floor(hour / 6) * 6 : hour
  return `${year}-${month}-${day}T${String(bucketHour).padStart(2, '0')}`
}

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const decimal = (value: unknown) =>
  value === undefined || value === null || value === ''
    ? undefined
    : canonicalDecimal(String(value))
const money = (value: unknown) => {
  const input = record(value)
  if (!input) return undefined
  const valueText = decimal(input.value)
  const currency = typeof input.currency === 'string' ? input.currency : undefined
  return valueText !== undefined && currency ? { currency, value: valueText } : undefined
}
const assertPriceLimits = (
  params: unknown,
  settings: { maxOrderPriceJpy: number | null; maxOrderAmountJpy: number | null },
) => {
  const input = record(params)
  const directAmount = money(input?.amount)
  const execution = record(input?.execution)
  const structuredPrice = money(input?.limitPrice ?? execution?.limitPrice)
  const price = structuredPrice?.value ?? decimal(input?.price)
  const quantity = decimal(input?.quantity)
  if (directAmount && compareDecimal(directAmount.value, '0') <= 0)
    throw new Error('order amount must be positive')
  if (price !== undefined && compareDecimal(price, '0') <= 0)
    throw new Error('order price must be positive')
  if (quantity !== undefined && compareDecimal(quantity, '0') <= 0)
    throw new Error('order quantity must be positive')
  if (
    (settings.maxOrderPriceJpy !== null || settings.maxOrderAmountJpy !== null) &&
    ((directAmount && directAmount.currency !== 'JPY') ||
      (structuredPrice && structuredPrice.currency !== 'JPY'))
  )
    throw new Error('JPY trade limits require an explicit currency conversion for this order')
  if (settings.maxOrderPriceJpy !== null) {
    if (price === undefined) throw new Error('order price limit requires a bounded unit price')
    if (compareDecimal(price, String(settings.maxOrderPriceJpy)) > 0)
      throw new Error(`order price exceeds API key limit (${settings.maxOrderPriceJpy} JPY)`)
  }
  if (settings.maxOrderAmountJpy === null) return
  const amount =
    directAmount?.value ??
    (price !== undefined && quantity !== undefined ? multiplyDecimal(price, quantity) : undefined)
  if (amount === undefined)
    throw new Error('order amount limit requires an amount or a price and quantity')
  if (compareDecimal(amount, String(settings.maxOrderAmountJpy)) > 0)
    throw new Error(`order amount exceeds API key limit (${settings.maxOrderAmountJpy} JPY)`)
}

const checkAndConsumeWindow = (
  db: Db,
  apiKeyId: string,
  window: WindowName,
  limit: number | null,
  now: Date,
) => {
  if (limit == null) return
  const hourBucket = windowBucket(now, window)
  const where = and(
    eq(apiKeyTradeUsage.apiKeyId, apiKeyId),
    eq(apiKeyTradeUsage.window, window),
    eq(apiKeyTradeUsage.hourBucket, hourBucket),
  )
  const usage = db.select().from(apiKeyTradeUsage).where(where).get()
  const currentCount = usage?.tradeCount ?? 0
  if (currentCount >= limit) throw new Error(`${window} trade limit exceeded for API key`)
  if (usage)
    db.update(apiKeyTradeUsage)
      .set({ tradeCount: currentCount + 1, updatedAt: now })
      .where(where)
      .run()
  else
    db.insert(apiKeyTradeUsage)
      .values({ apiKeyId, window, hourBucket, tradeCount: 1, updatedAt: now })
      .run()
}

export const consumeApiKeyTradeLimitsSync = ({
  db,
  apiKeyId,
  params,
  operation,
}: TradeLimitInput & { db: Db }) =>
  db.transaction(() => {
    const key = db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get()
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()))
      throw new Error('API key is not active')
    if (operation !== 'investments.orders.cancel')
      assertPriceLimits(params, {
        maxOrderPriceJpy: key.maxOrderPriceJpy,
        maxOrderAmountJpy: key.maxOrderAmountJpy,
      })
    const now = new Date()
    checkAndConsumeWindow(db, apiKeyId, '1h', key.maxTradesPerHour, now)
    checkAndConsumeWindow(db, apiKeyId, '6h', key.maxTradesPer6Hours, now)
    checkAndConsumeWindow(db, apiKeyId, '1d', key.maxTradesPerDay, now)
  })

export const assertAndConsumeApiKeyTradeLimits = async (input: TradeLimitInput & { db: Db }) =>
  consumeApiKeyTradeLimitsSync(input)

export const assertApiKeyMethodAllowed = async (db: Db, apiKeyId: string, method: string) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()))
    throw new Error('API key is not active')
  if (key.allowedMethods === null || key.allowedMethods === undefined) return
  if (key.allowedMethods.includes(method)) return
  throw new Error(`API key is not allowed to call ${method}`)
}
