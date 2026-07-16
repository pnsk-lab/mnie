import { asc, eq } from 'drizzle-orm'
import type {
  Amount,
  AccountLink,
  AccountLinkInput,
  EconomicEvent,
  EconomicEventView,
  EventsListRequest,
  EventRelation,
  MatchEvidence,
  ObservationBinding,
  Posting,
  ReconciliationProposal,
  ReconciliationProposalRequest,
  Transaction,
  FinancialAccount,
} from '@mnie/types'
import type { Db } from './db'
import { listTransactionObservations } from './observations'
import {
  accountLinks,
  economicEvents,
  eventPostings,
  eventRelations,
  financialAccounts,
  ledgerAccounts,
  observationBindings,
  reconciliationDecisions,
  reconciliationJobs,
  reconciliationProposals,
  transactionObservationRevisions,
  transactionObservations,
} from './db/schema'
import { randomId } from './security/crypto'

const asDate = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be a valid date`)
  return date
}

const asEvent = (row: typeof economicEvents.$inferSelect): EconomicEvent => ({
  id: row.id,
  kind: row.kind as EconomicEvent['kind'],
  state: row.state as EconomicEvent['state'],
  completeness: row.completeness as EconomicEvent['completeness'],
  occurredAt: { from: row.occurredFrom.toISOString(), to: row.occurredTo.toISOString() },
  ...(row.metadata ? { metadata: row.metadata as EconomicEvent['metadata'] } : {}),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const eventView = async (
  db: Db,
  event: typeof economicEvents.$inferSelect,
): Promise<EconomicEventView> => {
  const [postings, bindings, relations] = await Promise.all([
    db.select().from(eventPostings).where(eq(eventPostings.eventId, event.id)),
    db.select().from(observationBindings).where(eq(observationBindings.eventId, event.id)),
    db
      .select()
      .from(eventRelations)
      .where(eq(eventRelations.fromEventId, event.id))
      .orderBy(asc(eventRelations.createdAt)),
  ])
  return {
    event: asEvent(event),
    postings: postings.map(
      (posting): Posting => ({
        id: posting.id,
        eventId: posting.eventId,
        ledgerAccountId: posting.ledgerAccountId,
        side: posting.side as Posting['side'],
        amount: posting.amount as Posting['amount'],
        ...(posting.role ? { role: posting.role as Posting['role'] } : {}),
      }),
    ),
    bindings: bindings.map(
      (binding): ObservationBinding => ({
        id: binding.id,
        observationId: binding.observationId,
        eventId: binding.eventId,
        ...(binding.postingIds ? { postingIds: binding.postingIds } : {}),
        state: binding.state as ObservationBinding['state'],
        provenance: binding.provenance as ObservationBinding['provenance'],
        ...(binding.confidence ? { confidence: Number(binding.confidence) } : {}),
        ...(binding.matcherVersion ? { matcherVersion: binding.matcherVersion } : {}),
        evidence: binding.evidence as MatchEvidence[],
        createdAt: binding.createdAt.toISOString(),
        updatedAt: binding.updatedAt.toISOString(),
      }),
    ),
    relations: relations.map(
      (relation): EventRelation => ({
        id: relation.id,
        fromEventId: relation.fromEventId,
        toEventId: relation.toEventId,
        type: relation.type as EventRelation['type'],
        createdAt: relation.createdAt.toISOString(),
      }),
    ),
  }
}

export const listEconomicEvents = async (db: Db, request: EventsListRequest = {}) => {
  const from = asDate(request.from, 'events.list from')
  const to = asDate(request.to, 'events.list to')
  if (from && to && from > to) throw new Error('events.list from must not be after to')
  const limit = request.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('events.list limit must be an integer between 1 and 500')
  }
  const rows = await db.select().from(economicEvents).orderBy(asc(economicEvents.occurredFrom))
  const filtered = rows.filter(
    (event) =>
      (!from || event.occurredTo >= from) &&
      (!to || event.occurredFrom <= to) &&
      (!request.states || request.states.includes(event.state as EconomicEvent['state'])),
  )
  let matching = filtered
  if (request.accountId) {
    const ledgerIds = new Set(
      (
        await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.financialAccountId, request.accountId))
      ).map((account) => account.id),
    )
    const postings = await db.select().from(eventPostings)
    const eventIds = new Set(
      postings
        .filter((posting) => ledgerIds.has(posting.ledgerAccountId))
        .map((posting) => posting.eventId),
    )
    matching = matching.filter((event) => eventIds.has(event.id))
  }
  const items = await Promise.all(matching.slice(0, limit).map((event) => eventView(db, event)))
  return { items }
}

export const getEconomicEvent = async (db: Db, eventId: string) => {
  if (!eventId) throw new Error('eventId is required')
  const [event] = await db
    .select()
    .from(economicEvents)
    .where(eq(economicEvents.id, eventId))
    .limit(1)
  if (!event) throw new Error('economic event not found')
  return eventView(db, event)
}

const asAccountLink = (row: typeof accountLinks.$inferSelect): AccountLink => ({
  id: row.id,
  sourceAccountId: row.sourceAccountId,
  targetAccountId: row.targetAccountId,
  type: row.type as AccountLink['type'],
  ...(row.instrument ? { instrument: row.instrument as AccountLink['instrument'] } : {}),
  ...(row.validFrom ? { validFrom: row.validFrom.toISOString() } : {}),
  ...(row.validTo ? { validTo: row.validTo.toISOString() } : {}),
  source: row.source as AccountLink['source'],
  confirmed: row.confirmed,
})

export const listAccountLinks = async (db: Db) =>
  (await db.select().from(accountLinks).orderBy(asc(accountLinks.id))).map(asAccountLink)

export const listFinancialAccounts = async (db: Db): Promise<FinancialAccount[]> =>
  (await db.select().from(financialAccounts).orderBy(asc(financialAccounts.createdAt))).map(
    (account) => ({
      id: account.id,
      profileId: account.profileId,
      connectorTypeId: account.connectorTypeId,
      institutionId: account.institutionId,
      providerAccountId: account.providerAccountId,
      kind: account.kind as FinancialAccount['kind'],
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    }),
  )

export const upsertAccountLink = async (db: Db, input: AccountLinkInput): Promise<AccountLink> => {
  if (!input.sourceAccountId || !input.targetAccountId) {
    throw new Error('sourceAccountId and targetAccountId are required')
  }
  if (input.sourceAccountId === input.targetAccountId) {
    throw new Error('an account link must connect two different accounts')
  }
  const validFrom = asDate(input.validFrom, 'account link validFrom')
  const validTo = asDate(input.validTo, 'account link validTo')
  if (validFrom && validTo && validFrom > validTo) {
    throw new Error('account link validFrom must not be after validTo')
  }
  const accounts = await db.select({ id: financialAccounts.id }).from(financialAccounts)
  const accountIds = new Set(accounts.map((account) => account.id))
  if (!accountIds.has(input.sourceAccountId) || !accountIds.has(input.targetAccountId)) {
    throw new Error('account link references an unknown financial account')
  }
  const id = input.id ?? randomId('account-link')
  const [existing] = await db.select().from(accountLinks).where(eq(accountLinks.id, id)).limit(1)
  if (existing && existing.source !== 'user') {
    throw new Error('provider or inferred account links cannot be modified through this operation')
  }
  const values = {
    id,
    sourceAccountId: input.sourceAccountId,
    targetAccountId: input.targetAccountId,
    type: input.type,
    instrument: input.instrument ?? null,
    validFrom: validFrom ?? null,
    validTo: validTo ?? null,
    source: 'user' as const,
    confirmed: true,
  }
  await db
    .insert(accountLinks)
    .values(values)
    .onConflictDoUpdate({ target: accountLinks.id, set: values })
  const [saved] = await db.select().from(accountLinks).where(eq(accountLinks.id, id)).limit(1)
  if (!saved) throw new Error('account link was not saved')
  return asAccountLink(saved)
}

export const deleteAccountLink = async (db: Db, id: string) => {
  if (!id) throw new Error('id is required')
  const [existing] = await db.select().from(accountLinks).where(eq(accountLinks.id, id)).limit(1)
  if (!existing) throw new Error('account link not found')
  if (existing.source !== 'user')
    throw new Error('provider or inferred account links cannot be deleted')
  await db.delete(accountLinks).where(eq(accountLinks.id, id))
}

const moneyAmount = (amount: Amount | null): Extract<Amount, { kind: 'money' }> | undefined =>
  amount?.kind === 'money' ? amount : undefined

const sameAmount = (left: Amount | null, right: Amount | null) => {
  const source = moneyAmount(left)
  const target = moneyAmount(right)
  return Boolean(
    source &&
    target &&
    source.money.currency === target.money.currency &&
    source.money.value === target.money.value,
  )
}

const candidateKey = (sourceObservationId: string, targetObservationId: string) =>
  `wallet-topup:${[sourceObservationId, targetObservationId].sort().join(':')}`

const ledgerForFinancialAccount = async (db: Db, financialAccountId: string) => {
  const [existing] = await db
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.financialAccountId, financialAccountId))
    .limit(1)
  if (existing) return existing.id
  const [financialAccount] = await db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.id, financialAccountId))
    .limit(1)
  if (!financialAccount) throw new Error('financial account not found')
  const id = `ledger_${financialAccount.id}`
  const ledgerClass = financialAccount.kind === 'credit-card' ? 'liability' : 'asset'
  await db
    .insert(ledgerAccounts)
    .values({
      id,
      class: ledgerClass,
      financialAccountId,
      name: financialAccount.providerAccountId,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
  return id
}

interface StoredObservation {
  id: string
  accountId: string
  timePrecision: 'instant' | 'minute' | 'day'
  transaction: Transaction
}

const observationTimeRange = (observation: StoredObservation): [number, number] => {
  const from = new Date(observation.transaction.occurredAt).getTime()
  const duration =
    observation.timePrecision === 'day'
      ? 24 * 60 * 60_000 - 1
      : observation.timePrecision === 'minute'
        ? 60_000 - 1
        : 0
  return [from, from + duration]
}

const timeDistanceMs = (left: StoredObservation, right: StoredObservation) => {
  const [leftFrom, leftTo] = observationTimeRange(left)
  const [rightFrom, rightTo] = observationTimeRange(right)
  if (leftTo < rightFrom) return rightFrom - leftTo
  if (rightTo < leftFrom) return leftFrom - rightTo
  return 0
}

const storedObservations = async (db: Db, from: Date, to: Date): Promise<StoredObservation[]> => {
  const observations = await listTransactionObservations(db)
  return observations.flatMap((observation) => {
    const transaction = observation.transaction
    const occurredAt = new Date(transaction.occurredAt)
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt < from || occurredAt > to) return []
    return [
      {
        id: observation.id,
        accountId: observation.accountId,
        timePrecision: observation.timestamps.precision,
        transaction,
      },
    ]
  })
}

const createWalletTopupProposal = async (
  db: Db,
  source: StoredObservation,
  target: StoredObservation,
  link: AccountLink | undefined,
  competingCandidates: number,
) => {
  const key = candidateKey(source.id, target.id)
  const [rejected] = await db
    .select()
    .from(reconciliationDecisions)
    .where(eq(reconciliationDecisions.candidateKey, key))
    .limit(1)
  if (rejected?.decision === 'rejected') return false
  const [existing] = await db
    .select()
    .from(reconciliationProposals)
    .where(eq(reconciliationProposals.candidateKey, key))
    .limit(1)
  if (existing) return false
  const amount = moneyAmount(source.transaction.amount)
  if (!amount) return false
  const now = new Date()
  const eventId = randomId('economic-event')
  const sourceLedgerAccountId = await ledgerForFinancialAccount(db, source.accountId)
  const targetLedgerAccountId = await ledgerForFinancialAccount(db, target.accountId)
  const sourcePostingId = randomId('posting')
  const targetPostingId = randomId('posting')
  const sourceBindingId = randomId('binding')
  const targetBindingId = randomId('binding')
  const sourceTime = new Date(source.transaction.occurredAt)
  const targetTime = new Date(target.transaction.occurredAt)
  await db.insert(economicEvents).values({
    id: eventId,
    kind: 'wallet-topup',
    state: 'proposed',
    completeness: 'complete',
    occurredFrom: sourceTime < targetTime ? sourceTime : targetTime,
    occurredTo: sourceTime < targetTime ? targetTime : sourceTime,
    metadata: link?.instrument?.network ? { rail: link.instrument.network } : null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(eventPostings).values([
    {
      id: sourcePostingId,
      eventId,
      ledgerAccountId: sourceLedgerAccountId,
      side: 'credit',
      amount,
      role: 'source',
    },
    {
      id: targetPostingId,
      eventId,
      ledgerAccountId: targetLedgerAccountId,
      side: 'debit',
      amount,
      role: 'destination',
    },
  ])
  const evidence: MatchEvidence[] = [
    { kind: 'same-amount', value: amount.money.value, currency: amount.money.currency },
    { kind: 'time-distance', milliseconds: timeDistanceMs(source, target) },
    ...(link ? ([{ kind: 'account-link', accountLinkId: link.id }] satisfies MatchEvidence[]) : []),
    { kind: 'rule', ruleId: 'wallet-topup-v1' },
    ...(competingCandidates > 1
      ? ([{ kind: 'competing-candidates', count: competingCandidates }] satisfies MatchEvidence[])
      : []),
  ]
  const score = competingCandidates > 1 ? '0.60' : link ? '0.95' : '0.75'
  await db.insert(observationBindings).values([
    {
      id: sourceBindingId,
      observationId: source.id,
      eventId,
      postingIds: [sourcePostingId],
      state: 'proposed',
      provenance: 'deterministic-rule',
      confidence: score,
      matcherVersion: 'wallet-topup-v1',
      evidence,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: targetBindingId,
      observationId: target.id,
      eventId,
      postingIds: [targetPostingId],
      state: 'proposed',
      provenance: 'deterministic-rule',
      confidence: score,
      matcherVersion: 'wallet-topup-v1',
      evidence,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(reconciliationProposals).values({
    id: randomId('reconciliation-proposal'),
    candidateKey: key,
    eventId,
    score,
    state: 'proposed',
    createdAt: now,
  })
  return true
}

const selectOneToOneCandidates = <
  T extends { sourceObservation: StoredObservation; targetObservation: StoredObservation },
>(
  candidates: T[],
) => {
  const usedSourceIds = new Set<string>()
  const usedTargetIds = new Set<string>()
  return [...candidates]
    .sort((left, right) => {
      const distance =
        timeDistanceMs(left.sourceObservation, left.targetObservation) -
        timeDistanceMs(right.sourceObservation, right.targetObservation)
      if (distance !== 0) return distance
      const source = left.sourceObservation.id.localeCompare(right.sourceObservation.id)
      return source !== 0
        ? source
        : left.targetObservation.id.localeCompare(right.targetObservation.id)
    })
    .filter((candidate) => {
      if (
        usedSourceIds.has(candidate.sourceObservation.id) ||
        usedTargetIds.has(candidate.targetObservation.id)
      ) {
        return false
      }
      usedSourceIds.add(candidate.sourceObservation.id)
      usedTargetIds.add(candidate.targetObservation.id)
      return true
    })
}

/** Generates the nearest one-to-one debit-funded wallet top-up candidates for user review. */
export const reconcileRange = async (db: Db, from: Date, to: Date) => {
  const [links, observations] = await Promise.all([
    listAccountLinks(db),
    storedObservations(db, from, to),
  ])
  let created = 0
  const source = observations.filter((observation) => observation.transaction.direction === 'debit')
  const target = observations.filter(
    (observation) =>
      observation.transaction.direction === 'credit' && observation.transaction.kind === 'charge',
  )
  const candidates = selectOneToOneCandidates(
    source.flatMap((sourceObservation) =>
      target
        .filter(
          (targetObservation) =>
            sourceObservation.accountId !== targetObservation.accountId &&
            sameAmount(
              sourceObservation.transaction.amount,
              targetObservation.transaction.amount,
            ) &&
            timeDistanceMs(sourceObservation, targetObservation) <= 36 * 60 * 60_000,
        )
        .map((targetObservation) => ({ sourceObservation, targetObservation })),
    ),
  )
  for (const candidate of candidates) {
    const link = links.find(
      (candidateLink) =>
        candidateLink.confirmed &&
        candidateLink.type === 'funds' &&
        candidateLink.sourceAccountId === candidate.sourceObservation.accountId &&
        candidateLink.targetAccountId === candidate.targetObservation.accountId,
    )
    if (
      await createWalletTopupProposal(
        db,
        candidate.sourceObservation,
        candidate.targetObservation,
        link,
        1,
      )
    ) {
      created += 1
    }
  }
  return created
}

export const enqueueReconciliation = async (db: Db, from: Date, to: Date) => {
  if (from > to) throw new Error('reconciliation job from must not be after to')
  await db.insert(reconciliationJobs).values({
    id: randomId('reconciliation-job'),
    from,
    to,
    state: 'queued',
    createdAt: new Date(),
  })
}

export const runQueuedReconciliation = async (db: Db) => {
  const [job] = await db
    .select()
    .from(reconciliationJobs)
    .where(eq(reconciliationJobs.state, 'queued'))
    .orderBy(asc(reconciliationJobs.createdAt))
    .limit(1)
  if (!job) return null
  const startedAt = new Date()
  await db
    .update(reconciliationJobs)
    .set({ state: 'running', startedAt, error: null })
    .where(eq(reconciliationJobs.id, job.id))
  try {
    const created = await reconcileRange(db, job.from, job.to)
    await db
      .update(reconciliationJobs)
      .set({ state: 'completed', completedAt: new Date() })
      .where(eq(reconciliationJobs.id, job.id))
    return created
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await db
      .update(reconciliationJobs)
      .set({ state: 'failed', completedAt: new Date(), error: message })
      .where(eq(reconciliationJobs.id, job.id))
    throw cause
  }
}

const proposalObservations = async (db: Db, eventId: string) => {
  const bindings = await db
    .select()
    .from(observationBindings)
    .where(eq(observationBindings.eventId, eventId))
  const revisions = await db.select().from(transactionObservationRevisions)
  const observations = await db.select().from(transactionObservations)
  const revisionByObservation = new Map(
    revisions.map((revision) => [
      `${revision.observationId}:${revision.revision}`,
      revision.normalized,
    ]),
  )
  const currentRevision = new Map(
    observations.map((observation) => [observation.id, observation.currentRevision]),
  )
  return bindings.flatMap((binding) => {
    const revision = currentRevision.get(binding.observationId)
    const transaction =
      revision && revisionByObservation.get(`${binding.observationId}:${revision}`)
    return transaction ? [transaction as Transaction] : []
  })
}

export const listReconciliationProposals = async (
  db: Db,
  request: ReconciliationProposalRequest = {},
) => {
  const rows = await db
    .select()
    .from(reconciliationProposals)
    .orderBy(asc(reconciliationProposals.createdAt))
  const filtered = rows.filter(
    (proposal) => !request.states || request.states.includes(proposal.state as never),
  )
  const items = await Promise.all(
    filtered
      .slice(0, request.limit ?? filtered.length)
      .map(async (proposal): Promise<ReconciliationProposal> => {
        const view = await getEconomicEvent(db, proposal.eventId)
        return {
          id: proposal.id,
          candidateKey: proposal.candidateKey,
          event: view.event,
          observations: await proposalObservations(db, proposal.eventId),
          bindings: view.bindings,
          score: Number(proposal.score),
          createdAt: proposal.createdAt.toISOString(),
        }
      }),
  )
  return { items }
}

export const confirmReconciliationProposal = async (db: Db, proposalId: string) => {
  const [proposal] = await db
    .select()
    .from(reconciliationProposals)
    .where(eq(reconciliationProposals.id, proposalId))
    .limit(1)
  if (!proposal) throw new Error('reconciliation proposal not found')
  if (proposal.state !== 'proposed') throw new Error('reconciliation proposal is no longer pending')
  const now = new Date()
  const bindings = await db
    .select()
    .from(observationBindings)
    .where(eq(observationBindings.eventId, proposal.eventId))
  await db.transaction(async (tx) => {
    await tx
      .update(economicEvents)
      .set({ state: 'confirmed', updatedAt: now })
      .where(eq(economicEvents.id, proposal.eventId))
    for (const binding of bindings) {
      await tx
        .update(observationBindings)
        .set({ state: 'confirmed', provenance: 'user', updatedAt: now })
        .where(eq(observationBindings.id, binding.id))
    }
    await tx
      .update(reconciliationProposals)
      .set({ state: 'confirmed' })
      .where(eq(reconciliationProposals.id, proposal.id))
    await tx.insert(reconciliationDecisions).values({
      id: randomId('reconciliation-decision'),
      proposalId: proposal.id,
      candidateKey: proposal.candidateKey,
      decision: 'confirmed',
      decidedAt: now,
    })
  })
  return getEconomicEvent(db, proposal.eventId)
}

export const rejectReconciliationProposal = async (db: Db, proposalId: string, reason?: string) => {
  const [proposal] = await db
    .select()
    .from(reconciliationProposals)
    .where(eq(reconciliationProposals.id, proposalId))
    .limit(1)
  if (!proposal) throw new Error('reconciliation proposal not found')
  if (proposal.state !== 'proposed') throw new Error('reconciliation proposal is no longer pending')
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(economicEvents)
      .set({ state: 'superseded', updatedAt: now })
      .where(eq(economicEvents.id, proposal.eventId))
    await tx
      .update(observationBindings)
      .set({ state: 'rejected', updatedAt: now })
      .where(eq(observationBindings.eventId, proposal.eventId))
    await tx
      .update(reconciliationProposals)
      .set({ state: 'rejected' })
      .where(eq(reconciliationProposals.id, proposal.id))
    await tx.insert(reconciliationDecisions).values({
      id: randomId('reconciliation-decision'),
      proposalId: proposal.id,
      candidateKey: proposal.candidateKey,
      decision: 'rejected',
      ...(reason ? { reason } : {}),
      decidedAt: now,
    })
  })
}
