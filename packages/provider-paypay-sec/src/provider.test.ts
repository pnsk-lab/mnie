import { describe, expect, test, vi } from 'vite-plus/test'
import { createProvider } from './provider'
import type { PayPaySecClient } from './types'

const fakeClient = () =>
  ({
    accountId: 'account-1',
    baseURL: 'https://example.test',
    session: {
      export: () => ({ accountId: 'account-1', baseURL: 'https://example.test', cookies: {} }),
    },
    market: {
      instruments: {
        list: vi.fn(async ({ market }: { market: string }) => [
          { brandId: '101', name: `Example ${market}`, market, code: 'EXM' },
        ]),
        detail: vi.fn(async () => ({
          brandId: '101',
          name: 'Example Holdings',
          code: 'EXM',
          price: '2000',
        })),
      },
    },
    account: {
      valuation: vi.fn(async () => ({
        countryId: 2 as const,
        withdrawableCash: '50.0000000000',
        securitiesValueTotal: '1250.0000000000',
        buyableCash: '100.0000000000',
        assetsTotal: '1350.0000000000',
        profitLossTotalVisible: true,
        profitLossVisible: true,
        brands: [],
      })),
    },
    portfolio: {
      positions: vi.fn(async ({ country }: { country: 'japan' | 'usa' }) =>
        country === 'japan'
          ? [
              {
                id: 'japan:101:0',
                brandId: '101',
                name: 'Example Holdings',
                country,
                quantity: '1.2500000000',
                securitiesValue: '1250.0000000000',
                grossProfit: '50.0000000000',
                accountType: 2 as const,
                subClientSeqNo: '42',
              },
            ]
          : [],
      ),
    },
    history: {
      trades: vi.fn(async () => [
        {
          id: 'order-1',
          kind: 'trade' as const,
          cells: { 状態: '約定' },
          occurredAt: '2026/07/13 12:34',
          brandId: '101',
          instrumentName: 'Example Holdings',
          side: 'buy' as const,
          amount: '1000.0000000000',
          quantity: '0.5000000000',
          status: '約定',
        },
        {
          id: 'order-open',
          kind: 'trade' as const,
          cells: { 状態: '注文中' },
          occurredAt: '2026/07/14 09:00',
          brandId: '303',
          instrumentName: 'Pending Holdings',
          side: 'buy' as const,
          amount: '2000.0000000000',
          quantity: '1.0000000000',
          status: '注文中',
        },
      ]),
      settlements: vi.fn(async () => [
        {
          id: 'order-1',
          kind: 'settlement' as const,
          cells: { 摘要: '1' },
          occurredAt: '2026-07-13',
          brandId: '101',
          instrumentName: 'Example Holdings',
          side: 'buy' as const,
          amount: '1000.0000000000',
          quantity: '0.5000000000',
          price: '2000.0000000000',
          accountType: 2 as const,
          summaryType: '1',
          status: '約定',
        },
        {
          id: 'order-2',
          kind: 'settlement' as const,
          cells: { 摘要: '2' },
          occurredAt: '2026-07-12',
          brandId: '202',
          instrumentName: 'Example ETF',
          side: 'sell' as const,
          amount: '500.0000000000',
          quantity: '0.2500000000',
          price: '2000.0000000000',
          summaryType: '2',
          status: '約定',
        },
        {
          id: 'fee-1',
          kind: 'settlement' as const,
          cells: { 摘要: '54' },
          occurredAt: '2026-07-12',
          amount: '110',
          summaryType: '54',
        },
      ]),
    },
    orders: {
      confirmation: vi.fn((confirmationId: string) =>
        confirmationId === 'confirmation-1'
          ? {
              confirmationId,
              side: 'buy' as const,
              brandId: '101',
              instrumentName: 'Example Holdings',
              accountType: 2 as const,
              amount: '1000',
              quantity: '0.5',
              price: '2000',
              exchangeRate: '1',
              expiresAt: '2099-01-01T00:00:00.000Z',
              warnings: [],
            }
          : undefined,
      ),
      buy: {
        availability: vi.fn(async () => ({ buyDisabled: false, sellDisabled: false })),
        preview: vi.fn(async () => ({
          confirmationId: 'confirmation-1',
          side: 'buy' as const,
          brandId: '101',
          instrumentName: 'Example Holdings',
          accountType: 2 as const,
          amount: '1000',
          quantity: '0.5',
          price: '2000',
          exchangeRate: '1',
          expiresAt: '2026-07-13T12:35:00.000Z',
          warnings: [],
        })),
        submit: vi.fn(async () => ({
          side: 'buy' as const,
          brandId: '101',
          instrumentCode: 'EXM',
          instrumentName: 'Example Holdings',
          amount: '1000',
          message: 'completed',
        })),
      },
      sell: {
        availability: vi.fn(async () => ({ buyDisabled: false, sellDisabled: false })),
        preview: vi.fn(),
        submit: vi.fn(),
      },
    },
    close: vi.fn(),
  }) as unknown as PayPaySecClient

