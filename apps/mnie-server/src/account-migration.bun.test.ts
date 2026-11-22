import { describe, expect, test } from 'bun:test'
import { createDb } from './db'
import { accountProfiles, financialAccounts, virtualAccounts, appState } from './db/schema'
import {
  initializeVirtualAccounts,
  listDerivedUnallocatedAssets,
  listVirtualAccountAssets,
} from './virtual-accounts'
import { migratePhysicalAccount } from './account-migration'
import { PhysicalAccountGateway } from './physical-account-gateway'
import type { ProviderRegistry } from './providers/registry'

const fixture = async (openOrders: unknown[] = []) => {
  const db = createDb(':memory:')
  const now = new Date()
  await db.insert(accountProfiles).values({
    id: 'connection',
    provider: 'fixture',
    label: 'test',
    keyringAccount: 'unused',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(financialAccounts).values({
    id: 'physical',
    profileId: 'connection',
    connectorTypeId: 'fixture',
    institutionId: 'fixture',
    providerAccountId: 'private',
    kind: 'brokerage',
    createdAt: now,
    updatedAt: now,
  })
  await initializeVirtualAccounts(db, 'physical')
  const provider = {
    accountIsolation: {
      physicalCashIncludesReservations: true,
      stableOrderReferences: true,
      attributableSettlementEffects: true,
      completeOpenOrderSnapshot: true,
    },
    methods: () => ['investments.orders.open', 'balances.list'],
    invoke: async (operation: string) =>
      operation === 'investments.orders.open'
        ? { items: openOrders, complete: true }
        : [
            {
              accountId: 'private',
              type: 'current',
              amount: { kind: 'money', money: { currency: 'JPY', value: '5000.50' } },
              asOf: now.toISOString(),
            },
          ],
  }
  const registry = {
    open: async () => ({
      profile: { id: 'connection' },
      provider,
      persist: async () => {},
      release: async () => {},
    }),
  } as unknown as ProviderRegistry
  return { db, gateway: new PhysicalAccountGateway(registry) }
}

describe('existing account migration', () => {
  test('assigns the complete snapshot to Personal once and leaves Unallocated at zero', async () => {
    const { db, gateway } = await fixture()
    try {
      const result = await migratePhysicalAccount(db, gateway, 'physical')
      expect(await listVirtualAccountAssets(db, result.accountId, { owner: true })).toEqual([
        expect.objectContaining({ assetKey: 'cash:JPY', available: '5000.5', reserved: '0' }),
      ])
      expect(listDerivedUnallocatedAssets(db, 'physical')[0]?.available).toBe('0')
      expect(db.select().from(appState).get()?.value).toBe('complete')
      await expect(migratePhysicalAccount(db, gateway, 'physical')).rejects.toThrow(
        'already complete',
      )
    } finally {
      await gateway.close()
    }
  })
  test('refuses to allocate assets while broker open orders are unresolved', async () => {
    const { db, gateway } = await fixture([{ id: 'external-order' }])
    try {
      await expect(migratePhysicalAccount(db, gateway, 'physical')).rejects.toThrow(
        'resolve broker open orders',
      )
      expect(db.select().from(virtualAccounts).all()).toHaveLength(1)
      expect(db.select().from(appState).get()).toBeUndefined()
    } finally {
      await gateway.close()
    }
  })
})
