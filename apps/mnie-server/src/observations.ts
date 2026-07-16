import { and, desc, eq } from 'drizzle-orm'
import type { Transaction, TransactionObservation, TransactionObservationPolicy } from '@mnie/types'
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
  connectorTypeId: string
  policy: TransactionObservationPolicy
}

interface SnapshotItem {
  observationId: string
  fingerprint: string
}

interface SnapshotPayload {
  version: 1
  fingerprintVersion: string
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
  /** Ordered snapshots use the persistent observation ID for history storage. */
  historyTransaction: Transaction
}

const fingerprintVersion = (policy: TransactionObservationPolicy) =>
  policy.identity.kind === 'ordered-snapshot'
    ? policy.identity.fingerprintVersion
    : 'stable-provider-id-v1'

const fingerprintFor = (policy: TransactionObservationPolicy, transaction: Transaction) =>
  sha256(
    policy.identity.kind === 'ordered-snapshot'
      ? policy.identity.fingerprint(transaction)
      : JSON.stringify(transaction),
  )

const classificationIndependentKey = (accountId: string, transaction: Transaction) =>
  JSON.stringify([
    accountId,
    transaction.accountId,
    transaction.occurredAt,
    transaction.status,
    transaction.amount,
    transaction.description,
    transaction.balanceAfter,
  ])

const parseSnapshot = (payload: unknown): SnapshotPayload | undefined => {
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as { version?: unknown; fingerprintVersion?: unknown; items?: unknown }
  if (value.version !== 1 || !Array.isArray(value.items)) return undefined
  const items = value.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const value = item as { observationId?: unknown; fingerprint?: unknown }
    return typeof value.observationId === 'string' && typeof value.fingerprint === 'string'
      ? [{ observationId: value.observationId, fingerprint: value.fingerprint }]
      : []
  })
  return {
    version: 1,
    fingerprintVersion:
      typeof value.fingerprintVersion === 'string' ? value.fingerprintVersion : 'legacy-v1',
    items,
  }
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
  const connectorTypeId = profile.connectorTypeId
  return {
    id: observationId,
    profileId: profile.id,
    accountId: `financial-account_${sha256(`${profile.id}:${transaction.accountId}`).slice(0, 32)}`,
    source: {
      connectorTypeId,
      institutionId: profile.policy.institutionId,
      providerAccountId: transaction.accountId,
      ...(providerTransactionId ? { providerTransactionId } : {}),
      fingerprint,
      revision,
      firstSeenAt: firstSeenAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
    },
    transaction,
    timestamps: { occurredAt: transaction.occurredAt, precision: profile.policy.timePrecision },
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
      connectorTypeId: profile.connectorTypeId,
      institutionId: profile.policy.institutionId,
      providerAccountId: transaction.accountId,
      kind: profile.policy.accountKind,
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
  const connectorTypeId = profile.connectorTypeId
  const pending: PendingObservation[] = transactions.map((transaction) => ({
    transaction,
    fingerprint: fingerprintFor(profile.policy, transaction),
    ...(profile.policy.identity.kind === 'stable-provider-id'
      ? { providerTransactionId: transaction.id }
      : {}),
  }))

  if (profile.policy.identity.kind === 'ordered-snapshot') {
    const [previousSnapshot] = await db
      .select()
      .from(transactionObservationSnapshots)
      .where(eq(transactionObservationSnapshots.profileId, profile.id))
      .orderBy(desc(transactionObservationSnapshots.fetchedAt))
      .limit(1)
    const parsedPrevious = parseSnapshot(previousSnapshot?.payload)
    const previous =
      parsedPrevious?.fingerprintVersion === fingerprintVersion(profile.policy)
        ? parsedPrevious.items
        : []
    const matches = alignSnapshot(previous, pending)
    for (const [index, observationId] of matches) pending[index]!.observationId = observationId

    const existingObservations = await db
      .select()
      .from(transactionObservations)
      .where(eq(transactionObservations.profileId, profile.id))
    const existingRevisions = await db.select().from(transactionObservationRevisions)
    const revisionByObservation = new Map(
      existingRevisions.map((revision) => [
        `${revision.observationId}:${revision.revision}`,
        revision.normalized as Transaction,
      ]),
    )
    const observationBySourceId = new Map(
      existingObservations.flatMap((observation) => {
        const transaction = revisionByObservation.get(
          `${observation.id}:${observation.currentRevision}`,
        )
        return transaction ? [[transaction.id, observation.id] as const] : []
      }),
    )
    const claimed = new Set(pending.flatMap((item) => item.observationId ?? []))
    for (const item of pending) {
      if (item.observationId) continue
      const observationId = observationBySourceId.get(item.transaction.id)
      if (!observationId || claimed.has(observationId)) continue
      item.observationId = observationId
      claimed.add(observationId)
    }
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
      fingerprintVersion: fingerprintVersion(profile.policy),
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
        institutionId: profile.policy.institutionId,
        providerAccountId: item.transaction.accountId,
        providerTransactionId: item.providerTransactionId ?? null,
        fingerprint: item.fingerprint,
        timePrecision: profile.policy.timePrecision,
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
          timePrecision: profile.policy.timePrecision,
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
        profile.policy.identity.kind === 'ordered-snapshot'
          ? { ...item.transaction, id: observationId }
          : item.transaction,
    })
  }
  return result
}

