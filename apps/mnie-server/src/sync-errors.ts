import { eq, like } from 'drizzle-orm'
import type { Db } from './db'
import { appState } from './db/schema'

export type SyncStage =
  | 'provider_capabilities'
  | 'open_orders'
  | 'order_snapshot'
  | 'external_order_reservations'
  | 'physical_assets'
  | 'reconciliation'
  | 'virtual_account_snapshots'

export type SyncFailureReason = 'maintenance' | 'timeout' | 'authentication' | 'unknown'

export interface ScopedSyncError {
  stage: SyncStage
  scope: string
  reason: SyncFailureReason
  code?: string
  venues?: string[]
  orderId?: string
  accountId?: string
  updatedAt: string
}

const VALID_STAGES = new Set<SyncStage>([
  'provider_capabilities',
  'open_orders',
  'order_snapshot',
  'external_order_reservations',
  'physical_assets',
  'reconciliation',
  'virtual_account_snapshots',
])

const VALID_REASONS = new Set<SyncFailureReason>([
  'maintenance',
  'timeout',
  'authentication',
  'unknown',
])

export const isSyncFailureReason = (value: unknown): value is SyncFailureReason =>
  typeof value === 'string' && VALID_REASONS.has(value as SyncFailureReason)

const legacyKey = (physicalAccountId: string) => `physical_snapshot_error:${physicalAccountId}`
const scopedKey = (physicalAccountId: string, scope: string) =>
  `${legacyKey(physicalAccountId)}:${scope}`

const parseSyncErrorRow = (
  row: typeof appState.$inferSelect,
  physicalAccountId: string,
): ScopedSyncError => {
  const base = legacyKey(physicalAccountId)
  const fallbackScope = row.key === base ? 'legacy' : row.key.slice(`${base}:`.length)
  if (row.key === base) {
    return {
      stage: 'physical_assets',
      scope: 'legacy',
      reason: 'unknown',
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<ScopedSyncError>
    const stage =
      typeof parsed.stage === 'string' && VALID_STAGES.has(parsed.stage as SyncStage)
        ? (parsed.stage as SyncStage)
        : 'physical_assets'
    const scope =
      typeof parsed.scope === 'string' && parsed.scope.length > 0 ? parsed.scope : fallbackScope
    const reason = isSyncFailureReason(parsed.reason) ? parsed.reason : 'unknown'
    const venues =
      Array.isArray(parsed.venues) && parsed.venues.every((item) => typeof item === 'string')
        ? parsed.venues
        : undefined
    return {
      stage,
      scope,
      reason,
      ...(typeof parsed.code === 'string' && parsed.code ? { code: parsed.code } : {}),
      ...(venues?.length ? { venues } : {}),
      ...(typeof parsed.orderId === 'string' && parsed.orderId ? { orderId: parsed.orderId } : {}),
      ...(typeof parsed.accountId === 'string' && parsed.accountId
        ? { accountId: parsed.accountId }
        : {}),
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : row.updatedAt.toISOString(),
    }
  } catch {
    return {
      stage: 'physical_assets',
      scope: fallbackScope,
      reason: 'unknown',
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}

export const listPhysicalSyncErrors = (db: Db, physicalAccountId: string): ScopedSyncError[] => {
  const base = legacyKey(physicalAccountId)
  const prefix = `${base}:`
  // Filter in JS after prefix scan because SQLite LIKE treats `_` in account IDs as a wildcard.
  const rows = db
    .select()
    .from(appState)
    .where(like(appState.key, 'physical_snapshot_error:%'))
    .all()
    .filter((row) => row.key === base || row.key.startsWith(prefix))
  return rows.map((row) => parseSyncErrorRow(row, physicalAccountId))
}

export const setPhysicalSyncError = (
  db: Db,
  physicalAccountId: string,
  error: Omit<ScopedSyncError, 'updatedAt'>,
): ScopedSyncError => {
  const now = new Date()
  const record: ScopedSyncError = {
    stage: error.stage,
    scope: error.scope,
    reason: error.reason,
    ...(error.code ? { code: error.code } : {}),
    ...(error.venues?.length ? { venues: error.venues } : {}),
    ...(error.orderId ? { orderId: error.orderId } : {}),
    ...(error.accountId ? { accountId: error.accountId } : {}),
    updatedAt: now.toISOString(),
  }
  const value = JSON.stringify(record)
  db.insert(appState)
    .values({
      key: scopedKey(physicalAccountId, error.scope),
      value,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value, updatedAt: now },
    })
    .run()
  return record
}

export const clearPhysicalSyncError = (db: Db, physicalAccountId: string, scope: string) => {
  db.delete(appState)
    .where(eq(appState.key, scopedKey(physicalAccountId, scope)))
    .run()
}

export const clearPhysicalSyncErrorsByPrefix = (
  db: Db,
  physicalAccountId: string,
  scopePrefix: string,
) => {
  for (const error of listPhysicalSyncErrors(db, physicalAccountId)) {
    if (error.scope === scopePrefix || error.scope.startsWith(`${scopePrefix}:`)) {
      clearPhysicalSyncError(db, physicalAccountId, error.scope)
    }
  }
}

export const clearLegacyPhysicalSyncError = (db: Db, physicalAccountId: string) => {
  db.delete(appState)
    .where(eq(appState.key, legacyKey(physicalAccountId)))
    .run()
}

export const hasUnscopedPhysicalSyncError = (errors: readonly ScopedSyncError[]) =>
  errors.some(
    (error) =>
      error.scope === 'legacy' ||
      error.stage === 'provider_capabilities' ||
      error.stage === 'physical_assets' ||
      error.stage === 'external_order_reservations' ||
      error.stage === 'reconciliation' ||
      (error.stage === 'open_orders' && !error.venues?.length),
  )

export const blockingSyncErrorsForTrade = (
  errors: readonly ScopedSyncError[],
  context: {
    operation: string
    venue?: string
    orderId?: string
    accountId?: string
    allowVenueScopedWhenVenueOmitted?: boolean
  },
): ScopedSyncError[] =>
  errors.filter((error) => {
    if (error.scope === 'legacy') return true
    if (
      error.stage === 'provider_capabilities' ||
      error.stage === 'external_order_reservations' ||
      error.stage === 'reconciliation'
    )
      return true
    if (error.stage === 'virtual_account_snapshots') return false
    if (error.stage === 'physical_assets') {
      return context.operation !== 'investments.orders.cancel'
    }
    if (error.stage === 'open_orders') {
      if (!error.venues?.length) return true
      if (context.venue) return error.venues.includes(context.venue)
      return !context.allowVenueScopedWhenVenueOmitted
    }
    if (error.stage === 'order_snapshot') {
      if (context.orderId && error.orderId === context.orderId) return true
      if (error.venues?.length) {
        if (context.venue) return error.venues.includes(context.venue)
        return !context.allowVenueScopedWhenVenueOmitted
      }
      return !error.accountId || !context.accountId || error.accountId === context.accountId
    }
    return true
  })

export const formatBlockingSyncError = (errors: readonly ScopedSyncError[]) => {
  const details = errors.map((error) => {
    const cause = error.code ? `${error.reason}: ${error.code}` : error.reason
    return `${error.scope} (${cause})`
  })
  return `broker sync unavailable for ${details.join(', ')}`
}
