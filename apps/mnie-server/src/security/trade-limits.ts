import { canonicalDecimal, compareDecimal, multiplyDecimal } from '../virtual-accounts'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeys } from '../db/schema'

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
