import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import type { SbiSession } from '../types'
import { SbiServerError } from './error-map'
import { createMethodsFromSession } from './index'

const session = (): SbiSession =>
  ({
    mtsBaseUrl: 'https://example.test',
    profile: {
      session: {
        sessionId: 'TESTSESSIONID000000000000001',
        loginType: 'passkey',
        resultCode: '000000',
      },
    },
  }) as unknown as SbiSession

const pad = (value: string, width: number, align: 'left' | 'right' = 'left') =>
  align === 'right' ? value.padStart(width, ' ') : value.padEnd(width, ' ')

const mtsHeader = (trCode: string, resultCode = '000000') =>
  pad('', 6) +
  pad('TESTSESSIONID000000000000001', 28) +
  pad(trCode, 5) +
  pad('', 6) +
  pad(resultCode, 6) +
  pad('', 1) +
  pad('153000000', 9) +
  pad('', 5) +
  pad('', 4)

interface RawTickRow {
  seq: string
  time: string
  price: string
  volume: string
}

const f1802Body = (stockCode: string, mtsMarket: string, rows: RawTickRow[]) =>
  mtsHeader('F1802') +
  pad(stockCode, 5) +
  pad(mtsMarket, 3) +
  String(rows.length).padStart(4, '0') +
  rows
    .map(
      (row) =>
        pad(row.seq, 8) +
        pad(row.time, 4) +
        pad(row.price, 11, 'right') +
        ' ' +
        pad(row.volume, 11, 'right'),
    )
    .join('') +
  '\n'

const sequenceRows = (startSeq: number, count: number): RawTickRow[] =>
  Array.from({ length: count }, (_, index) => ({
    seq: String(startSeq - index).padStart(8, '0'),
    time: '1520',
    price: '3400',
    volume: '100',
  }))

