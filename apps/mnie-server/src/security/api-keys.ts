import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import { apiKeys } from '../db/schema'
import { randomId, randomToken, sha256 } from './crypto'

export interface ApiKeySettings {
  maxTradesPerHour?: number | null
  maxTradesPer6Hours?: number | null
  maxTradesPerDay?: number | null
  maxOrderPriceJpy?: number | null
  maxOrderAmountJpy?: number | null
  allowedMethods?: string[] | null
  scopes?: string[] | null
}

const normalizeLimit = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error('limit must be a positive number')
  return Math.floor(number)
}

export const normalizeApiKeySettings = (settings: ApiKeySettings = {}) => ({
  maxTradesPerHour: normalizeLimit(settings.maxTradesPerHour),
  maxTradesPer6Hours: normalizeLimit(settings.maxTradesPer6Hours),
  maxTradesPerDay: normalizeLimit(settings.maxTradesPerDay),
  maxOrderPriceJpy: normalizeLimit(settings.maxOrderPriceJpy),
  maxOrderAmountJpy: normalizeLimit(settings.maxOrderAmountJpy),
  allowedMethods:
    settings.allowedMethods === undefined
      ? null
      : settings.allowedMethods?.length
        ? [...new Set(settings.allowedMethods)].sort()
        : null,
  scopes:
    settings.scopes === undefined
      ? null
      : settings.scopes?.length
        ? [...new Set(settings.scopes)].sort()
        : null,
})

export const listApiKeys = async (db: Db) =>
  db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      maxTradesPerHour: apiKeys.maxTradesPerHour,
      maxTradesPer6Hours: apiKeys.maxTradesPer6Hours,
      maxTradesPerDay: apiKeys.maxTradesPerDay,
      maxOrderPriceJpy: apiKeys.maxOrderPriceJpy,
      maxOrderAmountJpy: apiKeys.maxOrderAmountJpy,
      allowedMethods: apiKeys.allowedMethods,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .orderBy(apiKeys.createdAt)

export const createApiKey = async (db: Db, label: string, settings: ApiKeySettings = {}) => {
  const token = `mnie_${randomToken()}`
  const now = new Date()
  const row = {
    id: randomId('key'),
    label,
    tokenHash: sha256(token),
    ...normalizeApiKeySettings(settings),
    createdAt: now,
  }
  await db.insert(apiKeys).values(row)
  return { ...row, token, tokenHash: undefined }
}

export const updateApiKeySettings = async (db: Db, id: string, settings: ApiKeySettings) => {
  await db.update(apiKeys).set(normalizeApiKeySettings(settings)).where(eq(apiKeys.id, id))
}

export const revokeApiKey = async (db: Db, id: string) => {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id))
}

export const verifyApiKey = async (db: Db, token: string) => {
  const tokenHash = sha256(token)
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tokenHash, tokenHash), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!row) return undefined
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  return row
}
