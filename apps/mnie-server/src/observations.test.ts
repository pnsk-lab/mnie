import { describe, expect, test } from 'vite-plus/test'
import type { Transaction } from '@mnie/types'
import { createDb } from './db'
import { transactionObservationRevisions, transactionObservationSnapshots } from './db/schema'
import {
  listTransactionObservations,
  persistTransactionObservations,
  type ObservationProfile,
} from './observations'

const stableProfile = (id: string): ObservationProfile => ({
  id,
  connectorTypeId: 'smbc-direct',
  policy: {
    accountKind: 'bank',
    institutionId: 'smbc',
    timePrecision: 'instant',
    identity: { kind: 'stable-provider-id' },
  },
})

const orderedProfile = (id: string): ObservationProfile => ({
  id,
  connectorTypeId: 'mobile-suica',
  policy: {
    accountKind: 'transit-card',
    institutionId: 'mobile-suica',
    timePrecision: 'day',
    identity: {
      kind: 'ordered-snapshot',
      fingerprintVersion: 'legacy-v1',
      fingerprint: (transaction) =>
        JSON.stringify([
          transaction.occurredAt,
          transaction.kind,
          transaction.direction,
          transaction.status,
          transaction.amount,
          transaction.description,
          transaction.balanceAfter,
        ]),
    },
  },
})

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
  test('lists the latest persisted transactions in reverse chronological order', async () => {
    const db = createDb(':memory:')
    await persistTransactionObservations(db, stableProfile('bank'), [
      smbcTransaction(),
      { ...smbcTransaction(), id: 'meisai-2', occurredAt: '2026-07-15T00:00:00+09:00' },
    ])

    const observations = await listTransactionObservations(db)
    expect(observations.map((item) => item.transaction.id)).toEqual(['meisai-2', 'meisai-1'])
  })

  test('keeps Mobile Suica observation identities when a new row is prepended', async () => {
    const db = createDb(':memory:')
    const profile = orderedProfile('suica')
    const initial = await persistTransactionObservations(db, profile, [
      mobileTransaction('older-a', '10000'),
      mobileTransaction('older-b', '5000'),
    ])
    const [snapshot] = await db.select().from(transactionObservationSnapshots)
    const legacyPayload = snapshot!.payload as { version: 1; items: unknown[] }
    await db
      .update(transactionObservationSnapshots)
      .set({ payload: { version: legacyPayload.version, items: legacyPayload.items } })
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
    const profile = stableProfile('smbc')
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

  test('reclassifies an ordered snapshot row with the same source id as a new revision', async () => {
    const db = createDb(':memory:')
    const profile = orderedProfile('suica')
    const charge = mobileTransaction('ｶｰﾄﾞ モバイル', '5000')
    const other: Transaction = {
      id: charge.id,
      accountId: charge.accountId,
      kind: 'other',
      direction: 'neutral',
      status: charge.status,
      amount: charge.amount,
      occurredAt: charge.occurredAt,
      description: charge.description,
      balanceAfter: charge.balanceAfter,
    }
    const [initial] = await persistTransactionObservations(db, profile, [other])
    const [reclassified] = await persistTransactionObservations(db, profile, [charge])

    expect(reclassified!.observation.id).toBe(initial!.observation.id)
    expect(reclassified!.observation.source.revision).toBe(2)
    expect(await listTransactionObservations(db)).toHaveLength(1)
  })

  test('hides an orphaned ordered-snapshot observation after its classification changed', async () => {
    const db = createDb(':memory:')
    const profile = orderedProfile('suica')
    const charge = mobileTransaction('ｶｰﾄﾞ モバイル', '5000')
    const other: Transaction = {
      ...charge,
      id: 'legacy-row-id',
      kind: 'other',
      direction: 'neutral',
    }
    await persistTransactionObservations(db, profile, [other])
    await persistTransactionObservations(db, profile, [{ ...charge, id: 'stable-row-id' }])

    const listed = await listTransactionObservations(db)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.transaction.kind).toBe('charge')
  })

  test('preserves repeated identical rows from the active ordered snapshot', async () => {
    const db = createDb(':memory:')
    const profile = orderedProfile('suica')
    const repeated = mobileTransaction('ｶｰﾄﾞ モバイル', '5000')
    await persistTransactionObservations(db, profile, [
      { ...repeated, id: 'charge-occurrence-1' },
      { ...repeated, id: 'charge-occurrence-2' },
    ])

    const listed = await listTransactionObservations(db)
    expect(listed).toHaveLength(2)
    expect(listed.every((item) => item.transaction.kind === 'charge')).toBe(true)
  })
})
