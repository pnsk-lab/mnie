import { describe, expect, test } from 'bun:test'
import type { Transaction } from '@mnie/types'
import { createDb } from './db'
import { persistTransactionObservations } from './observations'
import {
  confirmReconciliationProposal,
  enqueueReconciliation,
  listAccountLinks,
  listEconomicEvents,
  listReconciliationProposals,
  rejectReconciliationProposal,
  runQueuedReconciliation,
  upsertAccountLink,
} from './reconciliation'

const transaction = (id: string, accountId: string): Transaction => ({
  id,
  accountId,
  kind: 'withdrawal',
  direction: 'debit',
  status: 'posted',
  amount: { kind: 'money', money: { currency: 'JPY', value: '5000' } },
  occurredAt: '2026-07-14T12:00:00+09:00',
  description: id,
})

const charge = (id: string, accountId: string): Transaction => ({
  id,
  accountId,
  kind: 'charge',
  direction: 'credit',
  status: 'posted',
  amount: { kind: 'money', money: { currency: 'JPY', value: '5000' } },
  occurredAt: '2026-07-14T00:00:00+09:00',
  description: id,
  charge: { method: 'card' },
})

describe('reconciliation store', () => {
  test('accepts user account links only between persisted financial accounts', async () => {
    const db = createDb(':memory:')
    const [bank] = await persistTransactionObservations(
      db,
      { id: 'bank', provider: 'smbc-direct' },
      [transaction('bank-row', 'bank-account')],
    )
    const [suica] = await persistTransactionObservations(
      db,
      { id: 'suica', provider: 'mobile-suica' },
      [transaction('suica-row', 'mobile-suica')],
    )
    const saved = await upsertAccountLink(db, {
      sourceAccountId: bank!.observation.accountId,
      targetAccountId: suica!.observation.accountId,
      type: 'funds',
      source: 'inferred',
      confirmed: false,
    })

    expect(saved.source).toBe('user')
    expect(saved.confirmed).toBe(true)
    expect(await listAccountLinks(db)).toEqual([saved])
    await expect(
      upsertAccountLink(db, {
        sourceAccountId: 'missing',
        targetAccountId: saved.targetAccountId,
        type: 'funds',
        source: 'user',
        confirmed: true,
      }),
    ).rejects.toThrow('unknown financial account')
  })

  test('returns an empty event page before a matcher has generated proposals', async () => {
    const db = createDb(':memory:')
    await expect(listEconomicEvents(db)).resolves.toEqual({ items: [] })
  })

  test('queues, proposes, confirms, and respects rejected wallet top-ups', async () => {
    const db = createDb(':memory:')
    const [bank] = await persistTransactionObservations(
      db,
      { id: 'bank', provider: 'smbc-direct' },
      [transaction('bank-row', 'bank-account')],
    )
    const [suica] = await persistTransactionObservations(
      db,
      { id: 'suica', provider: 'mobile-suica' },
      [charge('suica-row', 'mobile-suica')],
    )
    await upsertAccountLink(db, {
      sourceAccountId: bank!.observation.accountId,
      targetAccountId: suica!.observation.accountId,
      type: 'funds',
      source: 'user',
      confirmed: true,
    })
    const from = new Date('2026-07-13T00:00:00+09:00')
    const to = new Date('2026-07-15T00:00:00+09:00')
    await enqueueReconciliation(db, from, to)
    await expect(runQueuedReconciliation(db)).resolves.toBe(1)
    const [proposal] = (await listReconciliationProposals(db)).items
    expect(proposal?.event.kind).toBe('wallet-topup')
    expect(proposal?.bindings).toHaveLength(2)
    const confirmed = await confirmReconciliationProposal(db, proposal!.id)
    expect(confirmed.event.state).toBe('confirmed')
    expect(confirmed.postings.map((posting) => posting.side).sort()).toEqual(['credit', 'debit'])

    // A rejected candidate is retained as an audit decision and never becomes proposed again.
    const dbRejected = createDb(':memory:')
    const [rejectedBank] = await persistTransactionObservations(
      dbRejected,
      { id: 'bank', provider: 'smbc-direct' },
      [transaction('bank-row', 'bank-account')],
    )
    const [rejectedSuica] = await persistTransactionObservations(
      dbRejected,
      { id: 'suica', provider: 'mobile-suica' },
      [charge('suica-row', 'mobile-suica')],
    )
    await upsertAccountLink(dbRejected, {
      sourceAccountId: rejectedBank!.observation.accountId,
      targetAccountId: rejectedSuica!.observation.accountId,
      type: 'funds',
      source: 'user',
      confirmed: true,
    })
    await enqueueReconciliation(dbRejected, from, to)
    await runQueuedReconciliation(dbRejected)
    const [rejectedProposal] = (await listReconciliationProposals(dbRejected)).items
    await rejectReconciliationProposal(dbRejected, rejectedProposal!.id, 'not related')
    await enqueueReconciliation(dbRejected, from, to)
    await expect(runQueuedReconciliation(dbRejected)).resolves.toBe(0)
  })
})
