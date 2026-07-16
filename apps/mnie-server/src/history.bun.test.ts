import { describe, expect, test } from 'bun:test'
import { createDb } from './db'
import { syncHistorySinceLastCoverage } from './history'
import type { ProviderRegistry } from './providers/registry'

describe('history synchronization', () => {
  test('requires a full sync before synchronizing from the last coverage', async () => {
    const db = createDb(':memory:')
    await expect(
      syncHistorySinceLastCoverage(db, {} as ProviderRegistry, 'profile'),
    ).rejects.toThrow('run a full history sync first')
  })
})
