import { describe, expect, test, vi } from 'vite-plus/test'
import type { FinancialProvider, OperationMap, ProfileDescriptor } from '@mnie/types'
import {
  loadPortfolioOverview,
  portfolioValuationFromOverview,
  type OverviewProfile,
} from './portfolio-overview'

const descriptor = (id: string, category: ProfileDescriptor['category'] = 'brokerage') => ({
  id,
  provider: { id: `provider-${id}`, name: `Provider ${id}` },
  label: `Profile ${id}`,
  category,
  defaultColor: '#123456',
})

const provider = (operations: string[], fail?: string) => {
  const value = {
    operations: () => operations,
    invoke: vi.fn(async (operation: string) => {
      if (operation === fail) throw new Error('fixture failure')
      if (operation === 'accounts.list') return { items: [] }
      if (operation === 'balances.list') return []
      if (operation === 'assets.valuation.get') {
        return { amount: { currency: 'JPY', value: '100' }, asOf: new Date().toISOString() }
      }
      return { items: [] }
    }),
  } as unknown as FinancialProvider<OperationMap>
  return value
}

const overviewProfile = (profile: ProfileDescriptor, value: FinancialProvider<OperationMap>) => ({
  descriptor: profile,
  use: vi.fn(async (action: Parameters<OverviewProfile['use']>[0]) => action(value)),
})

describe('portfolio overview', () => {
  test('invokes only advertised operations through the managed provider session', async () => {
    const brokerage = provider(['accounts.list', 'investments.positions.list'])
    const bank = provider(['accounts.list', 'balances.list', 'assets.valuation.get'])
    const brokerageProfile = overviewProfile(descriptor('brokerage'), brokerage)
    const bankProfile = overviewProfile(descriptor('bank', 'bank'), bank)
    const result = await loadPortfolioOverview([brokerageProfile, bankProfile])
    expect(brokerage.invoke).toHaveBeenCalledTimes(2)
    expect(bank.invoke).toHaveBeenCalledTimes(3)
    expect(brokerageProfile.use).toHaveBeenCalledOnce()
    expect(bankProfile.use).toHaveBeenCalledOnce()
    expect(result.components).toHaveLength(2)
  })

  test('keeps successful data when one operation or connection fails', async () => {
    const partial = provider(
      ['accounts.list', 'investments.orders.list'],
      'investments.orders.list',
    )
    const result = await loadPortfolioOverview([
      overviewProfile(descriptor('partial'), partial),
      {
        descriptor: descriptor('offline'),
        use: async () => {
          throw new Error('offline')
        },
      },
    ])
    expect(result.components).toHaveLength(2)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: 'partial', operation: 'investments.orders.list' }),
        expect.objectContaining({ profileId: 'offline', operation: 'provider.connect' }),
      ]),
    )
  })

  test('reports managed session failures', async () => {
    const result = await loadPortfolioOverview([
      {
        descriptor: descriptor('session-failure'),
        use: async () => {
          throw new Error('session failed')
        },
      },
    ])
    expect(result.components).toHaveLength(1)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        profileId: 'session-failure',
        operation: 'provider.connect',
        message: 'session failed',
      }),
    )
  })

  test('builds the compatible valuation from overview data without double-counting balances', () => {
    const asOf = new Date().toISOString()
    const valuation = portfolioValuationFromOverview(
      {
        asOf,
        errors: [],
        components: [
          {
            profile: descriptor('brokerage'),
            accounts: [],
            valuation: { amount: { currency: 'JPY', value: '1000' }, asOf },
          },
          {
            profile: descriptor('bank', 'bank'),
            accounts: [],
            balances: [
              {
                accountId: 'bank-account',
                type: 'current',
                amount: { kind: 'money', money: { currency: 'JPY', value: '500' } },
                asOf,
              },
              {
                accountId: 'bank-account',
                type: 'available',
                amount: { kind: 'money', money: { currency: 'JPY', value: '450' } },
                asOf,
              },
            ],
          },
        ],
      },
      'JPY',
    )
    expect(valuation.total.value).toBe('1500')
    expect(valuation.components).toHaveLength(2)
    expect(valuation.completeness).toBe('complete')
  })
})
