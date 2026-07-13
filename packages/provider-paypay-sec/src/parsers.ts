import { parse, type HTMLElement } from 'node-html-parser'
import { PayPaySecError } from './errors'
import type {
  PayPaySecAccountType,
  PayPaySecHistoryKind,
  PayPaySecHistoryRecord,
  PayPaySecInstrument,
  PayPaySecInstrumentDetail,
  PayPaySecMarket,
  PayPaySecPortfolioCountry,
  PayPaySecPosition,
} from './types'

const text = (node: HTMLElement | null | undefined) => node?.text.trim().replace(/\s+/g, ' ') ?? ''

const instrumentName = (value: string) =>
  value
    .replace(/(?:\s*[|｜\-–—:：]\s*)?取引詳細\s*$/, '')
    .replace(/^[\s●○◉•・]+|[\s●○◉•・]+$/g, '')
    .trim()

const decimal = (value: string | undefined) => {
  if (!value) return undefined
  const normalized = value.replace(/[¥￥$,\s]/g, '').replace(/^\+/, '')
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : undefined
}

const decimals = (value: string) =>
  (value.match(/[+-]?(?:[¥￥$]\s*)?\d[\d,]*(?:\.\d+)?/g) ?? []).flatMap((item) => {
    const parsed = decimal(item)
    return parsed === undefined ? [] : [parsed]
  })

const brandIdFrom = (value: string | undefined) =>
  value ? /\/trade\/brand\/(?:buy\/|sell\/)?(\d+)/.exec(value)?.[1] : undefined

