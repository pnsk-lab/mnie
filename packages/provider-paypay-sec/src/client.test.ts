import { describe, expect, test, vi } from 'vitest'
import {
  createPayPaySecClient,
  OrderOutcomeUnknownError,
  PayPaySecError,
  SessionLockedError,
} from './index'

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

const valuation = {
  STATUS: true,
  MESSAGE_ARRAY: null,
  WITHDRAWABLE_CASH: '50.0000000000',
  SECURITIES_VALUE_TOTAL: '1250.0000000000',
  SUM_GROSS_PROFIT_TOTAL: '50.0000000000',
  TOTAL_ACQUISITION_FEE_TAX_TOTAL: '1200.0000000000',
  BUYABLE_CASH: '100.0000000000',
  ASSETS_TOTAL: '1350.0000000000',
  PROFIT_LOSS_TOTAL_FLG: 1,
  PROFIT_LOSS_FLG: 1,
  BRAND_ARRAY: {
    101: {
      BRAND_ID: '101',
      SECURITIES_VALUE: '1250.0000000000',
      SUM_GROSS_PROFIT: '50.0000000000',
    },
  },
}

const available = {
  STATUS: true,
  COUNTRY_NAME: '日本',
  PREORDERABLE: 0,
  buy_disableFlg: false,
  sell_disableFlg: false,
  brand: { BRAND_ID: '101', ORDER_AMOUNT_LOWER: '1.00000' },
  client: {},
  range: {},
  HOLDING_INFO: [],
}

const preview = {
  STATUS: true,
  MESSAGE_ARRAY: null,
  DATA: {
    brand: {
      BRAND_ID: '101',
      BRAND_NM: 'Example Holdings',
      BRAND_CD: 'EXM',
      ORDER_CONFIRM_NO: 'secret-confirmation',
      ORDER_AMOUNT: 1000,
      ORDER_QTY: '0.5000000000',
      ORDER_PRICE: 2000,
      ORDER_EXCHANGE_RATE: 1,
      ORDERTIME_LIMIT: '60000',
      MESSAGE_ARRAY: [],
    },
  },
}

const settlement = (id: string, summaryType = '1') => ({
  ORDER_UUID: id,
  SEQ_NO: id,
  TRADE_D: '2026-07-13',
  SUMMARY_TYPE: summaryType,
  BRAND_ID: '101',
  BRAND_NM: 'Example Holdings',
  ACCOUNT_TYPE: '2',
  AMOUNT: '1000',
  QTY: '0.5',
  PRICE: '2000',
})

