import { describe, expect, test } from 'bun:test'
import type { FinancialProvider, MethodMap } from '@mnie/types'
import { createDb } from './db'
import {
  accountProfiles,
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
} from './db/schema'
import { discoverPhysicalAccounts, syncInitialUnallocatedAssets } from './physical-accounts'
import type { ProviderRegistry } from './providers/registry'
import {
  ensureDefaultVirtualAccounts,
  listVirtualAccountAssets,
  listVirtualAccounts,
} from './virtual-accounts'

describe('physical account discovery', () => {
  test('persists non-brokerage accounts returned by the authenticated provider', async () => {
    const db = createDb(':memory:')
    const profile = {
      id: 'profile-1',
      provider: 'test-broker',
      label: '証券',
      keyringAccount: 'unused',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      color: null,
    }
    await db.insert(accountProfiles).values(profile)
    const provider = {
      methods: () => ['accounts.list', 'balances.list'],
      invoke: async (operation: string) =>
        operation === 'accounts.list'
          ? {
              items: [
                {
                  id: 'provider-account-1',
                  providerId: 'test-broker',
                  kind: 'bank',
                  name: '銀行口座',
                },
              ],
            }
          : [
              {
                accountId: 'provider-account-1',
                type: 'current',
                amount: { kind: 'money', money: { currency: 'JPY', value: '1234.50' } },
                asOf: new Date(0).toISOString(),
              },
            ],
    } as unknown as FinancialProvider<MethodMap>
    const providers = {
      profiles: async () => [profile],
      descriptor: () => ({
        id: profile.id,
        provider: { id: 'test-broker', name: 'Test Broker' },
        label: profile.label,
        category: 'bank',
        defaultColor: '#000000',
      }),
      use: async (_profile: unknown, action: (open: { provider: typeof provider }) => unknown) =>
        action({ provider }),
    } as unknown as ProviderRegistry

    await expect(discoverPhysicalAccounts(db, providers)).resolves.toEqual({
      discovered: 1,
      physicalAccountIds: [expect.any(String)],
    })
    expect(await db.select().from(financialAccounts)).toEqual([
      expect.objectContaining({
        profileId: profile.id,
        providerAccountId: 'provider-account-1',
        kind: 'bank',
      }),
    ])
    await ensureDefaultVirtualAccounts(db)
    await expect(syncInitialUnallocatedAssets(db, providers)).resolves.toEqual({
      synced: 1,
      errors: [],
    })
    expect(await db.select().from(physicalAccountAssets)).toEqual([
      expect.objectContaining({ assetKey: 'cash:JPY', amount: '1234.5' }),
    ])
    expect(await db.select().from(virtualAccountAssets)).toEqual([])
    const [unallocated] = await listVirtualAccounts(db, { owner: true })
    expect(await listVirtualAccountAssets(db, unallocated!.id, { owner: true })).toEqual([
      expect.objectContaining({ assetKey: 'cash:JPY', available: '1234.5' }),
    ])
  })

  test('uses the latest transaction balance when a transit provider has no balance operation', async () => {
    const db = createDb(':memory:')
    const profile = {
      id: 'mobile-suica-profile',
      provider: 'mobile-suica',
      label: 'Mobile Suica',
      keyringAccount: 'unused',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      color: null,
    }
    await db.insert(accountProfiles).values(profile)
    const provider = {
      methods: () => ['accounts.list', 'transactions.list'],
      invoke: async (operation: string) => {
        if (operation === 'accounts.list') {
          return {
            items: [
              {
                id: 'mobile-suica',
                providerId: 'mobile-suica',
                kind: 'transit-card',
                name: 'Mobile Suica',
              },
            ],
          }
        }
        return {
          items: [
            {
              id: 'older',
              accountId: 'mobile-suica',
              kind: 'payment',
              direction: 'debit',
              status: 'posted',
              amount: null,
              description: 'older',
              occurredAt: '2026-08-01T00:00:00.000Z',
              balanceAfter: { kind: 'money', money: { currency: 'JPY', value: '800' } },
            },
            {
              id: 'latest',
              accountId: 'mobile-suica',
              kind: 'payment',
              direction: 'debit',
              status: 'posted',
              amount: null,
              description: 'latest',
              occurredAt: '2026-08-02T00:00:00.000Z',
              balanceAfter: { kind: 'money', money: { currency: 'JPY', value: '650' } },
            },
          ],
        }
      },
    } as unknown as FinancialProvider<MethodMap>
    const providers = {
      profiles: async () => [profile],
      descriptor: () => ({
        id: profile.id,
        provider: { id: 'mobile-suica', name: 'Mobile Suica' },
        label: profile.label,
        category: 'transit',
        defaultColor: '#000000',
      }),
      use: async (_profile: unknown, action: (open: { provider: typeof provider }) => unknown) =>
        action({ provider }),
    } as unknown as ProviderRegistry

    await discoverPhysicalAccounts(db, providers)
    await ensureDefaultVirtualAccounts(db)

    await expect(syncInitialUnallocatedAssets(db, providers)).resolves.toEqual({
      synced: 1,
      errors: [],
    })
    expect(await db.select().from(physicalAccountAssets)).toEqual([
      expect.objectContaining({ assetKey: 'cash:JPY', amount: '650' }),
    ])
    expect(await db.select().from(virtualAccountAssets)).toEqual([])
  })
})
