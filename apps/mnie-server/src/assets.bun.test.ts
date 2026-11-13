import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import { ensureInitialAssetValuations, fetchAssetValuation } from './assets'
import { createCronSystem } from './cron'
import type { ServerConfig } from './config'
import { createDb } from './db'
import { accountProfiles, assetValuations } from './db/schema'
import { ProviderRegistry } from './providers/registry'

afterEach(() => mock.restore())

const setup = async () => {
  const db = createDb(':memory:')
  const profiles = ['vpass', 'paypay-bank'].map((provider) => ({
    id: `${provider}-profile`,
    provider,
    label: provider,
    color: null,
    keyringAccount: `${provider}-secret`,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
  await db.insert(accountProfiles).values(profiles)
  const registry = new ProviderRegistry(db, {} as ServerConfig)
  const provider: FinancialProvider<OperationMap> = {
    descriptor: { id: 'paypay-bank', name: 'PayPay Bank' },
    accountId: 'bank-account',
    capabilities: () => ['balances:read'],
    operations: () => ['balances.list'],
    checkAvailability: async () => ({ ok: true }),
    invoke: async () =>
      [{ amount: { kind: 'money', money: { currency: 'JPY', value: '100' } } }] as never,
    exportSession: () => ({}),
    close: async () => {},
  }
  const openedProfiles: string[] = []
  const open = spyOn(registry, 'open').mockImplementation(async (profileOrId) => {
    const profile =
      typeof profileOrId === 'string' ? await registry.profile(profileOrId) : profileOrId
    openedProfiles.push(profile.provider)
    if (profile.provider === 'vpass') throw new Error('VPass valuation must not authenticate')
    return { profile, provider, persist: async () => {}, release: async () => {} }
  })
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  return { db, profiles, registry, open, openedProfiles, errors }
}

test('initial valuations skip statement-only VPass profiles and still value bank profiles', async () => {
  const { db, registry, openedProfiles, errors } = await setup()

  await ensureInitialAssetValuations(db, registry)

  expect(openedProfiles).toEqual(['paypay-bank'])
  expect(errors).not.toHaveBeenCalled()
  expect(await db.select().from(assetValuations)).toMatchObject([
    { profileId: 'paypay-bank-profile', value: 100, currency: 'JPY' },
  ])
})

test('an explicit VPass valuation reports an unsupported operation without authenticating', async () => {
  const { profiles, registry, open } = await setup()

  await expect(fetchAssetValuation(registry, profiles[0]!)).rejects.toThrow(
    'vpass does not support asset valuation',
  )
  expect(open).not.toHaveBeenCalled()
})

test('asset refresh skips a healthy statement-only VPass profile and still refreshes a bank', async () => {
  const { db, profiles, registry, openedProfiles, errors } = await setup()
  spyOn(registry, 'availability').mockResolvedValue({
    connection: { ok: true },
    operations: {},
    checkedAt: new Date().toISOString(),
  })
  const cron = createCronSystem(db, {} as ServerConfig, registry)
  try {
    for (const profile of profiles) {
      cron.setAvailability(profile.id, {
        result: { ok: true },
        operations: {},
        checkedAt: new Date(),
      })
    }
  } finally {
    await cron.close()
  }

  expect(openedProfiles).toEqual(['paypay-bank'])
  expect(errors).not.toHaveBeenCalled()
  expect(cron.jobs().find((job) => job.id === 'asset-valuations')?.lastError).toBeUndefined()
  expect(await db.select().from(assetValuations)).toMatchObject([
    { profileId: 'paypay-bank-profile', value: 100, currency: 'JPY' },
  ])
})
