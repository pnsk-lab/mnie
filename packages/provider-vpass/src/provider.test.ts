import { describe, expect, it } from 'vitest'
import { VpassClient, type FetchLike } from './client'
import { VpassProfile, type VpassSession } from './profile'
import { createProvider } from './provider'

const session: VpassSession = {
  apiBaseURL: 'https://api.example.test',
  webBaseURL: 'https://web.example.test',
  appVersion: '5.13.0',
  endpoint: 'Fauth',
  push: false,
  deviceId: '8e15abae-2918-4237-84f5-11c456415883',
  deviceToken: '',
  cardCompanyCode: '001',
  idKind: 'vpass',
  cardCode: 'CARD1',
  cookies: {},
}

const ok = (content: unknown) => ({
  header: { resultCode: '0', loginFlg: true },
  body: { content },
})

const meisai = (period: string, rows: Record<string, string>[]) =>
  ok({
    CustomizedMeisaiAnsDisplayServiceBean: {
      seikyuYM: period,
      cardName: 'Test Gold',
      seikyuYMList: [{ value: '' }, { value: '202601' }, { value: '202512' }],
      meisaiList: rows,
    },
  })

/** Serves canned member-site responses, keyed by the `p01` period in the body. */
const stubFetch = (byPeriod: Record<string, unknown>, calls: string[] = []) => {
  const handler: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    const body = JSON.parse(String(init?.body ?? '{}'))
    const period = body?.body?.content?.p01 ?? 'default'
    if (url.pathname.endsWith('/web_meisai/web_meisai_top/v1')) {
      calls.push(period)
      const payload = byPeriod[period] ?? byPeriod.default
      if (!payload) throw new Error(`no stub for period ${period}`)
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    if (url.pathname.endsWith('/multicard/get_multicard_data/v1')) {
      return new Response(
        JSON.stringify(
          ok({
            MulticardInformationResponseServiceBean: {
              cardInfo: [
                {
                  globalId: 'GID1',
                  cardIdentifyKey: 'CARD1',
                  cardName: 'Test Gold',
                  cardCompanyCode: '001',
                  fpanSuffix: '1125',
                },
              ],
            },
          }),
        ),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify(ok({})), { status: 200 })
  }
  return { handler, calls }
}

const providerWith = (byPeriod: Record<string, unknown>, calls: string[] = []) => {
  const { handler } = stubFetch(byPeriod, calls)
  const client = new VpassClient({ ...session, fetch: handler })
  return createProvider(new VpassProfile(client, session))
}

describe('accounts.list', () => {
  it('maps a card to an account with a masked number', async () => {
    const provider = providerWith({ default: meisai('202601', []) })
    const { items } = await provider.invoke('accounts.list', {})
    expect(items).toEqual([
      {
        id: 'CARD1',
        providerId: 'vpass',
        kind: 'credit-card',
        name: 'Test Gold',
        maskedNumber: '****1125',
      },
    ])
  })
})

describe('transactions.list', () => {
  const rows = [
    { riyouDate: '25/12/30', kmName: 'Shop A', riyouKin: '1,386', shiharaiDate: '26/01' },
    { riyouDate: '26/01/02', kmName: 'Shop B', riyouKin: '-500', shiharaiDate: '26/01' },
    // Statements carry spacer and subtotal rows with no usage date.
    { riyouDate: '', kmName: 'subtotal', riyouKin: '', shiharaiDate: '' },
  ]

  it('parses amounts, dates and direction', async () => {
    const provider = providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', {
      from: '2025-12-01',
      to: '2026-01-31',
    })

    expect(items).toHaveLength(2)
    // Newest first.
    expect(items[0]!).toMatchObject({
      occurredAt: '2026-01-02',
      description: 'Shop B',
      kind: 'deposit',
      direction: 'credit',
    })
    expect(items[0]!.amount).toMatchObject({ money: { currency: 'JPY', value: '500' } })
    expect(items[1]!).toMatchObject({
      occurredAt: '2025-12-30',
      description: 'Shop A',
      kind: 'withdrawal',
      direction: 'debit',
    })
    // A thousands separator must not truncate the value.
    expect(items[1]!.amount).toMatchObject({ money: { value: '1386' } })
  })

  it('does not emit a charge twice when two periods report it', async () => {
    // Asking for a period the site does not recognise makes it answer with the
    // default statement, so the same rows can arrive under two period codes.
    const provider = providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', {
      from: '2025-12-01',
      to: '2026-01-31',
    })
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    expect(items).toHaveLength(2)
  })

  it('reaches back across a year boundary', async () => {
    // 202601 widened by a month is 202512, not 202600 — the December statement
    // has to stay in range.
    const calls: string[] = []
    const provider = providerWith({ default: meisai('202601', rows) }, calls)
    await provider.invoke('transactions.list', { from: '2026-01-01', to: '2026-01-31' })
    expect(calls).toContain('202512')
  })

  it('filters on usage date, not billing period', async () => {
    const provider = providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', {
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(items.map((item) => item.occurredAt)).toEqual(['2026-01-02'])
  })

  it('returns nothing for a different account', async () => {
    const provider = providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', { accountId: 'OTHER' })
    expect(items).toEqual([])
  })
})

describe('history.list', () => {
  it('rejects kinds it cannot serve', async () => {
    const provider = providerWith({ default: meisai('202601', []) })
    await expect(provider.invoke('history.list', { kinds: ['valuation'] })).rejects.toThrow(
      /transaction history only/,
    )
  })
})

describe('createProvider', () => {
  it('refuses an operation it does not implement', async () => {
    const provider = providerWith({ default: meisai('202601', []) })
    await expect(provider.invoke('balances.list' as never, {})).rejects.toThrow(/unsupported/)
  })

  it('fingerprints on fields that survive re-billing', () => {
    const policy = providerWith({ default: meisai('202601', []) }).transactionObservationPolicy
    expect(policy?.identity.kind).toBe('ordered-snapshot')
  })
})
