import { describe, expect, test, vi } from 'vite-plus/test'
import type { InvestmentOrderPlacement, InvestmentOrderRequest } from '@mnie/types'
import type { SbiClientMethods } from './methods/types'
import { createProviderFromClient } from './provider'

const request = (overrides: Partial<InvestmentOrderRequest> = {}): InvestmentOrderRequest => ({
  account: '12345678',
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
          summaryDetails: [{ category: 'DOMESTIC_DEPOSIT', valuation: 123_456 }],
        }),
      },
      power: { buyingPower: async () => ({}) },
      positions: {
        cash: async () => ({
          positions: [
            {
              issue: { code: '7203', market: 'XTKS', name: 'Toyota' },
              accountType: 'specific',
              quantity: 100,
              marketValue: { currency: 'JPY', value: 250000 },
            },
          ],
        }),
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
              unexecutedQuantity: 100,
              price: { currency: 'JPY', value: 2500, text: '2500' },
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

    expect(provider.methods()).toContain('investments.orders.preview')
    await expect(provider.invoke('investments.orders.preview', request())).resolves.toEqual({
      estimatedAmount: { currency: 'JPY', value: '250000' },
      warnings: [],
      confirmationToken: 'confirmation',
      projectedAssetChanges: [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-250000',
          reservedDelta: '250000',
          pendingDelta: '0',
        },
      ],
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
    const availability = await provider.checkMethodAvailability?.({
      method: 'investments.orders.preview',
      params: request({
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
    const availability = await provider.checkMethodAvailability?.({
      method: 'investments.orders.create',
      params: request({
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
      account: '12345678',
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
      provider.checkMethodAvailability?.({
        method: 'investments.orders.cancel',
        params: { orderId: 'order-1' },
      }),
    ).resolves.toMatchObject({ available: false, reason: 'PROVIDER_RESTRICTED' })
    await expect(
      provider.checkMethodAvailability?.({
        method: 'investments.orders.replace',
        params: { orderId: 'order-1' },
      }),
    ).resolves.toMatchObject({ available: false, reason: 'PROVIDER_RESTRICTED' })
  })

  test('preserves order, trade, and position detail through common operations', async () => {
    const provider = createProviderFromClient(client().value)
    const positions = await provider.invoke('investments.positions.list', {
      account: '12345678',
      positionType: 'cash',
    })
    const position = await provider.invoke('investments.positions.get', {
      account: '12345678',
      instrumentId: '7203',
      venue: 'XNAS',
      positionType: 'cash',
      accountType: 'specific',
    })
    const order = await provider.invoke('investments.orders.get', {
      account: '12345678',
      orderId: 'order-1',
      instrumentId: '7203',
      venue: 'XNAS',
    })
    const trades = await provider.invoke('investments.trades.list', {
      account: '12345678',
      venue: 'XNAS',
      limit: 50,
    })

    expect(position).toMatchObject({
      instrumentId: '7203',
      venue: 'XNAS',
      averagePrice: { currency: 'USD', value: '180' },
      currentPrice: { currency: 'USD', value: '190' },
      lotType: 'oddLot',
    })
    expect(positions.items[0]).toMatchObject({ quantity: '100', lotType: 'standard' })
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
      provider.checkMethodAvailability?.({ method: 'investments.orders.cancel' }),
    ).resolves.toMatchObject({
      available: false,
      reason: 'PROVIDER_RESTRICTED',
      message: 'orderId is required',
    })
  })

  test('returns static order rules when the UI asks before selecting an instrument', async () => {
    const provider = createProviderFromClient(client().value)
    await expect(
      provider.checkMethodAvailability?.({ method: 'investments.orders.preview' }),
    ).resolves.toMatchObject({
      available: true,
      orderRules: { sizing: [{ kind: 'quantity', minimum: '1', increment: '1' }] },
    })
  })

  test('declares the account isolation contract', () => {
    const provider = createProviderFromClient(client().value)
    expect(provider.accountIsolation).toEqual({
      physicalCashIncludesReservations: true,
      stableOrderReferences: true,
      attributableSettlementEffects: true,
      completeOpenOrderSnapshot: true,
    })
  })

  test('reports the reservation-inclusive deposit as the current balance', async () => {
    const provider = createProviderFromClient(client().value)
    const balances = (await provider.invoke('balances.list', {
      account: '12345678',
    })) as Array<{ type: string; amount: { money: { currency: string; value: string } } }>
    expect(balances).toContainEqual(
      expect.objectContaining({
        type: 'current',
        amount: { kind: 'money', money: { currency: 'JPY', value: '123456' } },
      }),
    )
  })

  test('returns a complete open-order snapshot with attributable effects', async () => {
    const provider = createProviderFromClient(client().value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as { items: Array<{ id: string; effects?: { referenceId: string } }>; complete?: boolean }
    expect(snapshot.complete).toBe(true)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({
      id: 'order-1',
      effects: {
        referenceId: 'order-1',
        changes: [
          {
            asset: { kind: 'cash', currency: 'JPY' },
            availableDelta: '-250000',
            reservedDelta: '250000',
            pendingDelta: '0',
          },
        ],
      },
    })
  })

  test('normalizes the provider no-data code to an empty complete snapshot', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({
      orders: [],
      error: { code: 'ME0010' },
    })
    const provider = createProviderFromClient(fake.value)
    await expect(
      provider.invoke('investments.orders.open', { account: '12345678' }),
    ).resolves.toEqual({ items: [], complete: true })
  })

  test('fails the snapshot on inquiry errors instead of assuming emptiness', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({
      orders: [],
      error: { code: 'E_0001' },
    })
    const provider = createProviderFromClient(fake.value)
    await expect(
      provider.invoke('investments.orders.open', { account: '12345678' }),
    ).rejects.toThrow('E_0001')
  })

  test('resolves domestic order state with effects without the US detail endpoint', async () => {
    const provider = createProviderFromClient(client().value)
    const order = (await provider.invoke('investments.orders.get', {
      account: '12345678',
      orderId: 'order-1',
      instrumentId: '7203',
      venue: 'XTKS',
    })) as { id: string; effects?: { referenceId: string } }
    expect(order).toMatchObject({ id: 'order-1', effects: { referenceId: 'order-1' } })
  })

  test('confirms a cancellation with the released reservation as the final effect', async () => {
    const fake = client()
    let status = 'open'
    fake.value.orders.inquiry.open = async () => ({
      orders: [
        {
          id: 'order-1',
          orderNumber: 'number-1',
          orderSubNo: 'sub-1',
          issue: { code: '7203', market: 'XTKS' as const, name: 'Toyota' },
          side: 'buy' as const,
          status: status as 'open' | 'cancelled',
          quantity: 100,
          unexecutedQuantity: status === 'open' ? 100 : 0,
          price: { currency: 'JPY', value: 2500, text: '2500' },
        },
      ],
    })
    fake.placeCancel.mockImplementation(async () => {
      status = 'cancelled'
      return { accepted: true, orderId: 'order-1' }
    })
    const provider = createProviderFromClient(fake.value)
    const result = (await provider.invoke('investments.orders.cancel', {
      account: '12345678',
      orderId: 'order-1',
      allowTransaction: true,
    })) as { id: string; status: string; confirmed?: boolean; effects?: { changes: unknown[] } }
    expect(result).toMatchObject({ id: 'order-1', status: 'cancelled', confirmed: true })
    expect(result.effects).toEqual({ referenceId: 'order-1', changes: [] })
  })
})
