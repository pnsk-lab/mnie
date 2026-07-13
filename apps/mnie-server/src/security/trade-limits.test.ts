import { describe, expect, test } from 'bun:test'
import { createDb } from '../db'
import { apiKeys } from '../db/schema'
import { assertAndConsumeApiKeyTradeLimits, isTransactionOperation } from './trade-limits'

const database = async (maxOrderAmountJpy = 10_000) => {
  const db = createDb(':memory:')
  await db.insert(apiKeys).values({
    id: 'key',
    label: 'test',
    tokenHash: 'hash',
    maxOrderAmountJpy,
    createdAt: new Date(),
  })
  return db
}

describe('provider-neutral trade limits', () => {
  test('classifies common create, replace and cancel operations as transactions', () => {
    expect(isTransactionOperation('investments.orders.preview', {})).toBe(false)
    expect(isTransactionOperation('investments.orders.create', {})).toBe(true)
    expect(isTransactionOperation('investments.orders.replace', {})).toBe(true)
    expect(isTransactionOperation('investments.orders.cancel', {})).toBe(true)
  })
  test('accepts a JPY notional order below the limit', async () => {
    const db = await database()
    await expect(
      assertAndConsumeApiKeyTradeLimits({
        db,
        apiKeyId: 'key',
        params: { amount: { currency: 'JPY', value: '1000' } },
      }),
    ).resolves.toBeUndefined()
  })

  test('rejects a notional order above the limit', async () => {
    const db = await database()
    await expect(
      assertAndConsumeApiKeyTradeLimits({
        db,
        apiKeyId: 'key',
        params: { amount: { currency: 'JPY', value: '10001' } },
      }),
    ).rejects.toThrow('order amount exceeds API key limit')
  })

  test('requires conversion before applying JPY limits to another currency', async () => {
    const db = await database()
    await expect(
      assertAndConsumeApiKeyTradeLimits({
        db,
        apiKeyId: 'key',
        params: { amount: { currency: 'USD', value: '100' } },
      }),
    ).rejects.toThrow('explicit currency conversion')
  })

  test('rejects non-positive provider-neutral order values', async () => {
    const db = await database()
    await expect(
      assertAndConsumeApiKeyTradeLimits({
        db,
        apiKeyId: 'key',
        params: { amount: { currency: 'JPY', value: '-1' } },
      }),
    ).rejects.toThrow('order amount must be positive')
  })
})
