import { describe, expect, test } from 'bun:test'
import { createDb } from './db'
import { accountProfiles, financialAccounts, virtualAccountAssets } from './db/schema'
import { createVirtualAccount } from './virtual-accounts'
import {
  fetchPhysicalAccountAssets,
  positionCostBasis,
  updatePhysicalAccountAssetCache,
} from './physical-accounts'
import { accountPositions } from './account-read-model'
import type { FinancialProvider, InvestmentPosition, MethodMap } from '@mnie/types'

const owner = { owner: true }

const sbiLikePosition = (overrides: Partial<InvestmentPosition> = {}): InvestmentPosition => ({
  id: 'cash:1306:XTKS:specific',
  accountId: 'primary',
  instrumentId: '1306',
  instrumentName: 'ＮＦＴＯＰＩＸ',
  venue: 'XTKS',
  quantity: '9',
  positionType: 'cash',
  accountType: 'specific',
  averagePrice: { currency: 'JPY', value: '428' },
  currentPrice: { currency: 'JPY', value: '386.1111111111111' },
  marketValue: { currency: 'JPY', value: '3475' },
  unrealizedProfitLoss: { currency: 'JPY', value: '-377' },
  ...overrides,
})

const stubProvider = (positions: InvestmentPosition[]) =>
  ({
    methods: () => ['investments.positions.list'],
    invoke: async () => ({ items: positions }),
  }) as unknown as FinancialProvider<MethodMap>

describe('position cost basis', () => {
  test('derives total cost from market value minus profit/loss', () => {
    expect(positionCostBasis(sbiLikePosition())).toEqual({ currency: 'JPY', value: '3852' })
  })

  test('falls back to average price times quantity', () => {
    expect(
      positionCostBasis(
        sbiLikePosition({ marketValue: undefined, unrealizedProfitLoss: undefined }),
      ),
    ).toEqual({ currency: 'JPY', value: '3852' })
  })

  test('returns undefined without a usable cost basis', () => {
    expect(
      positionCostBasis(
        sbiLikePosition({
          marketValue: undefined,
          unrealizedProfitLoss: undefined,
          averagePrice: undefined,
        }),
      ),
    ).toBeUndefined()
  })

  test('ignores profit/loss in another currency', () => {
    expect(
      positionCostBasis(
        sbiLikePosition({
          marketValue: { currency: 'JPY', value: '3475' },
          unrealizedProfitLoss: { currency: 'USD', value: '-2' },
          averagePrice: undefined,
        }),
      ),
    ).toBeUndefined()
  })
})

describe('physical position prices with cost basis', () => {
  test('snapshot keeps market unit price and total cost, read model reports profit/loss', async () => {
    const db = createDb(':memory:')
    const now = new Date()
    await db.insert(accountProfiles).values({
      id: 'connection',
      provider: 'test',
      label: 'test',
      keyringAccount: 'unused',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(financialAccounts).values({
      id: 'physical',
      profileId: 'connection',
      connectorTypeId: 'test',
      institutionId: 'test',
      providerAccountId: 'provider-account',
      kind: 'brokerage',
      createdAt: now,
      updatedAt: now,
    })

    const [physical] = db.select().from(financialAccounts).all()
    const assets = await fetchPhysicalAccountAssets(stubProvider([sbiLikePosition()]), physical!)
    expect(assets).toHaveLength(1)
    expect(assets[0]?.price).toEqual({ currency: 'JPY', value: '386.1111111111111' })
    expect(assets[0]?.costBasis).toEqual({ currency: 'JPY', value: '3852' })
    await updatePhysicalAccountAssetCache(db, 'physical', assets)

    const account = await createVirtualAccount(db, {
      physicalAccountId: 'physical',
      label: 'main',
    })
    await db.insert(virtualAccountAssets).values({
      virtualAccountId: account.id,
      assetKey: 'security:1306:XTKS:cash:specific',
      assetKind: 'security',
      available: '9',
      reserved: '0',
      pending: '0',
      updatedAt: now,
    })

    const positions = await accountPositions(db, account.id, owner)
    expect(positions).toHaveLength(1)
    expect(positions[0]?.instrumentId).toBe('1306')
    expect(positions[0]?.marketValue?.currency).toBe('JPY')
    expect(Number(positions[0]?.marketValue?.value)).toBeCloseTo(3475, 9)
    expect(positions[0]?.unrealizedProfitLoss?.currency).toBe('JPY')
    expect(Number(positions[0]?.unrealizedProfitLoss?.value)).toBeCloseTo(-377, 9)
  })
})
