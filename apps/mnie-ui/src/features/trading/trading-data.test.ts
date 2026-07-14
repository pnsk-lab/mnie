import { describe, expect, test } from 'vite-plus/test'
import {
  mergeInvestmentInstrument,
  groupBrokerageAssets,
  homeAssetHistoryFrom,
  orderAmountText,
  orderFromApi,
  orderSizingForSide,
  positionFromApi,
  positionsForStock,
  stockFromInvestmentInstrument,
  uniqueStocksByIdentity,
} from './trading-data'

describe('provider-neutral order amounts', () => {
  test('selects side-specific sizing rules before shared rules', () => {
    const sizing = [
      { kind: 'amount', minimum: '500', increment: '1' },
      { kind: 'amount', side: 'buy', minimum: '1000', increment: '1' },
      { kind: 'amount', side: 'sell', minimum: '100', increment: '1' },
    ]
    expect(orderSizingForSide(sizing, 'amount', 'buy')).toMatchObject({ minimum: '1000' })
    expect(orderSizingForSide(sizing, 'amount', 'sell')).toMatchObject({ minimum: '100' })
    expect(orderSizingForSide(sizing, 'quantity', 'buy')).toEqual({})
  })

  test('uses the JPY settlement amount instead of treating a USD unit price as yen', () => {
    const order = orderFromApi({
      id: 'order-1',
      accountId: 'paypay-sec',
      instrumentId: '72',
      instrumentName: 'Direxion Daily S&P 500 Bull 3X ETF',
      side: 'buy',
      status: 'executed',
      quantity: '0.0221678423',
      price: { currency: 'JPY', value: '277.88' },
      amount: { currency: 'JPY', value: '1000' },
      orderedAt: '2026-07-13T00:00:00+09:00',
    })
    expect(order).not.toBeNull()
    expect(orderAmountText(order!)).toBe('￥1,000')
  })

  test('falls back to unit price times quantity when no settlement amount is available', () => {
    expect(
      orderAmountText({
        id: 'order-2',
        code: '101',
        date: '2026-07-13',
        stock: 'Example Holdings',
        market: 'japan',
        side: 'buy',
        kind: 'standard',
        quantity: 2,
        price: 500,
        status: '約定済',
      }),
    ).toBe('￥1,000')
  })
})

describe('home asset history range', () => {
  test('starts the chart window 30 days before the current time', () => {
    expect(homeAssetHistoryFrom(Date.parse('2026-07-14T12:00:00.000Z'))).toBe(
      '2026-06-14T12:00:00.000Z',
    )
  })
})

const searchResult = stockFromInvestmentInstrument({
  id: '101',
  name: 'Example Holdings',
  market: 'japan',
})!

describe('investment instrument normalization', () => {
  test('keeps provider identity separate from the displayed instrument code', () => {
    expect(
      stockFromInvestmentInstrument({
        id: '756',
        code: '285A',
        name: 'キオクシアホールディングス',
        market: 'japan',
      }),
    ).toMatchObject({ code: '756', symbol: '285A', routeId: 'japan:756' })
  })

  test('keeps the search result name when detail returns a corporate heading', () => {
    expect(
      mergeInvestmentInstrument(searchResult, {
        id: '101',
        name: '「証券」のつかない証券会社 PayPay証券株式会社',
        market: '',
        price: { currency: 'JPY', value: '1234' },
      }),
    ).toMatchObject({
      name: 'Example Holdings',
      market: 'japan',
      price: 1234,
    })
  })

  test('uses a valid detail name while preserving a missing market', () => {
    expect(
      mergeInvestmentInstrument(searchResult, {
        id: '101',
        name: 'Updated Holdings',
        price: { currency: 'JPY', value: '1500' },
      }),
    ).toMatchObject({ name: 'Updated Holdings', market: 'japan', price: 1500 })
  })

  test('removes a trade-detail suffix from search and detail names', () => {
    expect(
      stockFromInvestmentInstrument({
        id: '285A',
        name: 'キオクシアホールディングス取引詳細',
        market: 'japan',
      })?.name,
    ).toBe('キオクシアホールディングス')

    expect(
      stockFromInvestmentInstrument({
        id: '285A',
        name: 'キオクシアホールディングス ● 取引詳細',
        market: 'japan',
      })?.name,
    ).toBe('キオクシアホールディングス')

    const current = stockFromInvestmentInstrument({
      id: '285A',
      name: 'キオクシアホールディングス',
      market: 'japan',
    })!
    expect(
      mergeInvestmentInstrument(current, {
        id: '285A',
        name: 'キオクシアホールディングス | 取引詳細',
        market: 'japan',
      }).name,
    ).toBe('キオクシアホールディングス')
  })

  test('removes PayPay brand markers from both search and position names', () => {
    expect(
      stockFromInvestmentInstrument({
        id: '756',
        name: '●キオクシアホールディングス',
        market: 'japan',
      })?.name,
    ).toBe('キオクシアホールディングス')
  })
})

