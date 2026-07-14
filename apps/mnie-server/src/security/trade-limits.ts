import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeyTradeUsage, apiKeys } from '../db/schema'

type WindowName = '1h' | '6h' | '1d'

interface TradeLimitInput {
  apiKeyId: string
  params: unknown
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

const numberFromParams = (params: unknown, key: string) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  const value = (params as Record<string, unknown>)[key]
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const money = (value: unknown) => {
  const input = record(value)
  if (!input) return undefined
  const amount = Number(input.value)
  const currency = typeof input.currency === 'string' ? input.currency : undefined
  return currency && Number.isFinite(amount) ? { currency, value: amount } : undefined
}

const assertPriceLimits = (
  params: unknown,
  settings: {
    maxOrderPriceJpy: number | null
    maxOrderAmountJpy: number | null
  },
) => {
  const input = record(params)
  const directAmount = money(input?.amount)
  const execution = record(input?.execution)
  const structuredPrice = money(execution?.limitPrice)
  const legacyPrice = numberFromParams(params, 'price')
  const price = structuredPrice?.value ?? legacyPrice
  const quantity = numberFromParams(params, 'quantity')

  if (directAmount && directAmount.value <= 0) throw new Error('order amount must be positive')
  if (price != null && price <= 0) throw new Error('order price must be positive')
  if (quantity != null && quantity <= 0) throw new Error('order quantity must be positive')

  if (
    (settings.maxOrderPriceJpy != null || settings.maxOrderAmountJpy != null) &&
    ((directAmount && directAmount.currency !== 'JPY') ||
      (structuredPrice && structuredPrice.currency !== 'JPY'))
  ) {
    throw new Error('JPY trade limits require an explicit currency conversion for this order')
  }

  if (settings.maxOrderPriceJpy != null && price != null && price > settings.maxOrderPriceJpy) {
    throw new Error(`order price exceeds API key limit (${settings.maxOrderPriceJpy} JPY)`)
  }

  if (settings.maxOrderAmountJpy == null) return
  if (directAmount) {
    if (directAmount.value > settings.maxOrderAmountJpy) {
      throw new Error(`order amount exceeds API key limit (${settings.maxOrderAmountJpy} JPY)`)
    }
    return
  }
  if (price == null || quantity == null) {
    throw new Error('order amount limit requires an amount or a price and quantity')
  }

  const amount = price * quantity
  if (amount > settings.maxOrderAmountJpy) {
    throw new Error(`order amount exceeds API key limit (${settings.maxOrderAmountJpy} JPY)`)
  }
}

const checkAndConsumeWindow = async (
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
  const [usage] = await db.select().from(apiKeyTradeUsage).where(where).limit(1)
  const currentCount = usage?.tradeCount ?? 0
  if (currentCount >= limit) throw new Error(`${window} trade limit exceeded for API key`)

  if (usage) {
    await db
      .update(apiKeyTradeUsage)
      .set({ tradeCount: currentCount + 1, updatedAt: now })
      .where(where)
    return
  }

  await db.insert(apiKeyTradeUsage).values({
    apiKeyId,
    window,
    hourBucket,
    tradeCount: 1,
    updatedAt: now,
  })
}

export const assertAndConsumeApiKeyTradeLimits = async ({
  db,
  apiKeyId,
  params,
}: TradeLimitInput & { db: Db }) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)
  if (!key || key.revokedAt) throw new Error('API key is not active')

  assertPriceLimits(params, {
    maxOrderPriceJpy: key.maxOrderPriceJpy,
    maxOrderAmountJpy: key.maxOrderAmountJpy,
  })

  const now = new Date()
  await checkAndConsumeWindow(db, apiKeyId, '1h', key.maxTradesPerHour, now)
  await checkAndConsumeWindow(db, apiKeyId, '6h', key.maxTradesPer6Hours, now)
  await checkAndConsumeWindow(db, apiKeyId, '1d', key.maxTradesPerDay, now)
}

export const assertApiKeyMethodAllowed = async (db: Db, apiKeyId: string, method: string) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)
  if (!key || key.revokedAt) throw new Error('API key is not active')
  if (key.allowedMethods === null || key.allowedMethods === undefined) return
  if (key.allowedMethods.includes(method)) return
  throw new Error(`API key is not allowed to call ${method}`)
}
