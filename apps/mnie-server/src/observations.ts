import { and, desc, eq } from 'drizzle-orm'
import type { AccountKind, TimePrecision, Transaction, TransactionObservation } from '@mnie/types'
import type { Db } from './db'
import {
  financialAccounts,
  transactionObservationRevisions,
  transactionObservationSnapshots,
  transactionObservations,
} from './db/schema'
import { randomId, sha256 } from './security/crypto'

const parserVersion = 'observation-v1'

export interface ObservationProfile {
  id: string
  provider: string
}

interface SnapshotItem {
  observationId: string
  fingerprint: string
}

interface SnapshotPayload {
  version: 1
  items: SnapshotItem[]
}

interface PendingObservation {
  transaction: Transaction
  fingerprint: string
  observationId?: string
  providerTransactionId?: string
}

export interface PersistedObservation {
  observation: TransactionObservation
  /** The history-compatible transaction; Mobile Suica uses the persistent observation ID. */
  historyTransaction: Transaction
}

const institutionId = (connectorTypeId: string) => connectorTypeId

const accountKind = (connectorTypeId: string): AccountKind => {
  if (connectorTypeId === 'mobile-suica') return 'transit-card'
  if (connectorTypeId === 'smbc-direct' || connectorTypeId === 'paypay-bank') return 'bank'
  return 'other'
}

const precisionFor = (connectorTypeId: string): TimePrecision =>
  connectorTypeId === 'mobile-suica' ? 'day' : 'instant'

const hasStableProviderTransactionId = (connectorTypeId: string) =>
  connectorTypeId !== 'mobile-suica'

const fingerprintFor = (transaction: Transaction) =>
  sha256(
    JSON.stringify([
      transaction.occurredAt,
      transaction.kind,
      transaction.direction,
      transaction.status,
      transaction.amount,
      transaction.description,
      transaction.balanceAfter,
    ]),
  )

const parseSnapshot = (payload: unknown): SnapshotPayload | undefined => {
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as { version?: unknown; items?: unknown }
  if (value.version !== 1 || !Array.isArray(value.items)) return undefined
  const items = value.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const value = item as { observationId?: unknown; fingerprint?: unknown }
    return typeof value.observationId === 'string' && typeof value.fingerprint === 'string'
      ? [{ observationId: value.observationId, fingerprint: value.fingerprint }]
      : []
  })
  return { version: 1, items }
}

/** Returns maximum ordered equal-fingerprint matches between two snapshots. */
const alignSnapshot = (previous: SnapshotItem[], current: PendingObservation[]) => {
  const width = current.length + 1
  const scores = new Uint32Array((previous.length + 1) * width)
  const at = (row: number, column: number) => row * width + column
  for (let row = 1; row <= previous.length; row += 1) {
    for (let column = 1; column <= current.length; column += 1) {
      scores[at(row, column)] =
        previous[row - 1]!.fingerprint === current[column - 1]!.fingerprint
          ? scores[at(row - 1, column - 1)]! + 1
          : Math.max(scores[at(row - 1, column)]!, scores[at(row, column - 1)]!)
    }
  }
  const matches = new Map<number, string>()
  let row = previous.length
  let column = current.length
  while (row > 0 && column > 0) {
    if (
      previous[row - 1]!.fingerprint === current[column - 1]!.fingerprint &&
      scores[at(row, column)] === scores[at(row - 1, column - 1)]! + 1
    ) {
      matches.set(column - 1, previous[row - 1]!.observationId)
      row -= 1
      column -= 1
    } else if (scores[at(row - 1, column)]! >= scores[at(row, column - 1)]!) {
      row -= 1
    } else {
      column -= 1
    }
  }
  return matches
}

const normalizedObservation = (
  profile: ObservationProfile,
  transaction: Transaction,
  observationId: string,
  fingerprint: string,
  revision: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  providerTransactionId?: string,
): TransactionObservation => {
  const connectorTypeId = profile.provider
  return {
    id: observationId,
    profileId: profile.id,
    accountId: `financial-account_${sha256(`${profile.id}:${transaction.accountId}`).slice(0, 32)}`,
    source: {
      connectorTypeId,
      institutionId: institutionId(connectorTypeId),
      providerAccountId: transaction.accountId,
      ...(providerTransactionId ? { providerTransactionId } : {}),
      fingerprint,
      revision,
      firstSeenAt: firstSeenAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
    },
    transaction,
    timestamps: { occurredAt: transaction.occurredAt, precision: precisionFor(connectorTypeId) },
  }
}

