import { randomUUID } from 'node:crypto'
import {
  OrderOutcomeUnknownError,
  PayPaySecError,
  UnsupportedPayPaySecOperationError,
} from './errors'
import { parseHistory, parseInstrumentList, parsePositions, parseSettlementPage } from './parsers'
import { createTransport, normalizePayPaySecOrigin } from './transport'
import type {
  PayPaySecAccountType,
  PayPaySecAvailability,
  PayPaySecBuyPreviewOptions,
  PayPaySecClient,
  PayPaySecClientOptions,
  PayPaySecFetch,
  PayPaySecOrderPreview,
  PayPaySecOrderReceipt,
  PayPaySecOrderSide,
  PayPaySecOrderSubmitOptions,
  PayPaySecSellPreviewOptions,
  PayPaySecSession,
  PayPaySecValuation,
} from './types'

interface JsonRecord {
  [key: string]: unknown
}

interface ConfirmationTicket {
  preview: PayPaySecOrderPreview
  expiresAt: number
  form: Record<string, string>
}

const requiredEnvironment = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new PayPaySecError(`${name} is required`, 'MISSING_CONFIGURATION')
  return value
}

const record = (value: unknown, name: string): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayPaySecError(
      `PayPay Securities response did not include ${name}`,
      'INVALID_RESPONSE',
    )
  }
  return value as JsonRecord
}

const records = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : []

const stringValue = (value: unknown, name: string): string => {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new PayPaySecError(`PayPay Securities response did not include ${name}`, 'INVALID_RESPONSE')
}

const optionalString = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : undefined

const messages = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const assertBrandId = (value: string) => {
  if (!/^\d+$/.test(value)) {
    throw new PayPaySecError('brandId must contain digits only', 'INVALID_ARGUMENT')
  }
}

function assertAccountType(value: number): asserts value is PayPaySecAccountType {
  if (![1, 2, 3, 4].includes(value)) {
    throw new PayPaySecError('accountType must be 1, 2, 3, or 4', 'INVALID_ARGUMENT')
  }
}

const assertAmount = (value: string) => {
  if (!/^\d+$/.test(value) || BigInt(value) < 100n) {
    throw new PayPaySecError('order amount must be an integer of at least 100', 'INVALID_ARGUMENT')
  }
}

const availability = (value: JsonRecord): PayPaySecAvailability => ({
  countryName: optionalString(value.COUNTRY_NAME) ?? '',
  preorderable: Number(value.PREORDERABLE) === 1,
  buyDisabled: value.buy_disableFlg === true,
  sellDisabled: value.sell_disableFlg === true,
  brand: record(value.brand, 'brand'),
  client: record(value.client ?? {}, 'client'),
  range: record(value.range, 'range'),
  holdingInfo: records(value.HOLDING_INFO),
})

const confirmationPreview = (
  side: PayPaySecOrderSide,
  brandId: string,
  accountType: PayPaySecAccountType,
  value: JsonRecord,
) => {
  const data = record(value.DATA, 'DATA')
  const brand = record(data.brand, 'DATA.brand')
  const duration = Number(brand.ORDERTIME_LIMIT)
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new PayPaySecError(
      'PayPay Securities response did not include a valid order time limit',
      'INVALID_RESPONSE',
    )
  }
  const now = Date.now()
  const confirmationId = randomUUID()
  const preview: PayPaySecOrderPreview = {
    confirmationId,
    side,
    brandId,
    instrumentName: stringValue(brand.BRAND_NM, 'DATA.brand.BRAND_NM'),
    accountType,
    amount: stringValue(brand.ORDER_AMOUNT, 'DATA.brand.ORDER_AMOUNT'),
    quantity: stringValue(brand.ORDER_QTY, 'DATA.brand.ORDER_QTY'),
    price: stringValue(brand.ORDER_PRICE, 'DATA.brand.ORDER_PRICE'),
    exchangeRate: stringValue(brand.ORDER_EXCHANGE_RATE, 'DATA.brand.ORDER_EXCHANGE_RATE'),
    expiresAt: new Date(now + duration).toISOString(),
    warnings: [...messages(value.MESSAGE_ARRAY), ...messages(brand.MESSAGE_ARRAY)],
  }
  return { data, brand, preview, expiresAt: now + duration }
}

