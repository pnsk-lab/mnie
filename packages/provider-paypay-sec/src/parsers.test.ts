import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  parseHistory,
  parseInstrumentDetail,
  parseInstrumentList,
  parsePositions,
  parseSettlementPage,
} from './parsers'

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

describe('PayPay Securities HTML parsers', () => {
  test('parses instrument links without converting identifiers', () => {
    expect(parseInstrumentList(fixture('instruments.html'), 'japan')).toEqual([
      {
        brandId: '101',
        imageURL: '/assets/instrument.png',
        market: 'japan',
        name: 'Example Holdings',
      },
      { brandId: '202', market: 'japan', name: 'Example ETF' },
    ])
  })

  test('parses a minimal instrument detail and rejects missing names', () => {
    expect(
      parseInstrumentDetail(
        '<h1 data-brand-name data-brand-code="EXM">Example Holdings</h1><span class="price">1,234.5000</span>',
        '101',
      ),
    ).toEqual({ brandId: '101', code: 'EXM', name: 'Example Holdings', price: '1234.5000' })
    expect(() => parseInstrumentDetail('<div></div>', '101')).toThrow('did not include a name')
  })

  test('uses the instrument name instead of the corporate page heading', () => {
    expect(
      parseInstrumentDetail(
        '<h1 class="logo">「証券」のつかない証券会社 PayPay証券株式会社</h1><div class="possession_brand"><a>Example Holdings</a></div>',
        '101',
      ),
    ).toEqual({ brandId: '101', name: 'Example Holdings' })
    expect(() =>
      parseInstrumentDetail(
        '<h1 class="logo">「証券」のつかない証券会社 PayPay証券株式会社</h1>',
        '101',
      ),
    ).toThrow('did not include a name')
  })

  test('removes the trade-detail label appended to the instrument name', () => {
    expect(
      parseInstrumentDetail(
        '<div class="possession_brand"><a>キオクシアホールディングス取引詳細</a></div>',
        '285A',
      ).name,
    ).toBe('キオクシアホールディングス')
    expect(
      parseInstrumentDetail(
        '<div class="possession_brand"><a>Example Holdings | 取引詳細</a></div>',
        '101',
      ).name,
    ).toBe('Example Holdings')
    expect(
      parseInstrumentDetail(
        '<div class="possession_brand"><a>キオクシアホールディングス ● 取引詳細</a></div>',
        '285A',
      ).name,
    ).toBe('キオクシアホールディングス')
  })

  test('preserves decimal position values as strings', () => {
    expect(parsePositions(fixture('portfolio.html'), 'japan')).toEqual([
      {
        accountType: 2,
        acquisitionAmount: '1200.0000000000',
        brandId: '101',
        country: 'japan',
        grossProfit: '50.0000000000',
        id: 'japan:101:0',
        name: 'Example Holdings',
        quantity: '1.2500000000',
        securitiesValue: '1250.0000000000',
        subClientSeqNo: '0',
      },
    ])
  })

  test('removes the leading brand marker from a position name', () => {
    expect(
      parsePositions(
        '<table><tr class="brand_normal" data-tt-id="756"><td><span class="mybrand">●キオクシアホールディングス</span></td><td>特定</td><td>￥8,314 0.1245181925株</td><td>￥10,000 -￥1,686</td></tr></table>',
        'japan',
      )[0]?.name,
    ).toBe('キオクシアホールディングス')
  })

  test('parses the observed tree-table position markup', () => {
    expect(parsePositions(fixture('portfolio-tree.html'), 'japan')).toEqual([
      {
        accountType: 2,
        acquisitionAmount: '1200.0000000000',
        brandId: '101',
        country: 'japan',
        grossProfit: '50.0000000000',
        id: 'japan:101:2',
        name: 'Example Holdings',
        quantity: '1.2500000000',
        securitiesValue: '1250.0000000000',
        subClientSeqNo: '0',
      },
    ])
  })

  test('parses the observed initial history table without pagination assumptions', () => {
    expect(parseHistory(fixture('history.html'), 'trade')).toEqual([
      {
        amount: '1000',
        brandId: '101',
        cells: {
          売買: '購入',
          注文日: '2026/07/13 12:34',
          金額: '1,000',
          銘柄: 'Example Holdings',
        },
        id: 'order-1',
        instrumentName: 'Example Holdings',
        kind: 'trade',
        occurredAt: '2026/07/13 12:34',
        side: 'buy',
      },
    ])
  })

  test('ignores a history header row made from td elements', () => {
    expect(
      parseHistory(
        '<table><tr><td>銘柄</td><td>摘要</td><td>金額</td><td>日時</td></tr></table>',
        'trade',
      ),
    ).toEqual([])
  })

  test('parses settlement JSON without losing trade values', () => {
    expect(
      parseSettlementPage({
        STATUS: true,
        NEXT_FLG: 1,
        CO_TRADE_HIST: [
          {
            ORDER_UUID: 'order-1',
            SEQ_NO: '10',
            TRADE_D: '2026-07-13',
            SUMMARY_TYPE: '1',
            BRAND_ID: '101',
            BRAND_NM: 'Example Holdings',
            ACCOUNT_TYPE: '2',
            AMOUNT: '1,000.0000000000',
            QTY: '0.5000000000',
            PRICE: '2,000.0000000000',
          },
          {
            SEQ_NO: '11',
            BASE_D: '2026-07-12',
            SUMMARY_TYPE: '54',
            AMOUNT: '110',
          },
        ],
      }),
    ).toEqual({
      hasNext: true,
      records: [
        expect.objectContaining({
          accountType: 2,
          amount: '1000.0000000000',
          brandId: '101',
          id: 'order-1',
          instrumentName: 'Example Holdings',
          occurredAt: '2026-07-13',
          price: '2000.0000000000',
          quantity: '0.5000000000',
          side: 'buy',
          status: '約定',
          summaryType: '1',
        }),
        expect.objectContaining({
          id: 'settlement:11:2026-07-12:54',
          summaryType: '54',
        }),
      ],
    })
  })

  test('rejects malformed settlement JSON', () => {
    expect(() => parseSettlementPage({ STATUS: true, NEXT_FLG: 0 })).toThrow('CO_TRADE_HIST')
    expect(() => parseSettlementPage({ STATUS: true, NEXT_FLG: 2, CO_TRADE_HIST: [] })).toThrow(
      'NEXT_FLG',
    )
    expect(() => parseSettlementPage({ STATUS: true, NEXT_FLG: 0, CO_TRADE_HIST: [{}] })).toThrow(
      'identifier',
    )
  })
})
