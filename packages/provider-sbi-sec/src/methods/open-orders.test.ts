import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import iconv from 'iconv-lite'
import type { SbiSession } from '../types'
import { createMethodsFromSession } from './index'

const createSessionWithForeign = (): SbiSession =>
  ({
    mtsBaseUrl: 'https://mts.example.test',
    tradePassword: 'pw',
    deviceIdRegistered: true,
    profile: {
      session: {
        sessionId: 'TESTSESSIONID000000000000001',
        loginType: 'passkey',
        resultCode: '000000',
      },
      account: {
        specificAccountType: 'withHolding',
        tradeAuthenticationRequired: false,
      },
    },
    foreignStock: {
      sessionId: 'US_BEARER_SECRET',
      accountId: 'US_ACCOUNT_SECRET',
      loginAuthenticated: true,
      endpoints: {
        graphqlIntUrl: 'https://us.example.test/graphql',
      },
    },
  }) as unknown as SbiSession

const fieldBytes = (value: string, width: number, align: 'left' | 'right' = 'left'): Buffer => {
  const encoded = iconv.encode(value, 'Shift_JIS')
  const pad = Buffer.alloc(width - encoded.length, 0x20)
  return align === 'right' ? Buffer.concat([pad, encoded]) : Buffer.concat([encoded, pad])
}

const mtsNoDataResponse = (trCode = 'F2511', resultCode = 'ME0010') =>
  Buffer.concat([
    fieldBytes('', 6),
    fieldBytes('TESTSESSIONID000000000000001', 28),
    fieldBytes(trCode, 5),
    fieldBytes('', 6),
    fieldBytes(resultCode, 6),
    fieldBytes('', 1),
    fieldBytes('153000000', 9),
    fieldBytes('', 5),
    fieldBytes('', 4),
  ])

describe('orders.inquiry.open per-market isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns domestic snapshot and scoped US timeout error when US GetOrderList returns HTTP 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('mts.example.test')) {
          return new Response(mtsNoDataResponse('F2511', 'ME0010'), { status: 200 })
        }
        return new Response('<html>504 Gateway Time-out secret-body</html>', { status: 504 })
      }),
    )

    const methods = createMethodsFromSession(createSessionWithForeign())
    const result = await methods.orders.inquiry.open({})
    expect(result.orders).toEqual([])
    expect(result.completeVenues).toEqual(['XTKS', 'XNGO', 'XFKA', 'XSAP'])
    expect(result.failedScopes).toEqual([
      {
        scope: 'us',
        venues: ['XNAS', 'XNYS', 'ARCX'],
        reason: 'timeout',
      },
    ])
  })

  test('returns US snapshot and scoped domestic error when domestic MTS fails while US succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('mts.example.test')) {
          return new Response(mtsNoDataResponse('F2511', 'E_0001'), { status: 200 })
        }
        return new Response(
          JSON.stringify({
            data: {
              listForeignStockOrders: {
                page: { hasNextPage: false },
                orderDecodes: [],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const methods = createMethodsFromSession(createSessionWithForeign())
    const result = await methods.orders.inquiry.open({})
    expect(result.orders).toEqual([])
    expect(result.completeVenues).toEqual(['XNAS', 'XNYS', 'ARCX'])
    expect(result.failedScopes).toEqual([
      {
        scope: 'domestic',
        venues: ['XTKS', 'XNGO', 'XFKA', 'XSAP'],
        reason: 'unknown',
        code: 'E_0001',
      },
    ])
  })

  test('throws when both domestic and US open-order inquiries fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Gateway Timeout', { status: 504 })),
    )

    const methods = createMethodsFromSession(createSessionWithForeign())
    await expect(methods.orders.inquiry.open({})).rejects.toThrow()
  })
})