const commonCompleteForm = (
  brand: JsonRecord,
  preview: PayPaySecOrderPreview,
  csrfToken: string,
) => ({
  BRAND_ID: preview.brandId,
  ORDER_CONFIRM_NO: stringValue(brand.ORDER_CONFIRM_NO, 'DATA.brand.ORDER_CONFIRM_NO'),
  ORDER_AMOUNT: preview.amount,
  ORDER_QTY: preview.quantity,
  ORDER_PRICE: preview.price,
  ORDER_EXCHANGE_RATE: preview.exchangeRate,
  CSRF_TOKEN: csrfToken,
  IS_NON_INSIDER_TRADING_CONFIRMED: '',
  PLAN_TYPE: '0',
  ACCOUNT_TYPE: String(preview.accountType),
})

const receipt = (
  side: PayPaySecOrderSide,
  brandId: string,
  value: JsonRecord,
): PayPaySecOrderReceipt => ({
  side,
  brandId,
  instrumentCode: stringValue(value.BRAND_CD, 'BRAND_CD'),
  instrumentName: stringValue(value.BRAND_NM, 'BRAND_NM'),
  amount: stringValue(value.ORDER_AMOUNT, 'ORDER_AMOUNT'),
  message: stringValue(
    side === 'buy' ? value.COMPLETE_BUY_MSG : value.COMPLETE_SELL_MSG,
    side === 'buy' ? 'COMPLETE_BUY_MSG' : 'COMPLETE_SELL_MSG',
  ),
})

