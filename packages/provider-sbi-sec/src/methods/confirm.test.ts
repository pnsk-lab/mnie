import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import iconv from 'iconv-lite'
import type { SbiSession } from '../types'
import { createMethodsFromSession } from './index'

const session = (): SbiSession =>
  ({
    mtsBaseUrl: 'https://example.test',
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
  }) as unknown as SbiSession

const fieldBytes = (value: string, width: number, align: 'left' | 'right' = 'left'): Buffer => {
  const encoded = iconv.encode(value, 'Shift_JIS')
  if (encoded.length > width) {
    throw new Error(`field "${value}" (${encoded.length} bytes) exceeds width ${width}`)
  }
  const pad = Buffer.alloc(width - encoded.length, 0x20)
  return align === 'right' ? Buffer.concat([pad, encoded]) : Buffer.concat([encoded, pad])
}

const mtsHeaderBytes = (trCode: string, resultCode = '000000') =>
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

const f1135OkBytes = () =>
  Buffer.concat([
    mtsHeaderBytes('F1135'),
    fieldBytes('', 20 + 20 + 20 + 20 + 14),
    fieldBytes('00', 2),
  ])

const cashConfirmResponse = (
  trCode: 'F2104' | 'F2124' | 'F2151' | 'F2152',
  fields: {
    depositTypeF?: string
    estimatePrice: string
    amountF: string
    commissionTypeF: string
    consumptionTax: string
    netAmount1: string
    acBalance: string
  },
) =>
  Buffer.concat([
    mtsHeaderBytes(trCode),
    fieldBytes('現物買', 20), // 70..90
    fieldBytes('7203', 5), // 90..95
    fieldBytes('TKY', 3), // 95..98
    fieldBytes('東証', 30), // 98..128
    fieldBytes('現物買', 10), // 128..138
    fieldBytes('東証', 13), // 138..151
    fieldBytes('', 16), // 151..167
    fieldBytes('100', 10, 'right'), // 167..177
    fieldBytes('成行', 22), // 177..199
    fieldBytes('当日中', 8), // 199..207
    fieldBytes(fields.depositTypeF ?? '特定預り', 12), // 207..219
    fieldBytes(fields.estimatePrice, 12, 'right'), // 219..231
    fieldBytes(fields.amountF, 17, 'right'), // 231..248
    fieldBytes(fields.commissionTypeF, 26), // 248..274
    fieldBytes(fields.consumptionTax, 17, 'right'), // 274..291
    fieldBytes(fields.netAmount1, 17, 'right'), // 291..308
    fieldBytes(fields.acBalance, 17, 'right'), // 308..325
  ])

const stubMtsResponses = (responses: Buffer[]) => {
  let index = 0
  const fetchMock = vi.fn(async () => {
    const payload = responses[Math.min(index++, responses.length - 1)]!
    return new Response(new Uint8Array(payload), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('domestic cash/IFD order confirm MTS parsing', () => {
  test('parses F2104 market buy confirm using exact SBI mobile fixed-width Shift_JIS offsets', async () => {
    // Include a full 12-byte depositTypeF right up to byte 219 and large amounts
    // that would have been truncated or polluted by the old guessed offsets.
    stubMtsResponses([
      mtsHeaderBytes('F2101'),
      f1135OkBytes(),
      cashConfirmResponse('F2104', {
        depositTypeF: '特定預り1234', // 8 Shift_JIS bytes + 4 ASCII bytes = 12 bytes (207..219)
        estimatePrice: '12,345',
        amountF: '1,234,500,000',
        commissionTypeF: 'スタンダード/1,070',
        consumptionTax: '107',
        netAmount1: '1,234,501,177',
        acBalance: '9,876,543,210',
      }),
    ])
    const methods = createMethodsFromSession(session())
    const preview = await methods.orders.cash.estimate({
      issueCode: '7203',
      market: 'XTKS',
      side: 'buy',
      kind: 'market',
      quantity: 100,
      accountType: 'specific',
      depositType: 'specific',
      orderTerm: 'day',
    })

    expect(preview.price).toMatchObject({ currency: 'JPY', value: 12345 })
    expect(preview.estimatedAmount).toMatchObject({ currency: 'JPY', value: 1234501177 })
    expect(preview.heldAmount).toMatchObject({ currency: 'JPY', value: 1234501177 })
    expect(preview.commission).toMatchObject({ currency: 'JPY', value: 1070 })
    expect(preview.tax).toMatchObject({ currency: 'JPY', value: 107 })
    expect(preview.buyingPower).toMatchObject({ currency: 'JPY', value: 9876543210 })
    expect(preview.warnings).toEqual([])
  })

  test('parses F2104 S-kabu market buy confirm', async () => {
    stubMtsResponses([
      mtsHeaderBytes('F2101'),
      f1135OkBytes(),
      cashConfirmResponse('F2104', {
        estimatePrice: '4,210',
        amountF: '4,210',
        commissionTypeF: 'ゼロ革命/0',
        consumptionTax: '0',
        netAmount1: '4,210',
        acBalance: '50,000',
      }),
    ])
    const methods = createMethodsFromSession(session())
    const preview = await methods.orders.cash.estimate({
      issueCode: '7203',
      market: 'STK',
      preOrderMarket: 'XTKS',
      side: 'buy',
      kind: 's',
      quantity: 1,
      accountType: 'specific',
      depositType: 'specific',
    })

    expect(preview.price).toMatchObject({ currency: 'JPY', value: 4210 })
    expect(preview.estimatedAmount).toMatchObject({ currency: 'JPY', value: 4210 })
    expect(preview.heldAmount).toMatchObject({ currency: 'JPY', value: 4210 })
    expect(preview.commission).toMatchObject({ currency: 'JPY', value: 0 })
    expect(preview.tax).toMatchObject({ currency: 'JPY', value: 0 })
    expect(preview.buyingPower).toMatchObject({ currency: 'JPY', value: 50000 })
    expect(preview.warnings).toEqual([])
  })

  test('parses F2151 cash IFD confirm using the same fixed-width layout', async () => {
    stubMtsResponses([
      cashConfirmResponse('F2151', {
        estimatePrice: '3,500',
        amountF: '350,000',
        commissionTypeF: 'ゼロ革命/0',
        consumptionTax: '0',
        netAmount1: '350,000',
        acBalance: '150,000',
      }),
    ])
    const methods = createMethodsFromSession(session())
    const preview = await methods.orders.ifd.estimate({
      issueCode: '7203',
      market: 'XTKS',
      side: 'buy',
      kind: 'market',
      quantity: 100,
      accountType: 'specific',
      depositType: 'specific',
      orderTerm: 'day',
      ifdPriceCondition: 'limit',
      ifdPrice: 3600,
    })

    expect(preview.price).toMatchObject({ currency: 'JPY', value: 3500 })
    expect(preview.estimatedAmount).toMatchObject({ currency: 'JPY', value: 350000 })
    expect(preview.heldAmount).toMatchObject({ currency: 'JPY', value: 350000 })
    expect(preview.warnings).toEqual([])
  })
})