export const parseInstrumentList = (
  html: string,
  market: PayPaySecMarket,
): PayPaySecInstrument[] => {
  const root = parse(html)
  const seen = new Set<string>()
  return root.querySelectorAll('a[href*="/trade/brand/"]').flatMap((anchor) => {
    const brandId = brandIdFrom(anchor.getAttribute('href'))
    if (!brandId || seen.has(brandId)) return []
    const container = anchor.closest('.mypage_brand_icon') ?? anchor.parentNode
    const name = instrumentName(
      text(container?.querySelector('.brand_text')) ||
        text(anchor.querySelector('.brand_text')) ||
        anchor.getAttribute('title')?.trim() ||
        anchor.getAttribute('aria-label')?.trim() ||
        '',
    )
    if (!name) return []
    seen.add(brandId)
    const style = anchor.querySelector('[style*="background-image"]')?.getAttribute('style')
    const imageURL = style
      ? /background-image\s*:\s*url\(['"]?([^'")]+)/i.exec(style)?.[1]
      : undefined
    return [{ brandId, name, market, ...(imageURL ? { imageURL } : {}) }]
  })
}

export const parseInstrumentDetail = (html: string, brandId: string): PayPaySecInstrumentDetail => {
  const root = parse(html)
  const name = instrumentName(
    text(root.querySelector('[data-brand-name]')) ||
      text(root.querySelector('.brand_name')) ||
      text(root.querySelector('.brand-name')) ||
      text(root.querySelector('.possession_brand a')) ||
      text(root.querySelector('.possession_brand')),
  )
  const code =
    root.querySelector('[data-brand-code]')?.getAttribute('data-brand-code') ??
    /BRAND_CD["']?\s*[:=]\s*["']([^"']+)/.exec(html)?.[1]
  const priceText =
    text(root.querySelector('[data-brand-price]')) ||
    text(root.querySelector('.brand_price')) ||
    text(root.querySelector('.price'))
  const price = decimal(priceText)
  if (!name) {
    throw new PayPaySecError('instrument detail HTML did not include a name', 'PARSE_ERROR')
  }
  return { brandId, name, ...(code ? { code } : {}), ...(price ? { price } : {}) }
}

export const parsePositions = (
  html: string,
  country: PayPaySecPortfolioCountry,
): PayPaySecPosition[] => {
  const root = parse(html)
  const attributedRows = root.querySelectorAll('[data-brand-id], tr').flatMap((row, index) => {
    const link = row.querySelector('a[href*="/trade/brand/"]')
    const brandId =
      row.getAttribute('data-brand-id') ??
      brandIdFrom(link?.getAttribute('href')) ??
      brandIdFrom(row.querySelector('[href*="/trade/brand/"]')?.getAttribute('href'))
    if (!brandId) return []
    const cells = row.querySelectorAll('td').map(text)
    const name = instrumentName(
      row.getAttribute('data-brand-name') ??
        (text(row.querySelector('.brand_text')) ||
          text(row.querySelector('.brand-name')) ||
          text(link) ||
          cells[0] ||
          `brand-${brandId}`),
    )
    const field = (attribute: string, selector: string, cellIndex: number) =>
      decimal(row.getAttribute(attribute) ?? text(row.querySelector(selector)) ?? cells[cellIndex])
    const accountTypeValue = Number(row.getAttribute('data-account-type'))
    const accountType = [1, 2, 3, 4].includes(accountTypeValue)
      ? (accountTypeValue as 1 | 2 | 3 | 4)
      : undefined
    const subClientSeqNo = row.getAttribute('data-sub-client-seq-no') ?? undefined
    return [
      {
        id: `${country}:${brandId}:${subClientSeqNo ?? index}`,
        brandId,
        name,
        country,
        quantity: field('data-quantity', '.quantity', 1),
        securitiesValue: field('data-securities-value', '.securities-value', 2),
        grossProfit: field('data-gross-profit', '.gross-profit', 3),
        acquisitionAmount: field('data-acquisition-amount', '.acquisition-amount', 4),
        ...(accountType ? { accountType } : {}),
        ...(subClientSeqNo !== undefined ? { subClientSeqNo } : {}),
      },
    ]
  })
  const legacyRows = root
    .querySelectorAll('tr.brand_normal[data-tt-id]')
    .flatMap((brandRow, brandIndex) => {
      const brandId = brandRow.getAttribute('data-tt-id')?.match(/^\d+$/)?.[0]
      if (!brandId) return []
      const name = instrumentName(
        text(brandRow.querySelector('.mybrand')) || text(brandRow.querySelector('a')),
      )
      const holdingRows = root
        .querySelectorAll('tr[data-tt-parent-id]')
        .filter((row) => row.getAttribute('data-tt-parent-id') === brandId)
      const rows = holdingRows.length ? holdingRows : [brandRow]
      return rows.flatMap((row, holdingIndex) => {
        const cells = row.querySelectorAll('td')
        if (cells.length < 4) return []
        const accountLabel = text(cells[0])
        const accountType: PayPaySecAccountType | undefined = /一般/.test(accountLabel)
          ? 1
          : /特定/.test(accountLabel)
            ? 2
            : /つみたて/i.test(accountLabel)
              ? 4
              : /NISA|ニーサ|成長/i.test(accountLabel)
                ? 3
                : undefined
        const valuationAndQuantity = decimals(text(cells[2]))
        const acquisitionAndProfit = decimals(text(cells[3]))
        const subClientSeqNo = '0'
        return [
          {
            id: `${country}:${brandId}:${accountType ?? `${brandIndex}-${holdingIndex}`}`,
            brandId,
            name: name || `brand-${brandId}`,
            country,
            securitiesValue: valuationAndQuantity[0],
            quantity: valuationAndQuantity[1],
            acquisitionAmount: acquisitionAndProfit[0],
            grossProfit: acquisitionAndProfit[1],
            ...(accountType ? { accountType } : {}),
            subClientSeqNo,
          },
        ]
      })
    })
  const unique = new Map(
    [...attributedRows, ...legacyRows].map((position) => [position.id, position]),
  )
  return [...unique.values()]
}

const headersFor = (table: HTMLElement) =>
  table.querySelectorAll('th').map((header, index) => text(header) || `column-${index + 1}`)

export const parseHistory = (
  html: string,
  kind: PayPaySecHistoryKind,
): PayPaySecHistoryRecord[] => {
  const root = parse(html)
  let recordIndex = 0
  return root.querySelectorAll('table').flatMap((table) => {
    const headers = headersFor(table)
    return table.querySelectorAll('tr').flatMap((row) => {
      const values = row.querySelectorAll('td').map(text)
      if (values.length === 0) return []
      if (
        values.includes('銘柄') &&
        values.some((value) => /日時|注文日/.test(value)) &&
        values.some((value) => /金額|代金/.test(value))
      ) {
        return []
      }
      const cells = Object.fromEntries(
        values.map((value, index) => [headers[index] ?? `column-${index + 1}`, value]),
      )
      const joined = values.join(' ')
      const brandId =
        row.getAttribute('data-brand-id') ??
        brandIdFrom(row.querySelector('a')?.getAttribute('href'))
      const side = /売却|売り/.test(joined) ? 'sell' : /購入|買い/.test(joined) ? 'buy' : undefined
      const entry = (pattern: RegExp) =>
        Object.entries(cells).find(([header]) => pattern.test(header))?.[1]
      const occurredAt =
        entry(/日|日時/) ?? values.find((value) => /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(value))
      const amount = decimal(entry(/金額|受渡|代金/))
      const quantity = decimal(entry(/数量|株数/))
      const instrumentName = entry(/銘柄|商品/)
      const status = entry(/状態|ステータス/)
      const id = row.getAttribute('data-order-id') ?? `${kind}:${recordIndex++}`
      return [
        {
          id,
          kind,
          cells,
          ...(occurredAt ? { occurredAt } : {}),
          ...(brandId ? { brandId } : {}),
          ...(instrumentName ? { instrumentName } : {}),
          ...(side ? { side } : {}),
          ...(amount ? { amount } : {}),
          ...(quantity ? { quantity } : {}),
          ...(status ? { status } : {}),
        },
      ]
    })
  })
}

export interface PayPaySecSettlementPage {
  records: PayPaySecHistoryRecord[]
  hasNext: boolean
}

const responseRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayPaySecError(
      `PayPay Securities settlement history did not include ${name}`,
      'INVALID_RESPONSE',
    )
  }
  return value as Record<string, unknown>
}