describe('provider-neutral position normalization', () => {
  test('uses PayPay average/current unit prices without losing fractional quantities', () => {
    expect(
      positionFromApi({
        instrumentId: '756',
        instrumentName: 'キオクシアホールディングス',
        market: 'japan',
        quantity: '0.1245181925',
        averagePrice: { currency: 'JPY', value: '1500' },
        currentPrice: { currency: 'JPY', value: '1600' },
        marketValue: { currency: 'JPY', value: '199.229108' },
        unrealizedProfitLoss: { currency: 'JPY', value: '12.55182' },
      }),
    ).toMatchObject({
      code: '756',
      market: 'japan',
      quantity: 0.1245181925,
      avgPrice: 1500,
      currentPrice: 1600,
    })
  })

  test('derives the average price from market value and profit when needed', () => {
    expect(
      positionFromApi({
        instrumentId: '101',
        quantity: '1.25',
        marketValue: { currency: 'JPY', value: '1250' },
        unrealizedProfitLoss: { currency: 'JPY', value: '50' },
      })?.avgPrice,
    ).toBe(960)
  })

  test('uses provider lot knowledge instead of inferring it from quantity', () => {
    const position = (lotType: string, quantity: string, accountType?: string) =>
      positionFromApi({
        instrumentId: '101',
        positionType: 'cash',
        lotType,
        accountType,
        quantity,
      })?.type

    expect(position('standard', '1')).toBe('単元')
    expect(position('oddLot', '1000')).toBe('S株')
    expect(position('notApplicable', '0.25', 'specific')).toBe('特定')
    expect(position('notApplicable', '0.25')).toBe('現物')
    expect(
      positionFromApi({
        instrumentId: '101',
        positionType: 'margin',
        lotType: 'standard',
        quantity: '100',
      })?.type,
    ).toBe('信用')
  })
})

describe('stock identity normalization', () => {
  test('renders one row when bare and market-qualified references resolve to the same stock', () => {
    const stock = stockFromInvestmentInstrument({
      id: '756',
      name: 'キオクシアホールディングス',
      market: 'japan',
      price: { value: '66769' },
    })!
    expect(uniqueStocksByIdentity([stock, stock])).toEqual([stock])
  })

  test('does not merge the same code listed on different markets', () => {
    const japan = stockFromInvestmentInstrument({ id: '756', name: 'A', market: 'japan' })!
    const usa = stockFromInvestmentInstrument({ id: '756', name: 'A', market: 'usa' })!
    expect(uniqueStocksByIdentity([japan, usa])).toHaveLength(2)
  })
})

describe('sell position selection', () => {
  test('only exposes holdings for the selected instrument', () => {
    const positions = [
      { code: '756', name: 'キオクシア', market: 'japan' },
      { code: '319', name: 'NTT', market: 'japan' },
    ] as Parameters<typeof positionsForStock>[0]
    expect(positionsForStock(positions, { code: '319', market: 'japan' })).toEqual([positions[1]])
  })
})

describe('brokerage chart grouping', () => {
  test('groups profiles by brokerage provider without combining different firms', () => {
    expect(
      groupBrokerageAssets([
        {
          providerId: 'sbisec',
          providerName: 'SBI証券',
          color: '#111111',
          holdingsValue: 100,
          cashValue: 20,
        },
        {
          providerId: 'sbisec',
          providerName: 'SBI証券',
          color: '#222222',
          holdingsValue: 50,
          cashValue: 10,
        },
        {
          providerId: 'paypay-sec',
          providerName: 'PayPay証券',
          color: '#333333',
          holdingsValue: 80,
          cashValue: 5,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: 'provider:sbisec',
        label: 'SBI証券',
        holdingsValue: 150,
        cashValue: 30,
        value: 180,
      }),
      expect.objectContaining({
        id: 'provider:paypay-sec',
        label: 'PayPay証券',
        holdingsValue: 80,
        cashValue: 5,
        value: 85,
      }),
    ])
  })
})
