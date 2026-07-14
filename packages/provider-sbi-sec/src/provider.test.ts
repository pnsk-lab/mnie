import { describe, expect, test, vi } from 'vite-plus/test'
import type { InvestmentOrderPlacement, InvestmentOrderRequest } from '@mnie/types'
import type { SbiClientMethods } from './methods/types'
import { createProviderFromClient } from './provider'

const request = (overrides: Partial<InvestmentOrderRequest> = {}): InvestmentOrderRequest => ({
  accountId: '12345678',
  instrumentId: '7203',
  instrumentVenue: 'XTKS',
  side: 'buy',
  quantity: '100',
  positionType: 'cash',
  accountType: 'specific',
  execution: {
    priceType: 'limit',
    limitPrice: { currency: 'JPY', value: '2500' },
    timing: 'realtime',
    venue: 'XTKS',
    timeInForce: 'day',
  },
  strategy: { kind: 'single' },
  ...overrides,
})

const client = (orderFlags: { cancelable?: boolean; correctable?: boolean } = {}) => {
  const cashPreOrder = vi.fn(async () => ({
    issue: { code: '7203', market: 'XTKS', name: 'Toyota' },
    market: 'XTKS',
    lotSize: 100,
    orderTerms: ['day', 'week', 'date'],
    orderTermDates: ['2026-07-14'],
    priceSteps: [],
    paymentLimits: [],
    sKabu: { available: true },
  }))
  const cashEstimate = vi.fn(async () => ({
    issue: { code: '7203', market: 'XTKS', name: 'Toyota' },
    side: 'buy' as const,
    quantity: 100,
    estimatedAmount: { currency: 'JPY', value: 250000 },
    warnings: [],
    confirmationId: 'confirmation',
  }))
  const cashPlace = vi.fn(async () => ({
    accepted: true,
    orderId: 'order-1',
    acceptedAt: '2026-07-13T12:00:00.000Z',
  }))
  const placeCancel = vi.fn(async () => ({ accepted: true, orderId: 'order-1' }))
  const value = {
    session: {
      profile: async () => ({ accountNumber: '12345678' }),
      export: () => ({ session: true }),
    },
    account: {
      assets: {
        current: async () => ({
          summary: { valuation: 1_000_000 },
          summaryWithoutDeposit: { valuation: 900_000 },
        }),
      },
      power: { buyingPower: async () => ({}) },
      positions: {
        cash: async () => ({ positions: [] }),
        margin: async () => ({ positions: [] }),
        cashDetail: async () => ({
          positions: [
            {
              issue: { code: '7203', market: 'XNAS', name: 'Toyota' },
              accountType: 'specific',
              quantity: 5,
              availableQuantity: 5,
              averagePrice: { currency: 'USD', value: 180 },
              currentPrice: { currency: 'USD', value: 190 },
              marketValue: { currency: 'USD', value: 950 },
              profitLoss: { value: 50 },
              profitLossRate: { value: 5.55 },
            },
          ],
        }),
        marginDetail: async () => ({ positions: [] }),
      },
    },
    market: {
      index: { major: async () => [] },
      issue: {
        chart: async () => ({}),
        search: async () => ({}),
        suggest: async () => ({}),
        board: async () => ({}),
      },
    },
    orders: {
      inquiry: {
        executionsToday: async () => ({ orders: [] }),
        detail: async () => ({
          id: 'order-1',
          issue: { code: '7203', market: 'XNAS', name: 'Toyota' },
          side: 'buy',
          status: 'open',
          quantity: 5,
          price: { currency: 'USD', value: 190 },
          cancelable: true,
          correctable: true,
        }),
        tradeRecords: async () => ({
          records: [
            {
              id: 'trade-1',
              issue: { code: '7203', market: 'XNAS', name: 'Toyota' },
              quantity: 5,
              price: { currency: 'USD', value: 190 },
              amount: { currency: 'USD', value: 950 },
              tradeDate: '2026-07-13',
              valueDate: '2026-07-15',
              settlementCurrencyCode: 'USD',
            },
          ],
        }),
        open: async () => ({
          orders: [
            {
              id: 'order-1',
              orderNumber: 'number-1',
              orderSubNo: 'sub-1',
              issue: { code: '7203', market: 'XTKS', name: 'Toyota' },
              side: 'buy',
              status: 'open',
              quantity: 100,
              ...orderFlags,
            },
          ],
        }),
      },
      cash: {
        preOrder: cashPreOrder,
        estimate: cashEstimate,
        place: cashPlace,
        placeCancel,
        estimateCorrection: async () => ({ warnings: [] }),
        placeCorrection: async () => ({ accepted: true }),
      },
      ifd: {
        estimate: cashEstimate,
        place: cashPlace,
      },
    },
    banking: { detailHistory: async () => [] },
  } as unknown as SbiClientMethods
  return { value, cashPreOrder, cashEstimate, cashPlace, placeCancel }
}

