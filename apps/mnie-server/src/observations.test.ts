import { describe, expect, test } from 'vite-plus/test'
import type { Transaction } from '@mnie/types'
import { createDb } from './db'
import { transactionObservationRevisions } from './db/schema'
import { persistTransactionObservations } from './observations'

const mobileTransaction = (description: string, balance: string): Transaction => ({
  id: `source-${description}`,
  accountId: 'mobile-suica',
  kind: 'charge',
  direction: 'credit',
  status: 'posted',
  amount: { kind: 'money', money: { currency: 'JPY', value: '5000' } },
  occurredAt: '2026-07-14T00:00:00+09:00',
  description,
  balanceAfter: { kind: 'money', money: { currency: 'JPY', value: balance } },
  charge: { method: 'card' },
})

const smbcTransaction = (status: Transaction['status'] = 'posted'): Transaction => ({
  id: 'meisai-1',
  accountId: '0001-1234567',
  kind: 'withdrawal',
  direction: 'debit',
  status,
  amount: { kind: 'money', money: { currency: 'JPY', value: '5000' } },
  occurredAt: '2026-07-14T12:00:00+09:00',
  description: 'モバイルSuica',
})

describe('transaction observations', () => {
  test('keeps Mobile Suica observation identities when a new row is prepended', async () => {
    const db = createDb(':memory:')
    const profile = { id: 'suica', provider: 'mobile-suica' }
    const initial = await persistTransactionObservations(db, profile, [
      mobileTransaction('older-a', '10000'),
      mobileTransaction('older-b', '5000'),
    ])
    const next = await persistTransactionObservations(db, profile, [
      mobileTransaction('newer', '15000'),
      mobileTransaction('older-a', '10000'),
      mobileTransaction('older-b', '5000'),
    ])

    expect(next[1]!.observation.id).toBe(initial[0]!.observation.id)
    expect(next[2]!.observation.id).toBe(initial[1]!.observation.id)
    expect(next[0]!.historyTransaction.id).toBe(next[0]!.observation.id)
    expect(next[1]!.observation.timestamps.precision).toBe('day')
  })

  test('creates a new revision only when a stable upstream observation changes', async () => {
    const db = createDb(':memory:')
    const profile = { id: 'smbc', provider: 'smbc-direct' }
    const [initial] = await persistTransactionObservations(db, profile, [smbcTransaction()])
    const [unchanged] = await persistTransactionObservations(db, profile, [smbcTransaction()])
    const [changed] = await persistTransactionObservations(db, profile, [
      smbcTransaction('reversed'),
    ])
    const revisions = await db.select().from(transactionObservationRevisions)

    expect(unchanged!.observation.id).toBe(initial!.observation.id)
    expect(unchanged!.observation.source.revision).toBe(1)
    expect(changed!.observation.source.revision).toBe(2)
    expect(revisions).toHaveLength(2)
  })
})