const responseString = (value: unknown) => {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export const parseSettlementPage = (value: unknown): PayPaySecSettlementPage => {
  const page = responseRecord(value, 'a response object')
  if (page.STATUS !== true) {
    throw new PayPaySecError(
      'PayPay Securities settlement history returned an unsuccessful status',
      'API_ERROR',
    )
  }
  if (!Array.isArray(page.CO_TRADE_HIST)) {
    throw new PayPaySecError(
      'PayPay Securities settlement history did not include CO_TRADE_HIST',
      'INVALID_RESPONSE',
    )
  }
  const nextFlag = Number(page.NEXT_FLG)
  if (nextFlag !== 0 && nextFlag !== 1) {
    throw new PayPaySecError(
      'PayPay Securities settlement history did not include a valid NEXT_FLG',
      'INVALID_RESPONSE',
    )
  }

  const result = page.CO_TRADE_HIST.map((item, index): PayPaySecHistoryRecord => {
    const row = responseRecord(item, `CO_TRADE_HIST[${index}]`)
    const summaryType = responseString(row.SUMMARY_TYPE)
    const orderUuid = responseString(row.ORDER_UUID)
    const sequence = responseString(row.SEQ_NO)
    if (!orderUuid && !sequence) {
      throw new PayPaySecError(
        `PayPay Securities settlement history row ${index + 1} did not include an identifier`,
        'INVALID_RESPONSE',
      )
    }
    const brandId = responseString(row.BRAND_ID)
    const instrumentName = responseString(row.OLD_BRAND_NM) ?? responseString(row.BRAND_NM)
    const occurredAt = responseString(row.TRADE_D) ?? responseString(row.BASE_D)
    const amount = decimal(responseString(row.AMOUNT))
    const quantity = decimal(responseString(row.QTY))
    const price = decimal(responseString(row.PRICE))
    const accountTypeValue = Number(row.ACCOUNT_TYPE)
    const accountType = [1, 2, 3, 4].includes(accountTypeValue)
      ? (accountTypeValue as PayPaySecAccountType)
      : undefined
    const side = summaryType === '1' ? 'buy' : summaryType === '2' ? 'sell' : undefined
    const id =
      orderUuid ??
      ['settlement', sequence, responseString(row.CLIENT_SEQ_NO), occurredAt, summaryType, brandId]
        .filter(Boolean)
        .join(':')
    const cells = Object.fromEntries(
      [
        ['取引日', occurredAt],
        ['銘柄', instrumentName],
        ['摘要', summaryType],
        ['口座区分', accountType ? String(accountType) : undefined],
        ['金額', amount],
        ['株数', quantity],
        ['株価', price],
      ].flatMap(([key, cellValue]) => (cellValue === undefined ? [] : [[key, cellValue]])),
    )

    return {
      id,
      kind: 'settlement',
      cells,
      ...(occurredAt ? { occurredAt } : {}),
      ...(brandId ? { brandId } : {}),
      ...(instrumentName ? { instrumentName } : {}),
      ...(side ? { side } : {}),
      ...(amount ? { amount } : {}),
      ...(quantity ? { quantity } : {}),
      ...(price ? { price } : {}),
      ...(accountType ? { accountType } : {}),
      ...(summaryType ? { summaryType } : {}),
      ...(side ? { status: '約定' } : {}),
    }
  })

  return { records: result, hasNext: nextFlag === 1 }
}