describe('PayPay Securities client', () => {
  test('validates origins', () => {
    expect(() => createPayPaySecClient({ baseURL: 'https://example.test/path' })).toThrow(
      'must be an origin',
    )
  })

  test('sends valuation as an Ajax form and preserves decimals and cookies', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.test/trade/top/ajax_interval.json')
      const headers = new Headers(init?.headers)
      expect(headers.get('cookie')).toBe('session=initial')
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest')
      expect(headers.get('origin')).toBe('https://example.test')
      expect(String(init?.body)).toBe('COUNTRY_ID=2')
      return json(valuation, { headers: { 'set-cookie': 'session=updated; Path=/; HttpOnly' } })
    })
    const client = createPayPaySecClient({
      baseURL: 'https://example.test',
      cookies: { session: 'initial' },
      fetch,
    })
    const result = await client.account.valuation()
    expect(result.assetsTotal).toBe('1350.0000000000')
    expect(result.brands[0]?.securitiesValue).toBe('1250.0000000000')
    expect(client.session.export().cookies).toEqual({ session: 'updated' })
  })

  test('loads instrument price from the observed ajax detail endpoint', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.test/trade/brand/ajax_detail/836/0')
      const headers = new Headers(init?.headers)
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest')
      expect(headers.get('referer')).toBe('https://example.test/trade/brand/836/0')
      return json({
        STATUS: true,
        brand: {
          BRAND_ID: '836',
          BRAND_NM: 'SPACE EXPLORATION TECHNOLOGIES CORP.',
          BRAND_CD: 'SPCX',
          PRICE: 140.44,
        },
      })
    })
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })
    await expect(client.market.instruments.detail({ brandId: '836' })).resolves.toEqual({
      brandId: '836',
      name: 'SPACE EXPLORATION TECHNOLOGIES CORP.',
      code: 'SPCX',
      price: '140.44',
    })
  })

  test('loads settlement history using record offsets', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responses = [
      new Response('<html>settlements</html>'),
      json({
        STATUS: true,
        MESSAGE_ARRAY: null,
        CO_TRADE_HIST: [settlement('order-1'), settlement('fee-1', '54')],
        NEXT_FLG: 1,
      }),
      json({
        STATUS: true,
        MESSAGE_ARRAY: null,
        CO_TRADE_HIST: [settlement('order-2', '2')],
        NEXT_FLG: 0,
      }),
    ]
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      const response = responses.shift()
      if (!response) throw new Error('unexpected request')
      return response
    })
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })

    await expect(client.history.settlements()).resolves.toHaveLength(3)
    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/trade/history/settlements/japan',
      'https://example.test/trade/history/ajax_settlement.json?PAGE_NUM=0',
      'https://example.test/trade/history/ajax_settlement.json?PAGE_NUM=2',
    ])
    for (const request of requests.slice(1)) {
      const headers = new Headers(request.init?.headers)
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest')
      expect(headers.get('referer')).toBe('https://example.test/trade/history/settlements/japan')
    }
  })

  test('rejects settlement pagination that does not advance', async () => {
    const responses = [
      new Response('<html>settlements</html>'),
      json({ STATUS: true, CO_TRADE_HIST: [], NEXT_FLG: 1 }),
    ]
    const client = createPayPaySecClient({
      baseURL: 'https://example.test',
      fetch: vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })),
    })
    await expect(client.history.settlements()).rejects.toThrow('did not advance')
  })

  test('uses a one-time preview for buy submission and never exports secrets', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responses = [
      new Response('<html>order</html>', {
        headers: { 'set-cookie': 'fuel_csrf_token=csrf%2Dtest; Path=/; Secure' },
      }),
      json(available),
      json(preview),
      json({
        STATUS: true,
        MESSAGE_ARRAY: null,
        ORDER_AMOUNT: '1000',
        BRAND_NM: 'Example Holdings',
        BRAND_CD: 'EXM',
        COMPLETE_BUY_MSG: 'completed',
      }),
    ]
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      const response = responses.shift()
      if (!response) throw new Error('unexpected request')
      return response
    })
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })
    const value = await client.orders.buy.preview({
      brandId: '101',
      amount: '1000',
      accountType: 2,
    })
    expect(value.instrumentName).toBe('Example Holdings')
    expect(client.session.export()).toEqual({
      accountId: 'primary',
      baseURL: 'https://example.test',
      cookies: {},
    })
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: '',
        allowTransaction: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: 'trade-secret',
        allowTransaction: false,
      } as never),
    ).rejects.toMatchObject({ code: 'TRANSACTION_NOT_ALLOWED' })
    const result = await client.orders.buy.submit({
      confirmationId: value.confirmationId,
      tradePassword: 'trade-secret',
      allowTransaction: true,
    })
    expect(result).toMatchObject({ side: 'buy', amount: '1000', instrumentCode: 'EXM' })
    const submitted = String(requests[3]?.init?.body)
    const form = new URLSearchParams(submitted)
    expect(form.get('TRADE_PASSWORD')).toBe('trade-secret')
    expect(form.get('CSRF_TOKEN')).toBe('csrf-test')
    expect(form.get('ORDER_CONFIRM_NO')).toBe('secret-confirmation')
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: 'trade-secret',
        allowTransaction: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  test('does not retry an indeterminate submission', async () => {
    const responses = [
      new Response('<html>order</html>', {
        headers: { 'set-cookie': 'fuel_csrf_token=csrf; Path=/' },
      }),
      json(available),
      json(preview),
    ]
    const fetch = vi.fn(async () => {
      const response = responses.shift()
      if (response) return response
      throw new Error('socket closed')
    })
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })
    const value = await client.orders.buy.preview({
      brandId: '101',
      amount: '1000',
      accountType: 2,
    })
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: 'secret',
        allowTransaction: true,
      }),
    ).rejects.toBeInstanceOf(OrderOutcomeUnknownError)
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: 'secret',
        allowTransaction: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  test('rejects an expired confirmation without sending it', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(1_002)
    const responses = [
      new Response('<html>order</html>', {
        headers: { 'set-cookie': 'fuel_csrf_token=csrf; Path=/' },
      }),
      json(available),
      json({
        ...preview,
        DATA: { brand: { ...preview.DATA.brand, ORDERTIME_LIMIT: '1' } },
      }),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })
    const value = await client.orders.buy.preview({
      brandId: '101',
      amount: '1000',
      accountType: 2,
    })
    await expect(
      client.orders.buy.submit({
        confirmationId: value.confirmationId,
        tradePassword: 'secret',
        allowTransaction: true,
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED_CONFIRMATION' })
    expect(fetch).toHaveBeenCalledTimes(3)
    now.mockRestore()
  })

  test('submits the observed sell-all form', async () => {
    const requests: RequestInit[] = []
    const responses = [
      new Response('<html>order</html>', {
        headers: { 'set-cookie': 'fuel_csrf_token=csrf; Path=/' },
      }),
      json(available),
      json({ ...preview, DATA: { ...preview.DATA, SUB_CLIENT_SEQ_NO: '' } }),
      json({
        STATUS: true,
        MESSAGE_ARRAY: null,
        ORDER_AMOUNT: 1000,
        BRAND_NM: 'Example Holdings',
        BRAND_CD: 'EXM',
        COMPLETE_SELL_MSG: 'completed',
      }),
    ]
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {})
      return responses.shift()!
    })
    const client = createPayPaySecClient({ baseURL: 'https://example.test', fetch })
    const value = await client.orders.sell.preview({
      brandId: '101',
      accountType: 2,
      subClientSeqNo: '',
      mode: 'all',
    })
    const previewForm = new URLSearchParams(String(requests[2]?.body))
    expect(previewForm.get('amountTyp')).toBe('1')
    expect(previewForm.get('val')).toBe('0')
    const result = await client.orders.sell.submit({
      confirmationId: value.confirmationId,
      tradePassword: 'secret',
      allowTransaction: true,
    })
    expect(result.side).toBe('sell')
    const submitForm = new URLSearchParams(String(requests[3]?.body))
    expect(submitForm.get('AMOUNT_TYP')).toBe('1')
    expect(submitForm.get('SUB_CLIENT_SEQ_NO')).toBe('')
  })

  test.each([
    [{ STATUS: false, MESSAGE_ARRAY: ['not available'] }, 'API_ERROR'],
    [
      { STATUS: false, MESSAGE_ARRAY: ['取引パスワードが正しくありません'] },
      'TRADE_PASSWORD_INVALID',
    ],
    [{ status: 'NG' }, 'API_ERROR'],
  ])('maps API failures without returning response objects', async (body, code) => {
    const client = createPayPaySecClient({
      baseURL: 'https://example.test',
      fetch: vi.fn(async () => json(body)),
    })
    await expect(client.account.valuation()).rejects.toMatchObject({ code })
  })

  test('invalidates cookies and future calls when LOCK_FLG is returned', async () => {
    const fetch = vi.fn(async () => json({ STATUS: false, LOCK_FLG: 1 }))
    const client = createPayPaySecClient({
      baseURL: 'https://example.test',
      cookies: { session: 'secret' },
      fetch,
    })
    await expect(client.account.valuation()).rejects.toBeInstanceOf(SessionLockedError)
    expect(client.session.export().cookies).toEqual({})
    await expect(client.account.valuation()).rejects.toBeInstanceOf(SessionLockedError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('rejects malformed JSON', async () => {
    const client = createPayPaySecClient({
      baseURL: 'https://example.test',
      fetch: vi.fn(async () => new Response('{not-json')),
    })
    await expect(client.account.valuation()).rejects.toEqual(
      expect.objectContaining<Partial<PayPaySecError>>({ code: 'INVALID_JSON' }),
    )
  })
})
