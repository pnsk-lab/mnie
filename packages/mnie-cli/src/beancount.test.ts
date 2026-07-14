import type { HistoryItem, Transaction } from '@repo/client-mnie'
import { describe, expect, test } from 'vite-plus/test'
import { formatBeancount } from './beancount'

const transactionItem = (
  transaction: Partial<Transaction> = {},
  item: Partial<Extract<HistoryItem, { kind: 'transaction' }>> = {},
): HistoryItem => ({
  kind: 'transaction',
  occurredAt: '2026-05-05T00:00:00.000Z',
  profileId: 'bank-main',
  transaction: {
    id: 'tx-1',
    accountId: 'account-1',
    kind: 'withdrawal',
    direction: 'debit',
    status: 'posted',
    amount: { kind: 'money', money: { currency: 'JPY', value: '1500' } },
    occurredAt: '2026-05-05T00:00:00.000Z',
    description: 'スーパー "中央店"',
    ...transaction,
  } as Transaction,
  ...item,
})

test('renders balanced debit and credit transactions with opens and metadata', () => {
  const output = formatBeancount([
    transactionItem(),
    transactionItem(
      {
        id: 'tx-2',
        kind: 'deposit',
        direction: 'credit',
        amount: { kind: 'money', money: { currency: 'JPY', value: '200000' } },
        occurredAt: '2026-05-06T00:00:00.000Z',
        description: '給与',
      },
      { occurredAt: '2026-05-06T00:00:00.000Z' },
    ),
  ])

  expect(output).toBe(`option "operating_currency" "JPY"

2026-05-05 open Assets:Mnie:BankMain JPY
2026-05-05 open Expenses:Uncategorized JPY
2026-05-06 open Income:Uncategorized JPY

2026-05-05 * "スーパー \\"中央店\\""
  mnie-id: "tx-1"
  mnie-profile-id: "bank-main"
  mnie-kind: "withdrawal"
  Expenses:Uncategorized  1500 JPY
  Assets:Mnie:BankMain  -1500 JPY

2026-05-06 * "給与"
  mnie-id: "tx-2"
  mnie-profile-id: "bank-main"
  mnie-kind: "deposit"
  Assets:Mnie:BankMain  200000 JPY
  Income:Uncategorized  -200000 JPY
`)
})

test('normalizes signed transaction amounts to absolute values', () => {
  const output = formatBeancount([
    transactionItem({
      amount: { kind: 'money', money: { currency: 'JPY', value: '-1500' } },
    }),
  ])

  expect(output).toContain('Assets:Mnie:BankMain  -1500 JPY')
  expect(output).not.toContain('--1500')
})

test('excludes neutral transactions from the export', () => {
  const output = formatBeancount([
    transactionItem({
      id: 'neutral',
      direction: 'neutral',
      amount: null,
    }),
    transactionItem({ id: 'posted' }),
  ])

  expect(output).toContain('mnie-id: "posted"')
  expect(output).not.toContain('mnie-id: "neutral"')
})

test('returns only the operating currency for empty history', () => {
  expect(formatBeancount([])).toBe('option "operating_currency" "JPY"\n')
})

test('sorts transactions and account currencies deterministically', () => {
  const output = formatBeancount([
    transactionItem(
      {
        id: 'b',
        amount: { kind: 'money', money: { currency: 'USD', value: '2.50' } },
      },
      { profileId: '2-wallet' },
    ),
    transactionItem({ id: 'c' }, { profileId: '2-wallet' }),
    transactionItem({ id: 'a' }, { profileId: 'bank-main' }),
  ])

  expect(output.indexOf('mnie-id: "b"')).toBeLessThan(output.indexOf('mnie-id: "a"'))
  expect(output).toContain('Assets:Mnie:Profile2Wallet')
  expect(output).toContain('2026-05-05 open Assets:Mnie:Profile2Wallet JPY USD')
})

describe('unsupported transactions', () => {
  test.each([
    ['missing profile', transactionItem({}, { profileId: undefined })],
    ['invalid date', transactionItem({}, { occurredAt: 'not-a-date' })],
    ['invalid date suffix', transactionItem({}, { occurredAt: '2026-05-05garbage' })],
    ['invalid time', transactionItem({}, { occurredAt: '2026-05-05T99:99:99Z' })],
    ['pending status', transactionItem({ status: 'pending' })],
    ['investment trade', transactionItem({ kind: 'investment-trade' })],
    ['missing amount', transactionItem({ amount: null })],
    [
      'points amount',
      transactionItem({ amount: { kind: 'points', programId: 'p', unit: 'point', value: '1' } }),
    ],
    [
      'invalid currency',
      transactionItem({ amount: { kind: 'money', money: { currency: '円', value: '1' } } }),
    ],
    [
      'invalid decimal',
      transactionItem({ amount: { kind: 'money', money: { currency: 'JPY', value: '1e3' } } }),
    ],
    ['unconvertible profile', transactionItem({}, { profileId: '口座' })],
  ])('rejects %s', (_name, item) => {
    expect(() => formatBeancount([item])).toThrow()
  })

  test('rejects profile IDs that normalize to the same account', () => {
    expect(() =>
      formatBeancount([
        transactionItem({ id: 'one' }, { profileId: 'bank-main' }),
        transactionItem({ id: 'two' }, { profileId: 'bank_main' }),
      ]),
    ).toThrow('profile account collision')
  })
})
