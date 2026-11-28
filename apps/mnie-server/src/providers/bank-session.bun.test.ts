import { expect, test } from 'bun:test'
import { sessionManager } from '@mnie/provider-smbc-direct'
import type { CommonMethods, FinancialProvider } from '@mnie/types'

test('SMBC session updates use fresh state without locking local account discovery', async () => {
  const key = 'test-session'
  const firstStarted = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  const reads: number[] = []
  let savedVersion = 0
  const metadata = {
    invoke: async () => ({ items: [] }),
  } as unknown as FinancialProvider<CommonMethods>
  const load = async () => {
    const version = savedVersion
    reads.push(version)
    return {
      provider: {
        ...metadata,
        async checkAvailability() {
          if (version === 0) {
            firstStarted.resolve()
            await releaseFirst.promise
          }
          return { ok: true as const }
        },
      },
      async persist() {
        savedVersion = version + 1
      },
    }
  }

  const first = sessionManager.bind(key, metadata, load)
  const second = sessionManager.bind(key, metadata, load)
  const firstCheck = first.checkAvailability()
  await firstStarted.promise
  const secondCheck = second.checkAvailability()
  try {
    await expect(second.invoke('accounts.list', {})).resolves.toEqual({ items: [] })
    await expect(sessionManager.run('another-session', async () => 'independent')).resolves.toBe(
      'independent',
    )
    expect(reads).toEqual([0])
  } finally {
    releaseFirst.resolve()
  }
  await Promise.all([firstCheck, secondCheck])
  expect(reads).toEqual([0, 1])
  expect(savedVersion).toBe(2)
})
