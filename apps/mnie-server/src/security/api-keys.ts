import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import {
  apiKeys,
  apiKeyVirtualAccounts,
  virtualAccounts,
  accountAudit,
  virtualOrderQuotes,
} from '../db/schema'
import { randomId, randomToken, sha256 } from './crypto'
import { accountScopedPortfolioMethods, legacyAccountMethods } from './legacy-account-methods'
import { scopedAdminMethods } from './admin-account-scope'

export interface ApiKeySettings {
  accountBindings?: Array<{
    accountId: string
    role: 'read' | 'trade'
    allowedMethods?: string[] | null
  }>
  maxOrderPriceJpy?: number | null
  maxOrderAmountJpy?: number | null
  allowedMethods?: string[] | null
  scopes?: string[] | null
}

const normalizeLimit = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('limit must be a positive number')
  return Math.floor(number)
}

export const normalizeApiKeySettings = (settings: ApiKeySettings = {}) => ({
  maxOrderPriceJpy: normalizeLimit(settings.maxOrderPriceJpy),
  maxOrderAmountJpy: normalizeLimit(settings.maxOrderAmountJpy),
  allowedMethods:
    settings.allowedMethods == null ? null : [...new Set(settings.allowedMethods)].sort(),
  scopes: settings.scopes == null ? null : [...new Set(settings.scopes)].sort(),
})

export const listApiKeys = async (db: Db) => {
  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      maxOrderPriceJpy: apiKeys.maxOrderPriceJpy,
      maxOrderAmountJpy: apiKeys.maxOrderAmountJpy,
      allowedMethods: apiKeys.allowedMethods,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .orderBy(apiKeys.createdAt)
  const bindings = await db.select().from(apiKeyVirtualAccounts)
  return rows.map((row) => ({
    ...row,
    accountBindings: bindings
      .filter((binding) => binding.apiKeyId === row.id)
      .map((binding) => ({
        accountId: binding.virtualAccountId,
        role: binding.role,
        allowedMethods: binding.allowedMethods,
      })),
  }))
}

export const validateAccountBindings = (
  db: Db,
  bindings: ApiKeySettings['accountBindings'] = [],
) => {
  if (!Array.isArray(bindings)) throw new Error('accountBindings must be an array')
  if (new Set(bindings.map((binding) => binding.accountId)).size !== bindings.length)
    throw new Error('duplicate account binding')
  for (const binding of bindings) {
    if (
      binding.allowedMethods != null &&
      (!Array.isArray(binding.allowedMethods) ||
        binding.allowedMethods.some(
          (m) =>
            typeof m !== 'string' ||
            (!m.startsWith('account.') &&
              !accountScopedPortfolioMethods.has(m) &&
              !scopedAdminMethods.includes(m)),
        ))
    )
      throw new Error('invalid account methods')
    if (!['read', 'trade'].includes(binding.role)) throw new Error('invalid account role')
    const account = db
      .select()
      .from(virtualAccounts)
      .where(eq(virtualAccounts.id, binding.accountId))
      .get()
    if (!account || account.status === 'closed') throw new Error('account not found')
    if (account.kind === 'system' && binding.role === 'trade')
      throw new Error('unallocated accounts only support read bindings')
  }
  return bindings
}

const writeBindings = (
  db: Db,
  id: string,
  bindings: NonNullable<ApiKeySettings['accountBindings']>,
) => {
  const key = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()
  db.delete(apiKeyVirtualAccounts).where(eq(apiKeyVirtualAccounts.apiKeyId, id)).run()
  db.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.principal, id)).run()
  for (const binding of bindings) {
    db.insert(apiKeyVirtualAccounts)
      .values({
        apiKeyId: id,
        virtualAccountId: binding.accountId,
        role: binding.role,
        allowedMethods:
          binding.allowedMethods === undefined
            ? legacyAccountMethods(key?.allowedMethods)
            : binding.allowedMethods,
        createdAt: new Date(),
      })
      .run()
    db.insert(accountAudit)
      .values({
        id: randomId('audit'),
        accountId: binding.accountId,
        event: 'access.updated',
        detail: { apiKeyId: id, role: binding.role },
        createdAt: new Date(),
      })
      .run()
  }
}

export const createApiKeySync = (db: Db, label: string, settings: ApiKeySettings = {}) => {
  const token = `mnie_${randomToken()}`
  const now = new Date()
  const row = {
    id: randomId('key'),
    label,
    tokenHash: sha256(token),
    ...normalizeApiKeySettings(settings),
    createdAt: now,
  }
  const bindings = validateAccountBindings(db, settings.accountBindings)
  db.transaction(() => {
    db.insert(apiKeys).values(row).run()
    writeBindings(db, row.id, bindings)
  })
  return { ...row, token, tokenHash: undefined }
}

export const createApiKey = async (...args: Parameters<typeof createApiKeySync>) =>
  createApiKeySync(...args)

export const updateApiKeySettings = async (db: Db, id: string, settings: ApiKeySettings) => {
  const bindings =
    settings.accountBindings === undefined
      ? undefined
      : validateAccountBindings(db, settings.accountBindings)
  db.transaction(() => {
    db.update(apiKeys).set(normalizeApiKeySettings(settings)).where(eq(apiKeys.id, id)).run()
    db.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.principal, id)).run()
    if (bindings) writeBindings(db, id, bindings)
  })
}

export const revokeApiKey = async (db: Db, id: string) => {
  db.transaction(() => {
    db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)).run()
    db.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.principal, id)).run()
  })
}

export const verifyApiKey = async (db: Db, token: string) => {
  const tokenHash = sha256(token)
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tokenHash, tokenHash), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!row || (row.expiresAt && row.expiresAt <= new Date())) return undefined
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  return row
}
