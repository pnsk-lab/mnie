import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeyTradeUsage, apiKeys } from '../db/schema'
import type { RpcMethod } from '../rpc/methods'

type WindowName = '1h' | '3h' | '1d'

type TradeLimitInput = {
  apiKeyId: string
  params: unknown
}

const windowBucket = (date: Date, window: WindowName) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  if (window === '1d') return `${year}-${month}-${day}`

  const hour = date.getUTCHours()
  const bucketHour = window === '3h' ? Math.floor(hour / 3) * 3 : hour
  return `${year}-${month}-${day}T${String(bucketHour).padStart(2, '0')}`
}

const numberFromParams = (params: unknown, key: string) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  const value = (params as Record<string, unknown>)[key]
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const assertPriceLimits = (
  params: unknown,
  settings: {
    maxOrderPriceJpy: number | null
    maxOrderAmountJpy: number | null
  },
) => {
  const price = numberFromParams(params, 'price')
  const quantity = numberFromParams(params, 'quantity')

  if (settings.maxOrderPriceJpy != null && price != null && price > settings.maxOrderPriceJpy) {
    throw new Error(`order price exceeds API key limit (${settings.maxOrderPriceJpy} JPY)`)
  }

  if (settings.maxOrderAmountJpy == null) return
  if (price == null || quantity == null) {
    throw new Error('order amount limit requires price and quantity in trading params')
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
  await checkAndConsumeWindow(db, apiKeyId, '3h', key.maxTradesPer6Hours, now)
  await checkAndConsumeWindow(db, apiKeyId, '1d', key.maxTradesPerDay, now)
}

export const assertApiKeyMethodAllowed = async (db: Db, apiKeyId: string, method: RpcMethod) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)
  if (!key || key.revokedAt) throw new Error('API key is not active')
  if (key.allowedMethods === null || key.allowedMethods === undefined) return
  if (key.allowedMethods.includes(method)) return
  throw new Error(`API key is not allowed to call ${method}`)
}