describe('PayPay Securities provider', () => {
  test('maps accounts, balances, valuation, and positions without losing decimals', async () => {
    const provider = createProvider(fakeClient())
    expect(await provider.invoke('accounts.list', {})).toEqual({
      items: [
        {
          id: 'account-1',
          providerId: 'paypay-sec',
          kind: 'brokerage',
          name: 'PayPay Securities brokerage account',
        },
      ],
    })
    const balances = await provider.invoke('balances.list', {})
    expect(balances[0]?.amount).toEqual({
      kind: 'money',
      money: { currency: 'JPY', value: '100.0000000000' },
    })
    const valuation = await provider.invoke('assets.valuation.get', {})
    expect(valuation.amount.value).toBe('1350.0000000000')
    const positions = await provider.invoke('investments.positions.list', {})
    expect(positions.items[0]).toMatchObject({
      instrumentId: '101',
      quantity: '1.2500000000',
      marketValue: { currency: 'JPY', value: '1250.0000000000' },
      averagePrice: { currency: 'JPY', value: '960' },
      currentPrice: { currency: 'JPY', value: '1000' },
      market: 'japan',
      accountType: 'specific',
      lotType: 'notApplicable',
    })
    expect(await provider.invoke('balances.list', { accountId: 'other' })).toEqual([])
  })

  test('searches instruments and submits a preview using the runtime trade password', async () => {
    const client = fakeClient()
    const provider = createProvider(client, { tradePassword: 'trade-secret' })
    const instruments = await provider.invoke('investments.instruments.search', { query: 'EXM' })
    expect(instruments.items).toHaveLength(4)
    const detail = await provider.invoke('investments.instruments.get', { instrumentId: '101' })
    expect(detail.market).toBe('japan')
    expect(detail.price).toEqual({ currency: 'JPY', value: '2000' })

    const preview = await provider.invoke('investments.orders.preview', {
      accountId: 'account-1',
      instrumentId: '101',
      side: 'buy',
      accountType: '2',
      amount: { currency: 'JPY', value: '1000' },
    })
    expect(preview).toMatchObject({
      confirmationToken: 'confirmation-1',
      estimatedAmount: { currency: 'JPY', value: '1000' },
      quantity: '0.5',
    })
    const receipt = await provider.invoke('investments.orders.create', {
      confirmationToken: 'confirmation-1',
      allowTransaction: true,
    })
    expect(receipt).toMatchObject({ side: 'buy', amount: { currency: 'JPY', value: '1000' } })
    expect(client.orders.buy.submit).toHaveBeenCalledWith({
      confirmationId: 'confirmation-1',
      tradePassword: 'trade-secret',
      allowTransaction: true,
    })
  })

  test('publishes provider-neutral amount rules and a trusted confirmation amount', async () => {
    const provider = createProvider(fakeClient(), { tradePassword: 'trade-secret' })

    await expect(
      provider.checkOperationAvailability?.({ operation: 'investments.orders.preview' }),
    ).resolves.toMatchObject({
      available: true,
      orderRules: {
        sizing: [
          { kind: 'amount', side: 'buy', currency: 'JPY', minimum: '1000', increment: '1' },
          { kind: 'amount', side: 'sell', currency: 'JPY', minimum: '100', increment: '1' },
        ],
        accountTypes: ['general', 'specific', 'growthInvestment', 'nisa'],
      },
    })
    await expect(
      provider.checkOperationAvailability?.({
        operation: 'investments.orders.create',
        input: { confirmationToken: 'confirmation-1', allowTransaction: true },
      }),
    ).resolves.toMatchObject({
      available: true,
      transactionAmount: { currency: 'JPY', value: '1000' },
    })
  })

  test('enforces side-specific amount minimums while allowing sell-all', async () => {
    const client = fakeClient()
    const provider = createProvider(client)
    const availability = (side: 'buy' | 'sell', value: string) =>
      provider.checkOperationAvailability?.({
        operation: 'investments.orders.preview',
        input: {
          accountId: 'account-1',
          instrumentId: '101',
          side,
          accountType: 'specific',
          positionId: side === 'sell' ? 'japan:101:0' : undefined,
          amount: { currency: 'JPY', value },
        },
      })

    await expect(availability('buy', '999')).resolves.toMatchObject({ available: false })
    await expect(availability('buy', '1000')).resolves.toMatchObject({ available: true })
    await expect(availability('sell', '99')).resolves.toMatchObject({ available: false })
    await expect(availability('sell', '100')).resolves.toMatchObject({ available: true })
    await expect(
      provider.checkOperationAvailability?.({
        operation: 'investments.orders.preview',
        input: {
          accountId: 'account-1',
          instrumentId: '101',
          side: 'sell',
          accountType: 'specific',
          positionId: 'japan:101:0',
          sellAll: true,
        },
      }),
    ).resolves.toMatchObject({ available: true })

    await expect(
      provider.invoke('investments.orders.preview', {
        accountId: 'account-1',
        instrumentId: '101',
        side: 'buy',
        accountType: 'specific',
        amount: { currency: 'JPY', value: '999' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(client.orders.buy.preview).not.toHaveBeenCalled()
  })

  test('resolves the market when instrument detail is requested directly', async () => {
    const client = fakeClient()
    const provider = createProvider(client)

    const detail = await provider.invoke('investments.instruments.get', { instrumentId: '101' })

    expect(detail).toMatchObject({ id: '101', name: 'Example Holdings', market: 'japan' })
    expect(client.market.instruments.list).toHaveBeenCalledTimes(4)
  })

  test('reuses the market learned from positions when loading initial quote details', async () => {
    const client = fakeClient()
    const provider = createProvider(client)

    await provider.invoke('investments.positions.list', {})
    const detail = await provider.invoke('investments.instruments.get', { instrumentId: '101' })

    expect(detail).toMatchObject({
      id: '101',
      code: 'EXM',
      market: 'japan',
      price: { currency: 'JPY', value: '2000' },
    })
    expect(client.market.instruments.list).not.toHaveBeenCalled()
    expect(client.market.instruments.detail).toHaveBeenCalledWith({ brandId: '101' })
  })

  test('maps observed trade rows and rejects unsupported date ranges', async () => {
    const provider = createProvider(fakeClient())
    const orders = await provider.invoke('investments.orders.list', {})
    expect(orders.items).toHaveLength(3)
    expect(orders.items[0]).toMatchObject({ id: 'order-open', status: 'open' })
    expect(orders.items[1]).toMatchObject({
      accountType: '2',
      amount: { currency: 'JPY', value: '1000.0000000000' },
      executedQuantity: '0.5000000000',
      id: 'order-1',
      price: { currency: 'JPY', value: '2000.0000000000' },
      status: 'executed',
      side: 'buy',
    })
    const transactions = await provider.invoke('transactions.list', {})
    expect(transactions.items).toHaveLength(2)
    expect(transactions.items[0]).toMatchObject({
      id: 'order-1',
      direction: 'debit',
      occurredAt: '2026-07-13T00:00:00+09:00',
    })
    await expect(
      provider.invoke('transactions.list', { from: '2026-01-01' }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })
})
