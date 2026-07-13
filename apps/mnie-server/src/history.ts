import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { HistoryItem, HistoryListRequest, Transaction } from '@mnie/types'
import type { Db } from './db'
import { accountProfiles, assetValuations, historySyncs, historyTransactions } from './db/schema'
import type { ProviderRegistry } from './providers/registry'

const refreshIntervalMs = 5 * 60 * 60_000
const defaultRangeMs = 30 * 24 * 60 * 60_000
const initialHistoryFrom = new Date(0)
const smbcDirectInitialHistoryFrom = new Date('2019-01-01T00:00:00+09:00')
type Profile = typeof accountProfiles.$inferSelect

const requestedRange = (request: HistoryListRequest) => {
  const to = request.to ? new Date(request.to) : new Date()
  const from = request.from ? new Date(request.from) : new Date(to.getTime() - defaultRangeMs)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error('history.list from and to must be valid dates')
  }
  if (from > to) throw new Error('history.list from must not be after to')
  return { from, to }
}

const syncTransactions = async (
  db: Db,
  providers: ProviderRegistry,
  profile: Profile,
  from: Date,
  to: Date,
  allowCachedCurrentRange: boolean,
  forceLogin = false,
) => {
  const [sync] = await db.select().from(historySyncs).where(eq(historySyncs.profileId, profile.id))
  const fresh = sync && Date.now() - sync.fetchedAt.getTime() < refreshIntervalMs
  if (fresh && sync.coveredFrom <= from && (allowCachedCurrentRange || sync.coveredTo >= to)) return

  await providers.use(
    profile,
    async ({ provider }) => {
      if (!provider.operations().includes('history.list')) {
        throw new Error(`${profile.provider} does not provide transaction history`)
      }
      const fetchPage = async (rangeFrom: Date, rangeTo: Date): Promise<HistoryItem[]> => {
        const range = providers.normalizeHistoryRange(profile, rangeFrom, rangeTo)
        if (!range) return []
        const [effectiveFrom, effectiveTo] = range
        const input = providers.historyListInput(profile, effectiveFrom, effectiveTo)

        try {
          const page = (await provider.invoke('history.list', input)) as { items: HistoryItem[] }
          return page.items
        } catch (cause) {
          const split = providers.splitHistoryRange(profile, cause, effectiveFrom, effectiveTo)
          if (!split) throw cause
          const [leftFrom, leftTo, rightFrom, rightTo] = split
          const left = await fetchPage(leftFrom, leftTo)
          const right = await fetchPage(rightFrom, rightTo)
          return [...left, ...right]
        }
      }
      const items = await fetchPage(from, to)
      const fetchedAt = new Date()
      for (const item of items) {
        if (item.kind !== 'transaction') continue
        const occurredAt = new Date(item.occurredAt)
        if (!Number.isFinite(occurredAt.getTime())) {
          throw new Error(`provider returned invalid transaction date: ${item.occurredAt}`)
        }
        await db
          .insert(historyTransactions)
          .values({
            profileId: profile.id,
            transactionId: item.transaction.id,
            occurredAt,
            transaction: item.transaction,
            fetchedAt,
          })
          .onConflictDoUpdate({
            target: [historyTransactions.profileId, historyTransactions.transactionId],
            set: {
              occurredAt,
              transaction: item.transaction,
              fetchedAt,
            },
          })
      }
      await db
        .insert(historySyncs)
        .values({ profileId: profile.id, coveredFrom: from, coveredTo: to, fetchedAt })
        .onConflictDoUpdate({
          target: historySyncs.profileId,
          set: {
            coveredFrom: sync && sync.coveredFrom < from ? sync.coveredFrom : from,
            coveredTo: sync && sync.coveredTo > to ? sync.coveredTo : to,
            fetchedAt,
          },
        })
    },
    { forceLogin },
  )
}