export const createPayPaySecClient = (options: PayPaySecClientOptions = {}): PayPaySecClient => {
  const baseURL = normalizePayPaySecOrigin(
    requiredEnvironment(options.baseURL?.toString() ?? process.env.PAYPAY_SEC_BASE_URL, 'baseURL'),
  )
  const accountId = options.accountId?.trim() || 'primary'
  const tickets = new Map<string, ConfirmationTicket>()
  const transport = createTransport({
    baseURL,
    cookies: options.cookies ?? {},
    fetch: options.fetch ?? globalThis.fetch,
    onLocked: () => tickets.clear(),
  })

  const csrfToken = () => {
    const value = transport.cookies.value('fuel_csrf_token')
    if (!value) {
      throw new PayPaySecError(
        'PayPay Securities order screen did not provide a CSRF token',
        'MISSING_CSRF_TOKEN',
      )
    }
    return value
  }

  const fetchBuyAvailability = async (brandId: string) => {
    assertBrandId(brandId)
    return availability(
      await transport.json<JsonRecord>(`/trade/brand/ajax_buy/${brandId}`, {
        referer: `/trade/brand/buy/${brandId}`,
      }),
    )
  }

  const fetchSellAvailability = async (options: {
    brandId: string
    subClientSeqNo: string
    accountType: PayPaySecAccountType
  }) => {
    assertBrandId(options.brandId)
    assertAccountType(options.accountType)
    if (!/^\d*$/.test(options.subClientSeqNo)) {
      throw new PayPaySecError(
        'subClientSeqNo must be empty or contain digits only',
        'INVALID_ARGUMENT',
      )
    }
    const seq = options.subClientSeqNo || '0'
    return availability(
      await transport.json<JsonRecord>(
        `/trade/brand/ajax_sell/${options.brandId}/${seq}/${options.accountType}`,
        { referer: `/trade/brand/sell/${options.brandId}/${seq}` },
      ),
    )
  }

  const submit = async (
    side: PayPaySecOrderSide,
    options: PayPaySecOrderSubmitOptions,
  ): Promise<PayPaySecOrderReceipt> => {
    if (options.allowTransaction !== true) {
      throw new PayPaySecError('allowTransaction: true is required', 'TRANSACTION_NOT_ALLOWED')
    }
    if (!options.tradePassword) {
      throw new PayPaySecError('tradePassword is required', 'INVALID_ARGUMENT')
    }
    const ticket = tickets.get(options.confirmationId)
    if (!ticket || ticket.preview.side !== side) {
      throw new PayPaySecError(
        'order confirmation is missing or has already been used',
        'INVALID_CONFIRMATION',
      )
    }
    tickets.delete(options.confirmationId)
    if (Date.now() >= ticket.expiresAt) {
      throw new PayPaySecError('order confirmation has expired', 'EXPIRED_CONFIRMATION')
    }
    try {
      const value = await transport.json<JsonRecord>(`/trade/brand/ajax_${side}_complete`, {
        method: 'POST',
        referer: `/trade/brand/${side}/${ticket.preview.brandId}`,
        form: { TRADE_PASSWORD: options.tradePassword, ...ticket.form },
      })
      return receipt(side, ticket.preview.brandId, value)
    } catch (cause) {
      if (
        cause instanceof PayPaySecError &&
        [
          'NETWORK_ERROR',
          'HTTP_ERROR',
          'INVALID_JSON',
          'EMPTY_RESPONSE',
          'INVALID_RESPONSE',
        ].includes(cause.code)
      ) {
        throw new OrderOutcomeUnknownError(options.confirmationId, { cause })
      }
      throw cause
    }
  }

  return {
    accountId,
    baseURL,
    session: {
      export: () => {
        const cookies = transport.cookies.export()
        delete cookies.fuel_csrf_token
        return { accountId, baseURL, cookies }
      },
    },
    market: {
      instruments: {
        list: async ({ market }) =>
          parseInstrumentList(await transport.html(`/trade?country=${market}`, '/trade/'), market),
        detail: async ({ brandId }) => {
          assertBrandId(brandId)
          const value = await transport.json<JsonRecord>(`/trade/brand/ajax_detail/${brandId}/0`, {
            referer: `/trade/brand/${brandId}/0`,
          })
          const brand = record(value.brand, 'brand')
          return {
            brandId: optionalString(brand.BRAND_ID) ?? brandId,
            name: stringValue(brand.BRAND_NM, 'brand.BRAND_NM'),
            code: optionalString(brand.BRAND_CD),
            price: optionalString(brand.PRICE),
          }
        },
      },
    },
    account: {
      valuation: async (valuationOptions = {}) => {
        if (valuationOptions.countryId !== undefined && valuationOptions.countryId !== 2) {
          throw new UnsupportedPayPaySecOperationError('only COUNTRY_ID=2 has been observed')
        }
        const value = await transport.json<JsonRecord>('/trade/top/ajax_interval.json', {
          method: 'POST',
          referer: '/trade?country=japan',
          form: { COUNTRY_ID: '2' },
        })
        const brandArray = record(value.BRAND_ARRAY ?? {}, 'BRAND_ARRAY')
        const result: PayPaySecValuation = {
          countryId: 2,
          withdrawableCash: optionalString(value.WITHDRAWABLE_CASH),
          securitiesValueTotal: stringValue(value.SECURITIES_VALUE_TOTAL, 'SECURITIES_VALUE_TOTAL'),
          grossProfitTotal: optionalString(value.SUM_GROSS_PROFIT_TOTAL),
          acquisitionTotal: optionalString(value.TOTAL_ACQUISITION_FEE_TAX_TOTAL),
          buyableCash: stringValue(value.BUYABLE_CASH, 'BUYABLE_CASH'),
          assetsTotal: stringValue(value.ASSETS_TOTAL, 'ASSETS_TOTAL'),
          profitLossTotalVisible: Number(value.PROFIT_LOSS_TOTAL_FLG) !== 0,
          profitLossVisible: Number(value.PROFIT_LOSS_FLG) !== 0,
          brands: Object.values(brandArray).map((item) => {
            const brand = record(item, 'BRAND_ARRAY item')
            return {
              brandId: stringValue(brand.BRAND_ID, 'BRAND_ID'),
              securitiesValue: stringValue(brand.SECURITIES_VALUE, 'SECURITIES_VALUE'),
              grossProfit: stringValue(brand.SUM_GROSS_PROFIT, 'SUM_GROSS_PROFIT'),
            }
          }),
        }
        return result
      },
    },
    portfolio: {
      positions: async ({ country }) =>
        parsePositions(
          await transport.html(`/trade/portfolio/brands/${country}`, `/trade/portfolio/${country}`),
          country,
        ),
    },
    history: {
      trades: async () =>
        parseHistory(
          await transport.html('/trade/history/trades/japan', '/trade/history/japan'),
          'trade',
        ),
      settlements: async () => {
        await transport.html('/trade/history/settlements/japan', '/trade/history/japan')
        const result = []
        let offset = 0
        while (true) {
          const page = parseSettlementPage(
            await transport.json<JsonRecord>(
              `/trade/history/ajax_settlement.json?PAGE_NUM=${offset}`,
              { referer: '/trade/history/settlements/japan' },
            ),
          )
          result.push(...page.records)
          if (!page.hasNext) return result
          if (page.records.length === 0) {
            throw new PayPaySecError(
              'PayPay Securities settlement history pagination did not advance',
              'INVALID_RESPONSE',
            )
          }
          offset += page.records.length
        }
      },
      grossProfits: async () =>
        parseHistory(
          await transport.html('/trade/history/gross_profits/japan', '/trade/history/japan'),
          'gross-profit',
        ),
    },
    orders: {
      buy: {
        availability: ({ brandId }) => fetchBuyAvailability(brandId),
        preview: async (previewOptions: PayPaySecBuyPreviewOptions) => {
          assertBrandId(previewOptions.brandId)
          assertAccountType(previewOptions.accountType)
          assertAmount(previewOptions.amount)
          await transport.html(
            `/trade/brand/buy/${previewOptions.brandId}`,
            `/trade/brand/${previewOptions.brandId}/0`,
          )
          const available = await fetchBuyAvailability(previewOptions.brandId)
          if (available.buyDisabled) {
            throw new PayPaySecError('buying is currently disabled', 'ORDER_DISABLED')
          }
          const value = await transport.json<JsonRecord>('/trade/brand/ajax_buy_popup.json', {
            method: 'POST',
            referer: `/trade/brand/buy/${previewOptions.brandId}`,
            form: {
              amountTyp: '0',
              val: previewOptions.amount,
              BRAND_ID: previewOptions.brandId,
              buyAllChange: '0',
              globalOrderAmountLower: optionalString(available.brand.ORDER_AMOUNT_LOWER) ?? '1',
              preorder: '0',
              PLAN_TYPE: '0',
              KEY: '',
              PAYPAY_FLG: '0',
              ACCOUNT_TYPE: String(previewOptions.accountType),
            },
          })
          const confirmation = confirmationPreview(
            'buy',
            previewOptions.brandId,
            previewOptions.accountType,
            value,
          )
          tickets.set(confirmation.preview.confirmationId, {
            preview: confirmation.preview,
            expiresAt: confirmation.expiresAt,
            form: {
              ...commonCompleteForm(confirmation.brand, confirmation.preview, csrfToken()),
              AMOUNT_TYP: '0',
            },
          })
          return confirmation.preview
        },
        submit: (submitOptions) => submit('buy', submitOptions),
      },
      sell: {
        availability: fetchSellAvailability,
        preview: async (previewOptions: PayPaySecSellPreviewOptions) => {
          assertBrandId(previewOptions.brandId)
          assertAccountType(previewOptions.accountType)
          if (previewOptions.mode === 'amount') assertAmount(previewOptions.amount)
          if (!/^\d*$/.test(previewOptions.subClientSeqNo)) {
            throw new PayPaySecError(
              'subClientSeqNo must be empty or contain digits only',
              'INVALID_ARGUMENT',
            )
          }
          const seq = previewOptions.subClientSeqNo || '0'
          await transport.html(
            `/trade/brand/sell/${previewOptions.brandId}/${seq}`,
            `/trade/brand/${previewOptions.brandId}/0`,
          )
          const available = await fetchSellAvailability(previewOptions)
          if (available.sellDisabled) {
            throw new PayPaySecError('selling is currently disabled', 'ORDER_DISABLED')
          }
          const amountType = previewOptions.mode === 'all' ? '1' : '0'
          const value = await transport.json<JsonRecord>('/trade/brand/ajax_sell_popup.json', {
            method: 'POST',
            referer: `/trade/brand/sell/${previewOptions.brandId}/${seq}`,
            form: {
              amountTyp: amountType,
              val: previewOptions.mode === 'all' ? '0' : previewOptions.amount,
              BRAND_ID: previewOptions.brandId,
              SUB_CLIENT_SEQ_NO: previewOptions.subClientSeqNo,
              preorder: '0',
              PLAN_TYPE: '0',
              PAYPAY_FLG: '0',
              ACCOUNT_TYPE: String(previewOptions.accountType),
            },
          })
          const confirmation = confirmationPreview(
            'sell',
            previewOptions.brandId,
            previewOptions.accountType,
            value,
          )
          tickets.set(confirmation.preview.confirmationId, {
            preview: confirmation.preview,
            expiresAt: confirmation.expiresAt,
            form: {
              ...commonCompleteForm(confirmation.brand, confirmation.preview, csrfToken()),
              AMOUNT_TYP: amountType,
              SUB_CLIENT_SEQ_NO:
                optionalString(confirmation.data.SUB_CLIENT_SEQ_NO) ??
                previewOptions.subClientSeqNo,
            },
          })
          return confirmation.preview
        },
        submit: (submitOptions) => submit('sell', submitOptions),
      },
    },
    close() {
      tickets.clear()
      transport.close()
    },
  }
}

export const importSession = async (
  session: PayPaySecSession,
  options: { fetch?: PayPaySecFetch } = {},
): Promise<PayPaySecClient> => createPayPaySecClient({ ...session, fetch: options.fetch })

export const exportSession = (client: PayPaySecClient): PayPaySecSession => client.session.export()
