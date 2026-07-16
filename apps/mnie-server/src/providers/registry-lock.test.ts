import { describe, expect, test } from 'vite-plus/test'
import type { AccountProfile, OpenProvider } from './registry'
import { ProviderRegistry } from './registry'

const profile = {
  id: 'profile-1',
  provider: 'smbc-direct',
} as AccountProfile

describe('ProviderRegistry.use', () => {
  test('serializes concurrent operations for the same profile', async () => {
    const registry = Object.create(ProviderRegistry.prototype) as ProviderRegistry
    let active = 0
    let maximumActive = 0

    registry.open = async () =>
      ({
        profile,
        provider: {},
        persist: async () => {},
        release: async () => {},
      }) as OpenProvider

    const operation = () =>
      registry.use(profile, async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
      })

    await Promise.all([operation(), operation(), operation()])

    expect(maximumActive).toBe(1)
  })
})

describe('ProviderRegistry SMBC history range', () => {
  test('clamps ranges crossing the provider retention boundary', () => {
    const registry = Object.create(ProviderRegistry.prototype) as ProviderRegistry
    const range = registry.normalizeHistoryRange(profile, new Date(0), new Date('2020-01-01Z'))

    expect(range).toBeDefined()
    expect(registry.historyListInput(profile, ...(range as [Date, Date]))).toMatchObject({
      from: '20190101',
      to: '20200101',
    })
  })

  test('skips ranges entirely before the provider retention boundary', () => {
    const registry = Object.create(ProviderRegistry.prototype) as ProviderRegistry

    expect(
      registry.normalizeHistoryRange(profile, new Date(0), new Date('2018-12-31T14:59:59Z')),
    ).toBeUndefined()
  })
})