export const listHistory = async (
  db: Db,
  providers: ProviderRegistry,
  request: HistoryListRequest & { profileIds?: string[]; forceRefresh?: boolean },
) => {
  const { from, to } = requestedRange(request)
  const kinds = new Set(request.kinds ?? ['transaction', 'snapshot'])
  const profiles = (
    await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  ).filter((profile) => !request.profileIds || request.profileIds.includes(profile.id))
  const errors: Array<{ profileId: string; providerId: string; message: string }> = []

  if (kinds.has('transaction')) {
    const allowCachedCurrentRange = request.to == null
    for (const profile of profiles) {
      try {
        await syncTransactions(
          db,
          providers,
          profile,
          from,
          to,
          allowCachedCurrentRange,
          request.forceRefresh === true,
        )
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        errors.push({ profileId: profile.id, providerId: profile.provider, message })
        console.error(`History synchronization failed for ${profile.id}:`, cause)
      }
    }
  }

  const profileIds = profiles.map((profile) => profile.id)
  const items: HistoryItem[] = []
  if (kinds.has('transaction') && profileIds.length) {
    const rows = await db
      .select()
      .from(historyTransactions)
      .where(
        and(
          inArray(historyTransactions.profileId, profileIds),
          gte(historyTransactions.occurredAt, from),
          lte(historyTransactions.occurredAt, to),
        ),
      )
      .orderBy(asc(historyTransactions.occurredAt))
    items.push(
      ...rows.map((row) => ({
        kind: 'transaction' as const,
        profileId: row.profileId,
        occurredAt: row.occurredAt.toISOString(),
        transaction: row.transaction as Transaction,
      })),
    )
  }
  if (kinds.has('snapshot') && profileIds.length) {
    const rows = await db
      .select()
      .from(assetValuations)
      .where(
        and(
          inArray(assetValuations.profileId, profileIds),
          gte(assetValuations.capturedAt, from),
          lte(assetValuations.capturedAt, to),
        ),
      )
      .orderBy(asc(assetValuations.capturedAt))
    items.push(
      ...rows.map((row) => {
        const occurredAt = row.capturedAt.toISOString()
        const amount = { currency: row.currency, value: String(row.value) }
        return {
          kind: 'snapshot' as const,
          profileId: row.profileId,
          occurredAt,
          snapshot: {
            accountId: row.profileId,
            capturedAt: occurredAt,
            balances: [],
            valuation: {
              amount,
              asOf: occurredAt,
              ...(row.holdingsValue == null
                ? {}
                : { holdingsAmount: { currency: row.currency, value: String(row.holdingsValue) } }),
              ...(row.cashValue == null
                ? {}
                : { cashAmount: { currency: row.currency, value: String(row.cashValue) } }),
            },
          },
        }
      }),
    )
  }
  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const limit = request.limit ?? items.length
  return { items: items.slice(0, limit), errors }
}

export const forceSyncHistory = async (
  db: Db,
  providers: ProviderRegistry,
  request: { profileId: string; from: string; to: string },
) => {
  const [profile] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, request.profileId))
  if (!profile) throw new Error(`profile not found: ${request.profileId}`)

  requestedRange(request)
  await db.delete(historySyncs).where(eq(historySyncs.profileId, request.profileId))
  const result = await listHistory(db, providers, {
    profileIds: [request.profileId],
    kinds: ['transaction'],
    from: request.from,
    to: request.to,
    forceRefresh: true,
  })
  return {
    profileId: request.profileId,
    from: request.from,
    to: request.to,
    synced: result.items.filter(
      (item) => item.kind === 'transaction' && item.profileId === request.profileId,
    ).length,
    errors: result.errors,
  }
}

export const syncInitialHistory = async (
  db: Db,
  providers: ProviderRegistry,
  profileId: string,
) => {
  const profile = await providers.profile(profileId)
  const history = await listHistory(db, providers, {
    profileIds: [profileId],
    kinds: ['transaction'],
    from:
      profile.provider === 'smbc-direct'
        ? smbcDirectInitialHistoryFrom.toISOString()
        : initialHistoryFrom.toISOString(),
    to: new Date().toISOString(),
  })
  const errors = history.errors.filter((error) => error.profileId === profileId)
  if (errors.length) {
    throw new Error(
      `Initial history synchronization failed: ${errors.map((error) => error.message).join('; ')}`,
    )
  }
  return history.items.filter((item) => item.kind === 'transaction' && item.profileId === profileId)
    .length
}