describe('SBI provider-neutral order adapter', () => {
  test('advertises and maps a limit order preview', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)

    expect(provider.operations()).toContain('investments.orders.preview')
    await expect(provider.invoke('investments.orders.preview', request())).resolves.toEqual({
      estimatedAmount: { currency: 'JPY', value: '250000' },
      warnings: [],
      confirmationToken: 'confirmation',
    })
    expect(fake.cashEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        issueCode: '7203',
        market: 'XTKS',
        accountType: 'specific',
        quantity: 100,
        priceCondition: 'limit',
        price: 2500,
      }),
    )
  })

  test('combines S-kabu instrument availability with odd-lot rules', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)
    const availability = await provider.checkOperationAvailability?.({
      operation: 'investments.orders.preview',
      input: request({
        quantity: '1',
        execution: { priceType: 'market', timing: 'realtime', venue: 'STK' },
      }),
    })

    expect(availability).toMatchObject({
      available: true,
      orderRules: {
        sizing: [{ kind: 'quantity', minimum: '1', increment: '1', boardLot: '100' }],
        priceTypes: ['market'],
        timings: ['realtime'],
      },
    })
    expect(fake.cashPreOrder).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 's', market: 'STK', preOrderMarket: 'XTKS' }),
    )
  })

  test('rejects unsupported S-kabu pricing instead of silently changing the order', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)
    const availability = await provider.checkOperationAvailability?.({
      operation: 'investments.orders.create',
      input: request({
        quantity: '1',
        execution: {
          priceType: 'limit',
          limitPrice: { currency: 'JPY', value: '2500' },
          venue: 'STK',
        },
      }),
    })

    expect(availability).toMatchObject({
      available: false,
      reason: 'PROVIDER_RESTRICTED',
    })
    await expect(
      provider.invoke(
        'investments.orders.create',
        request({
          quantity: '1',
          execution: {
            priceType: 'limit',
            limitPrice: { currency: 'JPY', value: '2500' },
            venue: 'STK',
          },
          allowTransaction: true,
        }) as InvestmentOrderPlacement,
      ),
    ).rejects.toThrow('S-kabu supports market orders only')
    expect(fake.cashPlace).not.toHaveBeenCalled()
  })

  test('resolves the provider order reference before cancellation', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)
    await provider.invoke('investments.orders.cancel', {
      accountId: '12345678',
      orderId: 'order-1',
      allowTransaction: true,
    })

    expect(fake.placeCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'number-1',
        orderId: 'sub-1',
        allowTrading: true,
      }),
    )
  })

  test('reports order-specific correction and cancellation availability', async () => {
    const provider = createProviderFromClient(
      client({ cancelable: false, correctable: false }).value,
    )
    await expect(
      provider.checkOperationAvailability?.({
        operation: 'investments.orders.cancel',
        input: { orderId: 'order-1' },
      }),
    ).resolves.toMatchObject({ available: false, reason: 'PROVIDER_RESTRICTED' })
    await expect(
      provider.checkOperationAvailability?.({
        operation: 'investments.orders.replace',
        input: { orderId: 'order-1' },
      }),
    ).resolves.toMatchObject({ available: false, reason: 'PROVIDER_RESTRICTED' })
  })

  test('preserves order, trade, and position detail through common operations', async () => {
    const provider = createProviderFromClient(client().value)
    const position = await provider.invoke('investments.positions.get', {
      accountId: '12345678',
      instrumentId: '7203',
      venue: 'XNAS',
      positionType: 'cash',
      accountType: 'specific',
    })
    const order = await provider.invoke('investments.orders.get', {
      accountId: '12345678',
      orderId: 'order-1',
      instrumentId: '7203',
      venue: 'XNAS',
    })
    const trades = await provider.invoke('investments.trades.list', {
      accountId: '12345678',
      venue: 'XNAS',
      limit: 50,
    })

    expect(position).toMatchObject({
      instrumentId: '7203',
      venue: 'XNAS',
      averagePrice: { currency: 'USD', value: '180' },
      currentPrice: { currency: 'USD', value: '190' },
    })
    expect(order).toMatchObject({
      id: 'order-1',
      venue: 'XNAS',
      cancelable: true,
      correctable: true,
    })
    expect(trades.items[0]).toMatchObject({
      id: 'trade-1',
      amount: { currency: 'USD', value: '950' },
      valueDate: '2026-07-15',
      settlementCurrency: 'USD',
    })
  })

  test('reports request-specific operations unavailable when no request is supplied', async () => {
    const provider = createProviderFromClient(client().value)
    await expect(
      provider.checkOperationAvailability?.({ operation: 'investments.orders.cancel' }),
    ).resolves.toMatchObject({
      available: false,
      reason: 'PROVIDER_RESTRICTED',
      message: 'orderId is required',
    })
  })

  test('returns static order rules when the UI asks before selecting an instrument', async () => {
    const provider = createProviderFromClient(client().value)
    await expect(
      provider.checkOperationAvailability?.({ operation: 'investments.orders.preview' }),
    ).resolves.toMatchObject({
      available: true,
      orderRules: { sizing: [{ kind: 'quantity', minimum: '1', increment: '1' }] },
    })
  })
})