/** Returns the latest normalized revision of every persisted transaction without contacting providers. */
export const listTransactionObservations = async (db: Db): Promise<TransactionObservation[]> => {
  const [observations, revisions, snapshots] = await Promise.all([
    db.select().from(transactionObservations),
    db.select().from(transactionObservationRevisions),
    db
      .select()
      .from(transactionObservationSnapshots)
      .orderBy(desc(transactionObservationSnapshots.fetchedAt)),
  ])
  const latestSnapshotByProfile = new Map<string, SnapshotPayload>()
  for (const snapshot of snapshots) {
    if (latestSnapshotByProfile.has(snapshot.profileId)) continue
    const parsed = parseSnapshot(snapshot.payload)
    if (parsed) latestSnapshotByProfile.set(snapshot.profileId, parsed)
  }
  const activeOrderedObservationIds = new Set(
    [...latestSnapshotByProfile.values()].flatMap((snapshot) =>
      snapshot.items.map((item) => item.observationId),
    ),
  )
  const revisionById = new Map(
    revisions.map((revision) => [
      `${revision.observationId}:${revision.revision}`,
      revision.normalized as Transaction,
    ]),
  )
  const normalized = observations.flatMap((observation) => {
    const transaction = revisionById.get(`${observation.id}:${observation.currentRevision}`)
    if (!transaction) return []
    return [
      {
        id: observation.id,
        profileId: observation.profileId,
        accountId: observation.accountId,
        source: {
          connectorTypeId: observation.connectorTypeId,
          institutionId: observation.institutionId,
          providerAccountId: observation.providerAccountId,
          ...(observation.providerTransactionId
            ? { providerTransactionId: observation.providerTransactionId }
            : {}),
          fingerprint: observation.fingerprint,
          revision: observation.currentRevision,
          firstSeenAt: observation.firstSeenAt.toISOString(),
          lastSeenAt: observation.lastSeenAt.toISOString(),
        },
        transaction,
        timestamps: {
          occurredAt: transaction.occurredAt,
          precision: observation.timePrecision as TransactionObservationPolicy['timePrecision'],
        },
      } satisfies TransactionObservation,
    ]
  })
  const orderedSnapshotGroups = new Map<string, TransactionObservation[]>()
  const stableObservations: TransactionObservation[] = []
  for (const observation of normalized) {
    if (observation.source.providerTransactionId) {
      stableObservations.push(observation)
      continue
    }
    const key = classificationIndependentKey(observation.accountId, observation.transaction)
    orderedSnapshotGroups.set(key, [...(orderedSnapshotGroups.get(key) ?? []), observation])
  }
  const orderedSnapshotObservations = [...orderedSnapshotGroups.values()].flatMap((group) => {
    const active = group.filter((observation) => activeOrderedObservationIds.has(observation.id))
    return active.length ? active : group
  })
  return [...stableObservations, ...orderedSnapshotObservations].sort((left, right) =>
    right.timestamps.occurredAt.localeCompare(left.timestamps.occurredAt),
  )
}
