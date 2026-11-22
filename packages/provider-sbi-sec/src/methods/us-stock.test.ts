import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import type { SbiSession } from '../types'
import { createUsStockAdapter } from './us-stock'
import type { CashOrderOptions } from './types'

/**
 * Fixtures mirror anonymized real SBI foreign-stock responses captured on
 * 2026-11-22. `netAmount` is the JPY settlement/hold, `frnNetAmount` the
 * foreign-currency one, and only the side matching `settlementCurrencyCode`
 * is populated.
 */
const session = {
  foreignStock: {
    endpoints: { graphqlIntUrl: 'https://example.test/graphql' },
    sessionId: 'sess',
    accountId: 'acct',
    loginAuthenticated: true,
  },
  tradePassword: 'pw',
} as unknown as SbiSession

const orderInput: CashOrderOptions = {
  issueCode: 'F',
  market: 'XNYS',
  side: 'buy',
  quantity: 1,
  accountType: 'specific',
  depositType: 'specific',
  kind: 'limit',
  price: 5.58,
  orderTerm: 'date',
  orderDate: '2026-11-24',
}

const confirmResponse = (overrides: Record<string, unknown>) => ({
  data: {
    confirmForeignStockCreatedOrder: {
      buyPossibleAmount: '171634',
      estimatePrice: '5.58',
      nisaBuyLimitAmount: '',
      sellPossibleQuantity: '',
      warningStatuses: [],
      order: {
        orderNo: '',
        orderSubNo: '',
        orderInputDatetime: '',
        orderQuantity: '1',
        orderPrice: '5.58',
        settlementMethodCode: 'YEN_SETTLEMENT',
        settlementCurrencyCode: 'JPY',
        exchangeRate: '159.59',
        tradeCurrencyCode: 'USD',
        grossAmount: '935',
        frnGrossAmount: '5.58',
        localCharge: '0',
        frnLocalCharge: '0',
        localNetAmount: '935',
        frnLocalNetAmount: '5.58',
        commissionAmount: '3',
        frnCommissionAmount: '0.02',
        commissionCtax: '0',
        frnCommissionCtax: '0',
        netAmount: '938',
        frnNetAmount: '',
        securities: { securitiesCode: 'F' },
        market: { marketCode: 'US_NYSE' },
        ...overrides,
      },
    },
  },
})

const yenConfirm = () => confirmResponse({})
const foreignConfirm = () =>
  confirmResponse({
    settlementMethodCode: 'FOREIGN_SETTLEMENT',
    settlementCurrencyCode: 'USD',
    exchangeRate: '',
    grossAmount: '',
    localCharge: '',
    localNetAmount: '',
    commissionAmount: '',
    commissionCtax: '',
    netAmount: '',
    frnNetAmount: '5.6',
  })

const openYenOrderRow = {
  orderNo: 'I00',
  orderSubNo: 'A00',
  buySellCode: 'BUY',
  orderStatus: 'ORDERING',
  orderQuantity: '1',
  unexecutedQuantity: '1',
  executionQuantity: '',
  orderPrice: '5.58',
  executionAveragePrice: '',
  orderInputDatetime: '2026-11-22T22:42:52.929+09:00',
  orderTerm: '2026-11-24',
  specificAccountCode: 'SPECIFIC',
  orderPriceKindCode: 'LIMIT',
  orderLimitCode: 'CARRY_OVER_ORDER',
  settlementMethodCode: 'YEN_SETTLEMENT',
  executionStatus: 'NON_EXECUTION',
  securities: { securitiesCode: 'F' },
  market: { marketCode: 'US_NYSE' },
}

const openOrderDetailRow = {
  ...openYenOrderRow,
  settlementCurrencyCode: 'JPY',
  tradeCurrencyCode: 'USD',
  exchangeRate: '',
  grossAmount: '',
  frnGrossAmount: '',
  localCharge: '',
  frnLocalCharge: '',
  localNetAmount: '',
  frnLocalNetAmount: '',
  commissionAmount: '',
  frnCommissionAmount: '',
  commissionCtax: '',
  frnCommissionCtax: '',
  netAmount: '',
  frnNetAmount: '',
  executionNetAmount: '',
}