const ensureFinancialAccount = async (
  db: Db,
  profile: ObservationProfile,
  transaction: Transaction,
  now: Date,
) => {
  const id = `financial-account_${sha256(`${profile.id}:${transaction.accountId}`).slice(0, 32)}`
  await db
    .insert(financialAccounts)
    .values({
      id,
      profileId: profile.id,
      connectorTypeId: profile.provider,
      institutionId: institutionId(profile.provider),
      providerAccountId: transaction.accountId,
      kind: accountKind(profile.provider),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [financialAccounts.profileId, financialAccounts.providerAccountId],
      set: { updatedAt: now },
    })
  return id
}

/**
 * Persists provider observations and their immutable normalized revisions.
 * It deliberately stores only normalized pages for now; provider raw payload
 * capture is added at the provider boundary rather than reconstructed here.
 */
export const persistTransactionObservations = async (
  db: Db,
  profile: ObservationProfile,
  transactions: Transaction[],
  fetchedAt = new Date(),
): Promise<PersistedObservation[]> => {
  const connectorTypeId = profile.provider
  const pending: PendingObservation[] = transactions.map((transaction) => ({
    transaction,
    fingerprint: fingerprintFor(transaction),
    ...(hasStableProviderTransactionId(connectorTypeId)
      ? { providerTransactionId: transaction.id }
      : {}),
  }))

  if (!hasStableProviderTransactionId(connectorTypeId)) {
    const [previousSnapshot] = await db
      .select()
      .from(transactionObservationSnapshots)
      .where(eq(transactionObservationSnapshots.profileId, profile.id))
      .orderBy(desc(transactionObservationSnapshots.fetchedAt))
      .limit(1)
    const previous = parseSnapshot(previousSnapshot?.payload)?.items ?? []
    const matches = alignSnapshot(previous, pending)
    for (const [index, observationId] of matches) pending[index]!.observationId = observationId
  }

  for (const item of pending) {
    if (item.observationId) continue
    if (item.providerTransactionId) {
      const [existing] = await db
        .select()
        .from(transactionObservations)
        .where(
          and(
            eq(transactionObservations.profileId, profile.id),
            eq(transactionObservations.providerTransactionId, item.providerTransactionId),
          ),
        )
        .limit(1)
      if (existing) item.observationId = existing.id
    }
    item.observationId ??= randomId('observation')
  }

  const snapshotId = randomId('observation-snapshot')
  await db.insert(transactionObservationSnapshots).values({
    id: snapshotId,
    profileId: profile.id,
    connectorTypeId,
    payload: {
      version: 1,
      items: pending.map((item) => ({
        observationId: item.observationId!,
        fingerprint: item.fingerprint,
      })),
    } satisfies SnapshotPayload,
    fetchedAt,
  })

  const result: PersistedObservation[] = []
  for (const item of pending) {
    const observationId = item.observationId!
    const financialAccountId = await ensureFinancialAccount(
      db,
      profile,
      item.transaction,
      fetchedAt,
    )
    const [existing] = await db
      .select()
      .from(transactionObservations)
      .where(eq(transactionObservations.id, observationId))
      .limit(1)
    const [latestRevision] = await db
      .select()
      .from(transactionObservationRevisions)
      .where(eq(transactionObservationRevisions.observationId, observationId))
      .orderBy(desc(transactionObservationRevisions.revision))
      .limit(1)
    const unchanged =
      latestRevision &&
      JSON.stringify(latestRevision.normalized) === JSON.stringify(item.transaction)
    const revision = existing
      ? unchanged
        ? existing.currentRevision
        : existing.currentRevision + 1
      : 1

    if (!existing) {
      await db.insert(transactionObservations).values({
        id: observationId,
        profileId: profile.id,
        accountId: financialAccountId,
        connectorTypeId,
        institutionId: institutionId(connectorTypeId),
        providerAccountId: item.transaction.accountId,
        providerTransactionId: item.providerTransactionId ?? null,
        fingerprint: item.fingerprint,
        currentRevision: revision,
        firstSeenAt: fetchedAt,
        lastSeenAt: fetchedAt,
      })
    } else {
      await db
        .update(transactionObservations)
        .set({
          accountId: financialAccountId,
          fingerprint: item.fingerprint,
          currentRevision: revision,
          lastSeenAt: fetchedAt,
        })
        .where(eq(transactionObservations.id, observationId))
    }
    if (!unchanged) {
      await db.insert(transactionObservationRevisions).values({
        observationId,
        revision,
        snapshotId,
        normalized: item.transaction,
        parserVersion,
        fetchedAt,
      })
    }
    const observation = normalizedObservation(
      profile,
      item.transaction,
      observationId,
      item.fingerprint,
      revision,
      existing?.firstSeenAt ?? fetchedAt,
      fetchedAt,
      item.providerTransactionId,
    )
    result.push({
      observation,
      historyTransaction:
        connectorTypeId === 'mobile-suica'
          ? { ...item.transaction, id: observationId }
          : item.transaction,
    })
  }
  return result
}
