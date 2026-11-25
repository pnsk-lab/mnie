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
  test('encodes TRIN and parses newest-first ticks including decimal prices', async () => {
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
      latestSequenceNumber: '00015507',
      ticks: [
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
  })

  test('passes afterSequenceNumber for incremental fetches and handles empty tick batches', async () => {
    const { bodies } = stubMtsFetch([f1802Body('7203', 'TKY', [])])
    const methods = createMethodsFromSession(session())

    const result = await methods.market.issue.ticks({
      issueCode: '7203',
      market: 'XTKS',
      afterSequenceNumber: '00014282',
    })

    expect(bodies[0]?.get('TRIN')).toBe('7203 TKY00014282D')
    expect(result).toEqual({
      issue: { code: '7203', market: 'XTKS' },
      latestSequenceNumber: undefined,
      ticks: [],
    })
  })

  test('rejects US markets, unsupported domestic markets, and invalid afterSequenceNumber', async () => {
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
        afterSequenceNumber: '123456789',
      }),
    ).rejects.toThrow('afterSequenceNumber must be at most 8 non-whitespace characters')
  })

  test('throws SbiServerError when MTS returns a non-zero header result code', async () => {
    stubMtsFetch([mtsHeader('F1802', 'E_0001')])
    const methods = createMethodsFromSession(session())

    await expect(
      methods.market.issue.ticks({ issueCode: '7203', market: 'XTKS' }),
    ).rejects.toBeInstanceOf(SbiServerError)
  })

  test('pollTicks advances afterSequenceNumber automatically and preserves cursor across empty polls', async () => {
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
    expect(batches.map((batch) => batch.latestSequenceNumber)).toEqual([
      '00014280',
      undefined,
      '00014281',
    ])
  })
})
