import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import {
  createProvider as createMobileSuicaProvider,
  exportSession as exportMobileSuicaSession,
  importSession as importMobileSuicaSession,
} from '@mnie/provider-mobile-suica'
import {
  createProvider as createSmbcProvider,
  exportSession as exportSmbcSession,
  importSession as importSmbcSession,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import type {
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  OperationMap,
  Transaction,
} from '@mnie/types'
import type { ServerConfig } from './config'
import type { Db } from './db'
import { accountProfiles, assetValuations, historySyncs, historyTransactions } from './db/schema'
import type { StoredMobileSuicaSecret, StoredSmbcDirectSecret } from './routes/admin'
import { connectSbi } from './rpc/sbi-session'
import { readSecret, saveSecret } from './security/keyring'

const refreshIntervalMs = 5 * 60 * 60_000
const defaultRangeMs = 30 * 24 * 60 * 60_000
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

const yyyymmdd = (date: Date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`

const providerFor = async (
  db: Db,
  config: ServerConfig,
  profile: Profile,
): Promise<{ provider: FinancialProvider<OperationMap>; persist(): Promise<void> }> => {
  if (profile.provider === 'sbisec') {
    return { provider: await connectSbi(db, config, profile.id), persist: async () => {} }
  }
  if (profile.provider === 'smbc-direct') {
    const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
    if (!secret.session) throw new Error('SMBC Direct session is not available')
    const imported = await importSmbcSession(secret.session as SmbcDirectSession)
    return {
      provider: createSmbcProvider(imported) as FinancialProvider<OperationMap>,
      persist: async () =>
        saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportSmbcSession(imported),
        } satisfies StoredSmbcDirectSecret),
    }
  }
  if (profile.provider === 'mobilesuica') {
    const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
    if (!secret.session) throw new Error('Mobile Suica session is not available')
    const imported = await importMobileSuicaSession(secret.session)
    return {
      provider: createMobileSuicaProvider(imported) as FinancialProvider<OperationMap>,
      persist: async () =>
        saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportMobileSuicaSession(imported),
        } satisfies StoredMobileSuicaSecret),
    }
  }
  throw new Error(`${profile.provider} does not provide transaction history`)
}

const syncTransactions = async (
  db: Db,
  config: ServerConfig,
  profile: Profile,
  from: Date,
  to: Date,
) => {
  const [sync] = await db.select().from(historySyncs).where(eq(historySyncs.profileId, profile.id))
  const fresh = sync && Date.now() - sync.fetchedAt.getTime() < refreshIntervalMs
  if (fresh && sync.coveredFrom <= from && sync.coveredTo >= to) return

  const { provider, persist } = await providerFor(db, config, profile)
  const input =
    profile.provider === 'smbc-direct'
      ? { from: yyyymmdd(from), to: yyyymmdd(to), kinds: ['transaction'] as const }
      : { kinds: ['transaction'] as const }
  try {
    const page = (await provider.invoke('history.list', input)) as { items: HistoryItem[] }
    const fetchedAt = new Date()
    for (const item of page.items) {
      if (item.kind !== 'transaction') continue
      await db
        .insert(historyTransactions)
        .values({
          profileId: profile.id,
          transactionId: item.transaction.id,
          occurredAt: new Date(item.occurredAt),
          transaction: item.transaction,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: [historyTransactions.profileId, historyTransactions.transactionId],
          set: {
            occurredAt: new Date(item.occurredAt),
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
  } finally {
    await persist()
  }
}

export const listHistory = async (
  db: Db,
  config: ServerConfig,
  request: HistoryListRequest & { profileIds?: string[] },
) => {
  const { from, to } = requestedRange(request)
  const kinds = new Set(request.kinds ?? ['transaction', 'snapshot'])
  const profiles = (
    await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  ).filter((profile) => !request.profileIds || request.profileIds.includes(profile.id))

  if (kinds.has('transaction')) {
    for (const profile of profiles.filter((item) => item.provider !== 'paypay-bank')) {
      await syncTransactions(db, config, profile, from, to)
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
  return { items: items.slice(0, limit) }
}
