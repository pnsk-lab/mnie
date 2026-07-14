import { describe, expect, it } from 'vite-plus/test'
import { tradeAdapterFor } from './trade-adapters'
import { emptyStock } from './trading-data'

describe('tradeAdapterFor', () => {
  it('keeps the SBI/default trade surface quantity based', () => {
    expect(tradeAdapterFor('quantity')).toEqual({ orderInputMode: 'quantity' })
  })

  it('maps a provider-neutral amount order without changing the shared ticket contract', () => {
    const adapter = tradeAdapterFor('amount')
    expect(adapter.orderInputMode).toBe('amount')
    expect(
      adapter.buildPreviewRequest?.({
        profileId: 'profile-1',
        side: 'buy',
        stock: { ...emptyStock, code: 'US0378331005', market: 'usa' },
        accountType: 'growthInvestment',
        amount: '1000',
        sellAll: false,
      }),
    ).toEqual({
      accountId: 'profile-1',
      instrumentId: 'US0378331005',
      side: 'buy',
      accountType: 'growthInvestment',
      positionId: undefined,
      sellAll: false,
      amount: { currency: 'JPY', value: '1000' },
    })
  })
})
