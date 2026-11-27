import { describe, expect, test, vi } from 'vite-plus/test'
import type { InvestmentOrderPlacement, InvestmentOrderRequest } from '@mnie/types'
import type { SbiClientMethods } from './methods/types'
import type { Order } from './types'
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
  const issueTicks = vi.fn(async () => ({
    issue: { code: '7203', market: 'XTKS' as const },
    nextCursor: 'before:00014282',
    latestCursor: 'after:00014282',
    items: [
      {
        sequenceNumber: '00014282',
        time: '15:30',
        price: { currency: 'JPY' as const, value: 3406, text: '3406' },
        volume: 5195800,
      },
    ],
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
        ticks: issueTicks,
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
  return { value, cashPreOrder, cashEstimate, cashPlace, placeCancel, issueTicks }
}

describe('SBI provider-neutral order adapter', () => {
  test('advertises and maps a limit order preview', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)

    expect(provider.methods()).toContain('investments.orders.preview')
    await expect(provider.invoke('investments.orders.preview', request())).resolves.toEqual({
      estimatedAmount: { currency: 'JPY', value: '250000' },
      heldAmount: { currency: 'JPY', value: '250000' },
      quantity: '100',
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

  test('propagates partial venue completeness and failedScopes when one market fails', async () => {
    const fake = client()
    const baseOpen = fake.value.orders.inquiry.open
    fake.value.orders.inquiry.open = async (options) => {
      const base = await baseOpen(options)
      return {
        ...base,
        completeVenues: ['XTKS', 'XNGO', 'XFKA', 'XSAP'],
        failedScopes: [{ scope: 'us', venues: ['XNAS', 'XNYS', 'ARCX'], reason: 'timeout' }],
      }
    }
    const provider = createProviderFromClient(fake.value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as {
      items: Array<{ id: string }>
      complete?: boolean
      completeVenues?: string[]
      failedScopes?: Array<{ scope: string; venues?: string[]; reason?: string }>
    }
    expect(snapshot.complete).toBe(false)
    expect(snapshot.items.map((item) => item.id)).toEqual(['order-1'])
    expect(snapshot.completeVenues).toEqual(['XTKS', 'XNGO', 'XFKA', 'XSAP'])
    expect(snapshot.failedScopes).toEqual([
      { scope: 'us', venues: ['XNAS', 'XNYS', 'ARCX'], reason: 'timeout' },
    ])

    // Missing order during a partial outage reports scope unavailability instead of 'open order was not found'.
    const availability = await provider.checkMethodAvailability?.({
      method: 'investments.orders.cancel',
      params: { account: '12345678', orderId: 'us-order-missing' },
    })
    expect(availability).toMatchObject({
      available: false,
      message: 'open order snapshot unavailable for us',
    })
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

describe('US stock settlement currency handling', () => {
  const usRequest = (overrides: Partial<InvestmentOrderRequest> = {}) =>
    request({
      instrumentId: 'F',
      instrumentVenue: 'XNYS',
      quantity: '1',
      execution: {
        priceType: 'limit',
        limitPrice: { currency: 'USD', value: '5.58' },
        timing: 'realtime',
        venue: 'XNYS',
        timeInForce: 'day',
      },
      ...overrides,
    })

  const usEstimate = (overrides: Record<string, unknown> = {}) => ({
    issue: { code: 'F', market: 'XNYS', name: 'Ford' },
    side: 'buy' as const,
    quantity: 1,
    estimatedAmount: { currency: 'JPY', value: 938 },
    heldAmount: { currency: 'JPY', value: 938 },
    tradeAmount: { currency: 'USD', value: 5.6 },
    settlementCurrency: 'JPY' as const,
    warnings: [],
    confirmationId: 'confirmation',
    ...overrides,
  })

  test('reserves the JPY settlement amount for a yen-settlement preview', async () => {
    const fake = client()
    fake.cashEstimate.mockResolvedValue(usEstimate())
    const provider = createProviderFromClient(fake.value)
    const preview = (await provider.invoke(
      'investments.orders.preview',
      usRequest({ settlementMethod: 'yen' }),
    )) as {
      heldAmount?: { currency: string; value: string }
      settlementCurrency?: string
      projectedAssetChanges?: Array<{
        asset: { kind: string; currency?: string }
        availableDelta: string
        reservedDelta: string
      }>
    }

    expect(preview.settlementCurrency).toBe('JPY')
    expect(preview.heldAmount).toEqual({ currency: 'JPY', value: '938' })
    expect(preview.projectedAssetChanges).toEqual([
      {
        asset: { kind: 'cash', currency: 'JPY' },
        availableDelta: '-938',
        reservedDelta: '938',
        pendingDelta: '0',
      },
    ])
    expect(fake.cashEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ foreignStockSettlementMethod: 'yen' }),
    )
  })

  test('reserves the USD settlement amount for a foreign-settlement preview', async () => {
    const fake = client()
    fake.cashEstimate.mockResolvedValue(
      usEstimate({
        estimatedAmount: { currency: 'USD', value: 5.6 },
        heldAmount: { currency: 'USD', value: 5.6 },
        tradeAmount: { currency: 'USD', value: 5.6 },
        settlementCurrency: 'USD',
      }),
    )
    const provider = createProviderFromClient(fake.value)
    const preview = (await provider.invoke(
      'investments.orders.preview',
      usRequest({ settlementMethod: 'foreign' }),
    )) as { projectedAssetChanges?: Array<{ asset: { currency?: string } }> }

    expect(preview.projectedAssetChanges?.[0]?.asset).toEqual({
      kind: 'cash',
      currency: 'USD',
    })
    expect(fake.cashEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ foreignStockSettlementMethod: 'foreign' }),
    )
  })

  test('rejects a buy preview without a broker settlement amount', async () => {
    const fake = client()
    fake.cashEstimate.mockResolvedValue(
      usEstimate({
        estimatedAmount: { currency: 'JPY', value: null },
        heldAmount: undefined,
      }),
    )
    const provider = createProviderFromClient(fake.value)
    await expect(
      provider.invoke('investments.orders.preview', usRequest({ settlementMethod: 'yen' })),
    ).rejects.toThrow('provider did not return the settlement order amount')
  })

  test('rejects settlementMethod outside US markets', async () => {
    const provider = createProviderFromClient(client().value)
    await expect(
      provider.invoke('investments.orders.preview', request({ settlementMethod: 'yen' })),
    ).rejects.toThrow('settlementMethod is supported only for US stock orders')
  })

  const usOpenOrder = (overrides: Record<string, unknown> = {}): Order =>
    ({
      id: 'sub-1',
      orderNumber: 'number-1',
      orderSubNo: 'sub-1',
      issue: { code: 'F', market: 'XNYS' as const, name: 'Ford' },
      side: 'buy' as const,
      status: 'open' as const,
      quantity: 1,
      unexecutedQuantity: 1,
      price: { currency: 'USD' as const, value: 5.58, text: '5.58' },
      settlementCurrency: 'JPY' as const,
      heldAmount: { currency: 'JPY' as const, value: 938, text: '938' },
      ...overrides,
    }) as Order

  test('attributes the JPY hold of an open yen-settlement order', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({ orders: [usOpenOrder()] })
    const provider = createProviderFromClient(fake.value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as { items: Array<{ effects?: { changes: unknown[] } }> }

    expect(snapshot.items[0]?.effects).toEqual({
      referenceId: 'sub-1',
      changes: [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-938',
          reservedDelta: '938',
          pendingDelta: '0',
        },
      ],
    })
  })

  test('attributes the USD hold of an open foreign-settlement order', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({
      orders: [
        usOpenOrder({
          settlementCurrency: 'USD',
          heldAmount: { currency: 'USD', value: 5.6, text: '5.6' },
        }),
      ],
    })
    const provider = createProviderFromClient(fake.value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as { items: Array<{ effects?: { changes: Array<{ asset: { currency?: string } }> } }> }

    expect(snapshot.items[0]?.effects?.changes[0]?.asset).toEqual({
      kind: 'cash',
      currency: 'USD',
    })
  })

  test('leaves an open partial fill unaccountable instead of guessing', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({
      orders: [
        usOpenOrder({
          executedQuantity: 1,
          unexecutedQuantity: 1,
          settledAmount: { currency: 'JPY', value: 450, text: '450' },
        }),
      ],
    })
    const provider = createProviderFromClient(fake.value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as { items: Array<{ effects?: unknown }> }

    expect(snapshot.items[0]?.effects).toBeUndefined()
  })

  test('settles an executed yen-settlement buy from the broker amount', async () => {
    const fake = client()
    fake.value.orders.inquiry.open = async () => ({
      orders: [
        usOpenOrder({
          status: 'executed',
          executedQuantity: 1,
          unexecutedQuantity: 0,
          settledAmount: { currency: 'JPY', value: 895, text: '895' },
        }),
      ],
    })
    const provider = createProviderFromClient(fake.value)
    const snapshot = (await provider.invoke('investments.orders.open', {
      account: '12345678',
    })) as { items: Array<{ effects?: { changes: unknown[] } }> }

    expect(snapshot.items[0]?.effects).toEqual({
      referenceId: 'sub-1',
      changes: [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-895',
          reservedDelta: '0',
          pendingDelta: '0',
        },
        {
          asset: {
            kind: 'security',
            instrumentId: 'F',
            venue: 'XNYS',
            positionType: 'cash',
          },
          availableDelta: '1',
          reservedDelta: '0',
          pendingDelta: '0',
        },
      ],
    })
  })

  test('advertises and invokes market.issue.ticks', async () => {
    const fake = client()
    const provider = createProviderFromClient(fake.value)

    expect(provider.methods()).toContain('market.issue.ticks')
    await expect(
      provider.checkMethodAvailability?.({
        method: 'market.issue.ticks',
        params: { issueCode: '7203', market: 'XTKS' },
      }),
    ).resolves.toEqual({ available: true })

    await expect(
      provider.invoke('market.issue.ticks', {
        issueCode: '7203',
        market: 'XTKS',
        afterCursor: 'after:00014280',
        limit: 50,
      }),
    ).resolves.toMatchObject({
      issue: { code: '7203', market: 'XTKS' },
      nextCursor: 'before:00014282',
      latestCursor: 'after:00014282',
    })
    expect(fake.issueTicks).toHaveBeenCalledWith({
      issueCode: '7203',
      market: 'XTKS',
      afterCursor: 'after:00014280',
      limit: 50,
    })
  })

  test('caches and forwards US market buy noLimitPrice from preview to create without leaking confirmationId', async () => {
    const fake = client()
    fake.cashEstimate.mockResolvedValueOnce(
      usEstimate({
        price: { currency: 'USD', value: 12.34 },
        estimatedAmount: { currency: 'JPY', value: 2275 },
        heldAmount: { currency: 'JPY', value: 2275 },
        tradeAmount: { currency: 'USD', value: 14.19 },
        noLimitPrice: '14.19',
        confirmationId: 'local-us-token',
      }),
    )
    const provider = createProviderFromClient(fake.value)
    const usMarketRequest = usRequest({
      settlementMethod: 'yen',
      execution: {
        priceType: 'market',
        timing: 'realtime',
        venue: 'XNYS',
        timeInForce: 'day',
      },
    })

    const preview = (await provider.invoke(
      'investments.orders.preview',
      usMarketRequest,
    )) as unknown as Record<string, unknown>
    expect(preview).toMatchObject({
      price: { currency: 'USD', value: '12.34' },
      heldAmount: { currency: 'JPY', value: '2275' },
      confirmationToken: 'local-us-token',
      projectedAssetChanges: [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-2275',
          reservedDelta: '2275',
          pendingDelta: '0',
        },
      ],
    })
    expect('noLimitPrice' in preview).toBe(false)

    const placement: InvestmentOrderPlacement = {
      ...usMarketRequest,
      confirmationToken: 'local-us-token',
      allowTransaction: true,
    }
    await provider.invoke('investments.orders.create', placement)
    expect(fake.cashPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        issueCode: 'F',
        market: 'XNYS',
        kind: 'market',
        confirmationId: undefined,
        noLimitPrice: '14.19',
        allowTrading: true,
      }),
    )
  })
})