type Handler = (body: { operationName: string; variables: Record<string, unknown> }) => unknown

const mockGraphql = (handler: Handler) => {
  const calls: Array<{ operationName: string; variables: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as {
      operationName: string
      variables: Record<string, unknown>
    }
    calls.push(body)
    const payload = handler(body)
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('US stock settlement-aware preview', () => {
  test('reserves the JPY settlement amount for a yen-settlement buy', async () => {
    const calls = mockGraphql((body) => {
      if (body.operationName === 'ConfirmOrderCreating') return yenConfirm()
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const preview = await adapter.estimate(orderInput)

    expect(preview.settlementCurrency).toBe('JPY')
    expect(preview.estimatedAmount).toMatchObject({ currency: 'JPY', value: 938 })
    expect(preview.heldAmount).toMatchObject({ currency: 'JPY', value: 938 })
    expect(preview.tradeAmount).toMatchObject({ currency: 'USD', value: 5.58 })
    expect(preview.buyingPower).toMatchObject({ currency: 'JPY', value: 171634 })
    expect(preview.commission).toMatchObject({ currency: 'JPY', value: 3 })
    expect(preview.exchangeRate).toBe('159.59')
    expect(preview.confirmationId).toBeTruthy()
    expect(
      (calls[0]!.variables.input as { order: Record<string, unknown> }).order.settlementMethodCode,
    ).toBe('YEN_SETTLEMENT')
  })

  test('reserves the USD settlement amount for a foreign-settlement buy', async () => {
    mockGraphql((body) => {
      if (body.operationName === 'ConfirmOrderCreating') return foreignConfirm()
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const preview = await adapter.estimate({
      ...orderInput,
      foreignStockSettlementMethod: 'foreign',
    })

    expect(preview.settlementCurrency).toBe('USD')
    expect(preview.estimatedAmount).toMatchObject({ currency: 'USD', value: 5.6 })
    expect(preview.heldAmount).toMatchObject({ currency: 'USD', value: 5.6 })
    expect(preview.tradeAmount).toMatchObject({ currency: 'USD', value: 5.6 })
    expect(preview.buyingPower).toMatchObject({ currency: 'USD' })
  })

  test('exposes no cash hold for a sell order', async () => {
    mockGraphql((body) => {
      if (body.operationName === 'ConfirmOrderCreating') return yenConfirm()
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const preview = await adapter.estimate({ ...orderInput, side: 'sell' })
    expect(preview.heldAmount).toBeUndefined()
    expect(preview.settlementCurrency).toBe('JPY')
  })

  test('leaves the hold empty when the settlement amount cannot be established', async () => {
    mockGraphql((body) => {
      if (body.operationName === 'ConfirmOrderCreating')
        return confirmResponse({ netAmount: '', exchangeRate: '' })
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const preview = await adapter.estimate(orderInput)
    expect(preview.settlementCurrency).toBe('JPY')
    expect(preview.heldAmount?.value ?? null).toBeNull()
  })
})

describe('US stock order inquiry settlement hydration', () => {
  const listResponse = (rows: unknown[]) => ({
    data: {
      listForeignStockOrders: {
        orderDecodes: rows,
        page: { hasNextPage: false },
      },
    },
  })

  test('hydrates the JPY hold of an open yen-settlement buy via confirmation', async () => {
    const calls = mockGraphql((body) => {
      if (body.operationName === 'GetOrderList') return listResponse([openYenOrderRow])
      if (body.operationName === 'ConfirmOrderCreating') return yenConfirm()
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const list = await adapter.orders({ status: 'open' })

    const order = list.orders[0]!
    expect(order.settlementCurrency).toBe('JPY')
    expect(order.heldAmount).toMatchObject({ currency: 'JPY', value: 938 })
    const confirm = calls.find((call) => call.operationName === 'ConfirmOrderCreating')
    expect((confirm!.variables.input as { order: Record<string, unknown> }).order).toMatchObject({
      orderQuantity: '1',
      orderPrice: '5.58',
      settlementMethodCode: 'YEN_SETTLEMENT',
      specificAccountCode: 'SPECIFIC',
    })
  })

  test('does not hydrate terminal or sell orders', async () => {
    const calls = mockGraphql((body) => {
      if (body.operationName === 'GetOrderList')
        return listResponse([
          { ...openYenOrderRow, orderStatus: 'CANCELLED' },
          { ...openYenOrderRow, orderSubNo: 'A01', buySellCode: 'SELL' },
        ])
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const list = await adapter.orders({ status: 'open' })
    expect(calls.some((call) => call.operationName === 'ConfirmOrderCreating')).toBe(false)
    expect(list.orders).toHaveLength(1)
    expect(list.orders[0]!.side).toBe('sell')
  })

  test('reads the settled amount from the order detail when executions exist', async () => {
    mockGraphql((body) => {
      if (body.operationName === 'GetOrderList')
        return listResponse([
          { ...openYenOrderRow, executionQuantity: '1', unexecutedQuantity: '' },
        ])
      if (body.operationName === 'GetOrderSettlementDetail')
        return {
          data: {
            getForeignStockOrderDetail: {
              orderDetail: {
                order: {
                  settlementMethodCode: 'YEN_SETTLEMENT',
                  settlementCurrencyCode: 'JPY',
                  netAmount: '895',
                  frnNetAmount: '',
                  executionQuantity: '1',
                  unexecutedQuantity: '',
                },
              },
            },
          },
        }
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const list = await adapter.orders({ status: 'open' })
    expect(list.orders[0]!.settledAmount).toMatchObject({ currency: 'JPY', value: 895 })
  })

  test('hydrates an open buy order detail with the broker hold', async () => {
    mockGraphql((body) => {
      if (body.operationName === 'GetOrderList') return listResponse([openYenOrderRow])
      if (body.operationName === 'GetOrderDetail')
        return {
          data: {
            getForeignStockOrderDetail: {
              orderDetail: { cancelable: true, correctable: true, order: openOrderDetailRow },
            },
          },
        }
      if (body.operationName === 'ConfirmOrderCreating') return yenConfirm()
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const order = await adapter.orderDetail({ orderNumber: 'I00', market: 'XNYS' })
    expect(order.settlementCurrency).toBe('JPY')
    expect(order.heldAmount).toMatchObject({ currency: 'JPY', value: 938 })
  })
})

describe('US stock place/cancel identity', () => {
  test('returns the orderSubNo identity used by order lists', async () => {
    const calls = mockGraphql((body) => {
      if (body.operationName === 'GetOrderCreatingInitialData')
        return {
          data: {
            getForeignStockCreatedOrderInitialization: {
              orderTerms: ['2026-11-24'],
              settlementMethodCodes: ['FOREIGN_SETTLEMENT', 'YEN_SETTLEMENT'],
            },
          },
        }
      if (body.operationName === 'SubmitOrderCreating')
        return {
          data: {
            createForeignStockOrder: {
              order: {
                orderNo: 'I00',
                orderSubNo: 'A00',
                orderInputDatetime: '2026-11-22T22:42:52.929+09:00',
                orderStatus: 'ORDERING',
              },
              warningStatuses: [],
            },
          },
        }
      throw new Error(`unexpected ${body.operationName}`)
    })
    const adapter = createUsStockAdapter(session)
    const receipt = await adapter.place({ ...orderInput, orderTerm: 'day', allowTrading: true })
    expect(receipt.orderId).toBe('A00')
    const submit = calls.find((call) => call.operationName === 'SubmitOrderCreating')
    expect(submit?.variables.input).toMatchObject({
      order: { settlementMethodCode: 'YEN_SETTLEMENT' },
    })
  })
})