const stubMtsFetch = (responses: string[]) => {
  const bodies: URLSearchParams[] = []
  let index = 0
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    bodies.push(new URLSearchParams(String(init?.body ?? '')))
    const payload = responses[Math.min(index++, responses.length - 1)] ?? mtsHeader('F1802')
    return new Response(Buffer.from(payload, 'ascii'), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, bodies }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SBI domestic market.issue.ticks (F1802)', () => {
  test('encodes TRIN and parses newest-first ticks as an IncrementalPage including decimal prices', async () => {
    const { bodies } = stubMtsFetch([
      f1802Body('9432', 'TKY', [
        { seq: '00015507', time: '1530', price: '168', volume: '41719700' },
        { seq: '00015506', time: '1524', price: '168.5', volume: '100' },
      ]),
    ])
    const methods = createMethodsFromSession(session())

    const result = await methods.market.issue.ticks({ issueCode: '9432', market: 'XTKS' })

    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.get('TRCODE')).toBe('F1802')
    expect(bodies[0]?.get('TRIN')).toBe('9432 TKY        D')
    expect(result).toEqual({
      issue: { code: '9432', market: 'XTKS' },
      latestCursor: 'after:00015507',
      items: [
        {
          sequenceNumber: '00015507',
          time: '15:30',
          price: { value: 168, text: '168', currency: 'JPY' },
          volume: 41719700,
        },
        {
          sequenceNumber: '00015506',
          time: '15:24',
          price: { value: 168.5, text: '168.5', currency: 'JPY' },
          volume: 100,
        },
      ],
    })
    expect(result.nextCursor).toBeUndefined()
  })

  test('paginates backward with nextCursor -> cursor using direction flag A until opening tick', async () => {
    const { bodies } = stubMtsFetch([
      f1802Body('7203', 'TKY', sequenceRows(999, 500)),
      f1802Body('7203', 'TKY', sequenceRows(499, 500)),
    ])
    const methods = createMethodsFromSession(session())

    const firstPage = await methods.market.issue.ticks({ issueCode: '7203', market: 'XTKS' })
    expect(firstPage.items).toHaveLength(500)
    expect(firstPage.latestCursor).toBe('after:00000999')
    expect(firstPage.nextCursor).toBe('before:00000500')

    const secondPage = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      cursor: firstPage.nextCursor,
    })
    expect(bodies.map((body) => body.get('TRIN'))).toEqual([
      '7203 TKY        D',
      '7203 TKY00000500A',
    ])
    expect(secondPage.items).toHaveLength(500)
    expect(secondPage.items[0]?.sequenceNumber).toBe('00000499')
    expect(secondPage.items[499]?.sequenceNumber).toBe('00000000')
    expect(secondPage.nextCursor).toBeUndefined()
  })

  test('respects limit and sets nextCursor at the truncated page boundary', async () => {
    const { bodies } = stubMtsFetch([
      f1802Body('7203', 'TKY', [
        { seq: '00014282', time: '1530', price: '3406', volume: '5195800' },
        { seq: '00014281', time: '1524', price: '3421', volume: '600' },
        { seq: '00014280', time: '1524', price: '3420', volume: '300' },
      ]),
      f1802Body('7203', 'TKY', [{ seq: '00014280', time: '1524', price: '3420', volume: '300' }]),
    ])
    const methods = createMethodsFromSession(session())

    const page1 = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      limit: 2,
    })
    expect(page1.items.map((item) => item.sequenceNumber)).toEqual(['00014282', '00014281'])
    expect(page1.nextCursor).toBe('before:00014281')
    expect(page1.latestCursor).toBe('after:00014282')

    const page2 = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      cursor: page1.nextCursor,
      limit: 2,
    })
    expect(bodies[1]?.get('TRIN')).toBe('7203 TKY00014281A')
    expect(page2.items.map((item) => item.sequenceNumber)).toEqual(['00014280'])
    expect(page2.nextCursor).toBeUndefined()
  })

  test('supports forward incremental fetches via afterCursor and distinguishes contiguous vs gapped 500-item batches', async () => {
    const { bodies } = stubMtsFetch([
      f1802Body('7203', 'TKY', []),
      f1802Body('7203', 'TKY', sequenceRows(1500, 500)),
      f1802Body('7203', 'TKY', sequenceRows(1500, 500)),
    ])
    const methods = createMethodsFromSession(session())

    const empty = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      afterCursor: 'after:00014282',
    })
    expect(bodies[0]?.get('TRIN')).toBe('7203 TKY00014282D')
    expect(empty).toEqual({
      issue: { code: '7203', market: 'XTKS' },
      items: [],
    })

    const contiguous = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      afterCursor: 'after:00001000',
    })
    expect(contiguous.items).toHaveLength(500)
    expect(contiguous.latestCursor).toBe('after:00001500')
    expect(contiguous.nextCursor).toBeUndefined()

    const gapped = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      afterCursor: 'after:00000500',
    })
    expect(gapped.items).toHaveLength(500)
    expect(gapped.latestCursor).toBe('after:00001500')
    expect(gapped.nextCursor).toBe('before:00001001')
  })

  test('rejects invalid markets, mixed/malformed cursors, and invalid limit', async () => {
    const methods = createMethodsFromSession(session())

    await expect(methods.market.issue.ticks({ issueCode: 'AAPL', market: 'XNAS' })).rejects.toThrow(
      'market.issue.ticks is not implemented for US stock markets',
    )

    await expect(methods.market.issue.ticks({ issueCode: '7203', market: 'STK' })).rejects.toThrow(
      'market.issue.ticks does not support domestic market: STK',
    )

    await expect(
      methods.market.issue.ticks({
        issueCode: '7203',
        market: 'XTKS',
        cursor: 'before:00014280',
        afterCursor: 'after:00014282',
      }),
    ).rejects.toThrow('cursor and afterCursor cannot be used together')

    await expect(
      methods.market.issue.ticks({
        issueCode: '7203',
        market: 'XTKS',
        cursor: 'after:00014282',
      }),
    ).rejects.toThrow('cursor expects a nextCursor token; pass latestCursor to afterCursor instead')

    await expect(
      methods.market.issue.ticks({
        issueCode: '7203',
        market: 'XTKS',
        afterCursor: 'before:00014282',
      }),
    ).rejects.toThrow('afterCursor expects a latestCursor token; pass nextCursor to cursor instead')

    await expect(
      methods.market.issue.ticks({
        issueCode: '7203',
        market: 'XTKS',
        cursor: 'raw-invalid',
      }),
    ).rejects.toThrow('cursor must be a valid tick cursor')

    await expect(
      methods.market.issue.ticks({
        issueCode: '7203',
        market: 'XTKS',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer')
  })

  test('throws SbiServerError when MTS returns a non-zero header result code', async () => {
    stubMtsFetch([mtsHeader('F1802', 'E_0001')])
    const methods = createMethodsFromSession(session())

    await expect(
      methods.market.issue.ticks({ issueCode: '7203', market: 'XTKS' }),
    ).rejects.toBeInstanceOf(SbiServerError)
  })

  test('pollTicks advances afterCursor from latestCursor and preserves cursor across empty polls', async () => {
    const { bodies } = stubMtsFetch([
      f1802Body('7203', 'TKY', [{ seq: '00014280', time: '1524', price: '3420', volume: '300' }]),
      f1802Body('7203', 'TKY', []),
      f1802Body('7203', 'TKY', [{ seq: '00014281', time: '1524', price: '3421', volume: '600' }]),
    ])
    const methods = createMethodsFromSession(session())
    const controller = new AbortController()
    const batches = []

    const iterator = methods.market.issue.pollTicks({
      issueCode: '7203',
      market: 'XTKS',
      intervalSeconds: 0.001,
      signal: controller.signal,
    })

    for await (const batch of iterator) {
      batches.push(batch)
      if (batches.length === 3) {
        controller.abort()
        break
      }
    }

    expect(bodies.map((body) => body.get('TRIN'))).toEqual([
      '7203 TKY        D',
      '7203 TKY00014280D',
      '7203 TKY00014280D',
    ])
    expect(batches.map((batch) => batch.latestCursor)).toEqual([
      'after:00014280',
      undefined,
      'after:00014281',
    ])
  })
})
