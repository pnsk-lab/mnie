import { describe, expect, it } from 'vite-plus/test'
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
  globalId: 'GID1',
  cardCode: 'AUTH_CARD_CODE',
  cookies: {},
}

const ok = (content: unknown) => ({
  header: { resultCode: '0', loginFlg: true },
  body: { content },
})

const meisai = (period: string, rows: Record<string, string>[], periods = ['202601', '202512']) =>
  ok({
    CustomizedMeisaiAnsDisplayServiceBean: {
      seikyuYM: period,
      total: rows.length,
      pageSize: 100,
      cardName: 'Test Gold',
      seikyuYMList: [{ value: '' }, ...periods.map((value) => ({ value }))],
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
      const payload =
        byPeriod[`${period}:${body.body.content.p03}`] ?? byPeriod[period] ?? byPeriod.default
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
    const provider = await providerWith({ default: meisai('202601', []) })
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
    const provider = await providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', {
      from: '2025-12-01',
      to: '2026-01-31',
    })

    expect(items).toHaveLength(2)
    // Newest first.
    expect(items[0]!).toMatchObject({
      occurredAt: '2026-01-02T00:00:00+09:00',
      description: 'Shop B',
      kind: 'deposit',
      direction: 'credit',
    })
    expect(items[0]!.amount).toMatchObject({ money: { currency: 'JPY', value: '500' } })
    expect(items[1]!).toMatchObject({
      occurredAt: '2025-12-30T00:00:00+09:00',
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
    const provider = await providerWith({ default: meisai('202601', rows) })
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
    const provider = await providerWith({ default: meisai('202601', rows) }, calls)
    await provider.invoke('transactions.list', { from: '2026-01-01', to: '2026-01-31' })
    expect(calls).toContain('202512')
  })

  it('filters on usage date, not billing period', async () => {
    const provider = await providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', {
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(items.map((item) => item.occurredAt)).toEqual(['2026-01-02T00:00:00+09:00'])
  })

  it('returns nothing for a different account', async () => {
    const provider = await providerWith({ default: meisai('202601', rows) })
    const { items } = await provider.invoke('transactions.list', { accountId: 'OTHER' })
    expect(items).toEqual([])
  })

  it('uses the listed account identifier for default-card transactions', async () => {
    const provider = await providerWith({ default: meisai('202601', rows) })
    const accounts = await provider.invoke('accounts.list', {})
    const accountId = accounts.items[0]!.id
    const unfiltered = await provider.invoke('transactions.list', {})
    const filtered = await provider.invoke('transactions.list', { accountId })

    expect(provider.accountId).toBe(accountId)
    expect(unfiltered.items).toHaveLength(2)
    expect(unfiltered.items.every((item) => item.accountId === accountId)).toBe(true)
    expect(filtered.items).toEqual(unfiltered.items)
  })

  it('reads the default statement when future buckets precede its selected period', async () => {
    const calls: string[] = []
    const provider = await providerWith(
      {
        default: ok({
          CustomizedMeisaiAnsDisplayServiceBean: {
            seikyuYM: '202608',
            total: rows.length,
            pageSize: 100,
            seikyuYMList: [{ value: '2026101' }, { value: '202609' }, { value: '202608' }],
            meisaiList: rows,
          },
        }),
        '2026101': meisai('2026101', []),
      },
      calls,
    )

    const transactions = await provider.invoke('transactions.list', {})
    expect(transactions.items).toHaveLength(2)
    expect(calls).toEqual(['default'])
    expect(transactions.items.every((item) => item.id.startsWith('202608:'))).toBe(true)

    const history = await provider.invoke('history.list', {})
    expect(history.items.map((item) => item.kind === 'transaction' && item.transaction)).toEqual(
      transactions.items,
    )
  })

  it('gives an equal-amount refund a different fingerprint from its purchase', async () => {
    const provider = await providerWith({
      default: meisai('202601', [
        { riyouDate: '26/01/02', kmName: 'Shop A', riyouKin: '500' },
        { riyouDate: '26/01/02', kmName: 'Shop A', riyouKin: '-500' },
      ]),
    })
    const { items } = await provider.invoke('transactions.list', {})
    const identity = provider.transactionObservationPolicy!.identity
    if (identity.kind !== 'ordered-snapshot') throw new Error('expected ordered-snapshot')
    expect(items).toHaveLength(2)
    expect(identity.fingerprint(items[0]!)).not.toBe(identity.fingerprint(items[1]!))
    expect(identity.fingerprint({ ...items[0]!, id: 'rebilled-row' })).toBe(
      identity.fingerprint(items[0]!),
    )
  })
})

describe.each(['transactions.list', 'history.list'] as const)('%s limits', (operation) => {
  it.each([
    { limit: undefined, dates: ['2026-01-20', '2026-01-02'] },
    { limit: 0, dates: [] },
    { limit: 1, dates: ['2026-01-20'] },
    { limit: 10, dates: ['2026-01-20', '2026-01-02'] },
  ])('applies limit $limit after filtering and sorting all periods', async ({ limit, dates }) => {
    const periods = ['202601', '202602']
    const january = meisai(
      '202601',
      [
        { riyouDate: '25/12/30', kmName: 'Too old', riyouKin: '100' },
        { riyouDate: '26/01/02', kmName: 'Older', riyouKin: '200' },
      ],
      periods,
    )
    const provider = await providerWith({
      default: january,
      '202601': january,
      '202602': meisai(
        '202602',
        [
          { riyouDate: '26/01/20', kmName: 'Newest in range', riyouKin: '300' },
          { riyouDate: '26/02/01', kmName: 'Too new', riyouKin: '400' },
        ],
        periods,
      ),
    })

    const { items } = await provider.invoke(operation, {
      accountId: provider.accountId,
      from: '2026-01-01',
      to: '2026-01-31',
      limit,
    })

    expect(items.map((item) => item.occurredAt)).toEqual(
      dates.map((date) => `${date}T00:00:00+09:00`),
    )
  })

  it('honors limits on the default statement', async () => {
    const provider = await providerWith({
      default: meisai('202601', [
        { riyouDate: '26/01/02', kmName: 'Older', riyouKin: '100' },
        { riyouDate: '26/01/20', kmName: 'Newest', riyouKin: '200' },
      ]),
    })

    expect(await provider.invoke(operation, { limit: 0 })).toEqual({ items: [] })
    const { items } = await provider.invoke(operation, { limit: 1 })
    expect(items.map((item) => item.occurredAt)).toEqual(['2026-01-20T00:00:00+09:00'])
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s before fetching statements',
    async (limit) => {
      const calls: string[] = []
      const provider = await providerWith({ default: meisai('202601', []) }, calls)

      await expect(provider.invoke(operation, { limit })).rejects.toThrow(
        /limit must be a non-negative safe integer/,
      )
      await expect(provider.invoke(operation, { accountId: 'OTHER', limit })).rejects.toThrow(
        /limit must be a non-negative safe integer/,
      )
      expect(calls).toEqual([])
    },
  )
})

describe.each(['transactions.list', 'history.list'] as const)('%s dated reads', (operation) => {
  it.each([
    { from: '2026-06-01', to: '2026-06-30', period: '202608' },
    { from: '2026-11-01', to: '2026-11-30', period: '202701' },
    { from: '2026-12-01', to: '2026-12-31', period: '2027021' },
    { from: undefined, to: '2026-06-30', period: '202608' },
  ])('includes purchases billed two months after $to ($period)', async ({ from, to, period }) => {
    const calls: string[] = []
    const usageDate = to.slice(2).replaceAll('-', '/')
    const statement = meisai(
      period,
      [
        { riyouDate: usageDate, kmName: 'In range', riyouKin: '500' },
        { riyouDate: '27/03/01', kmName: 'Outside range', riyouKin: '100' },
      ],
      [period],
    )
    const provider = await providerWith({ default: statement, [period]: statement }, calls)

    const { items } = await provider.invoke(operation, { from, to })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject(
      operation === 'history.list'
        ? { transaction: { occurredAt: `${to}T00:00:00+09:00`, description: 'In range' } }
        : { occurredAt: `${to}T00:00:00+09:00`, description: 'In range' },
    )
    expect(calls).toContain(period)
  })
})

describe('history.list', () => {
  it('returns nothing for a different account without fetching statements', async () => {
    const calls: string[] = []
    const provider = await providerWith(
      {
        default: meisai('202601', [{ riyouDate: '26/01/02', kmName: 'Shop', riyouKin: '500' }]),
      },
      calls,
    )

    expect(await provider.invoke('history.list', { accountId: 'OTHER' })).toEqual({ items: [] })
    expect(calls).toEqual([])
    const matching = await provider.invoke('history.list', { accountId: provider.accountId })
    expect(matching.items).toHaveLength(1)
    expect(matching.items[0]).toMatchObject({ transaction: { accountId: provider.accountId } })
  })

  it('rejects kinds it cannot serve', async () => {
    const provider = await providerWith({ default: meisai('202601', []) })
    await expect(provider.invoke('history.list', { kinds: ['valuation'] })).rejects.toThrow(
      /transaction history only/,
    )
  })
})

describe('statement integrity', () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    riyouDate: '26/01/02',
    kmName: `Shop ${index}`,
    riyouKin: '100',
  }))
  const page = (pageNumber: number, overrides: Record<string, unknown> = {}) =>
    ok({
      CustomizedMeisaiAnsDisplayServiceBean: {
        seikyuYM: '202601',
        total: 205,
        pageSize: 100,
        meisaiList: rows.slice((pageNumber - 1) * 100, pageNumber * 100),
        ...overrides,
      },
    })

  it.each(['transactions.list', 'history.list'] as const)(
    '%s retrieves all statement pages',
    async (operation) => {
      const calls: string[] = []
      const provider = await providerWith(
        {
          default: page(1),
          '202601:101': page(2),
          '202601:201': page(3),
        },
        calls,
      )

      const { items } = await provider.invoke(operation, {})

      expect(items).toHaveLength(205)
      expect(calls).toEqual(['default', '202601', '202601'])
      expect(items[204]).toMatchObject(
        operation === 'history.list'
          ? { transaction: { description: 'Shop 204' } }
          : { description: 'Shop 204' },
      )
    },
  )

  it.each(['transactions.list', 'history.list'] as const)(
    '%s rejects a failed subsequent page',
    async (operation) => {
      const provider = await providerWith({
        default: page(1),
        '202601:101': { header: { resultCode: '1', loginFlg: true }, body: { content: {} } },
      })
      await expect(provider.invoke(operation, {})).rejects.toThrow(/request failed/)
    },
  )

  it.each([
    { total: undefined },
    { total: -1 },
    { total: '205' },
    { pageSize: 0 },
    { pageSize: 1.5 },
    { pageSize: undefined },
  ])('rejects invalid pagination metadata %j', async (metadata) => {
    const provider = await providerWith({ default: page(1, metadata) })
    await expect(provider.invoke('transactions.list', {})).rejects.toThrow(/pagination metadata/)
  })

  it.each([
    { meisaiList: [] },
    { meisaiList: rows.slice(100, 199) },
    { total: 206 },
    { pageSize: 50 },
    { seikyuYM: '202602' },
  ])('rejects an incomplete or changed subsequent page %j', async (overrides) => {
    const provider = await providerWith({ default: page(1), '202601:101': page(2, overrides) })
    await expect(provider.invoke('history.list', {})).rejects.toThrow(
      /incomplete page|statement changed/,
    )
  })

  it.each([
    undefined,
    null,
    500,
    '',
    '   ',
    'unknown',
    '12oops34',
    '1,2',
    '--500',
    '1.2.3',
    '9007199254740993',
  ])('rejects malformed statement amount %j', async (riyouKin) => {
    const provider = await providerWith({
      default: ok({
        CustomizedMeisaiAnsDisplayServiceBean: {
          seikyuYM: '202601',
          total: 1,
          pageSize: 100,
          meisaiList: [{ riyouDate: '26/01/02', kmName: 'Shop', riyouKin }],
        },
      }),
    })

    await expect(provider.invoke('transactions.list', {})).rejects.toThrow(/unparseable amount/)
    await expect(provider.invoke('history.list', {})).rejects.toThrow(/unparseable amount/)
  })

  it('preserves genuine zero, grouped yen, refunds and spacer rows', async () => {
    const provider = await providerWith({
      default: meisai('202601', [
        { riyouDate: '26/01/02', kmName: 'Zero', riyouKin: '0' },
        { riyouDate: '26/01/02', kmName: 'Purchase', riyouKin: ' 1,234 ' },
        { riyouDate: '26/01/02', kmName: 'Refund', riyouKin: '-500' },
        { riyouDate: '', kmName: 'Subtotal', riyouKin: '' },
      ]),
    })
    const { items } = await provider.invoke('transactions.list', {})
    expect(items.map((item) => item.amount)).toEqual(
      ['0', '1234', '500'].map((value) => ({
        kind: 'money',
        money: { currency: 'JPY', value },
      })),
    )
    expect(items[2]?.direction).toBe('credit')
  })
})

describe('createProvider', () => {
  const forCards = (
    cardInfo: Record<string, string>[],
    sessionOverrides: Partial<VpassSession> = {},
  ) => {
    const client = new VpassClient({
      ...session,
      fetch: async () =>
        new Response(JSON.stringify(ok({ MulticardInformationResponseServiceBean: { cardInfo } }))),
    })
    return createProvider(new VpassProfile(client, { ...session, ...sessionOverrides }))
  }

  const authenticatedCard = {
    globalId: 'GID1',
    cardIdentifyKey: 'CARD1',
    cardCompanyCode: '001',
  }

  it('resolves the authenticated card independently of card-list order', async () => {
    const provider = await forCards([
      { ...authenticatedCard, globalId: 'GID2', cardIdentifyKey: 'CARD2' },
      { ...authenticatedCard, cardCompanyCode: '002', cardIdentifyKey: 'OTHER_ISSUER' },
      authenticatedCard,
    ])
    expect(provider.accountId).toBe('CARD1')
  })

  it('rejects missing or ambiguous authenticated cards', async () => {
    await expect(forCards([])).rejects.toThrow(/uniquely resolve/)
    await expect(forCards([authenticatedCard], { globalId: undefined })).rejects.toThrow(
      /uniquely resolve/,
    )
    await expect(forCards([authenticatedCard], { globalId: 'UNKNOWN' })).rejects.toThrow(
      /uniquely resolve/,
    )
    await expect(forCards([authenticatedCard, authenticatedCard])).rejects.toThrow(
      /uniquely resolve/,
    )
  })

  it.each([
    { globalId: 'GID1', cardCompanyCode: '001' },
    { ...authenticatedCard, cardIdentifyKey: '' },
  ])('rejects a card without a member-site identifier: %j', async (card) => {
    await expect(forCards([card])).rejects.toThrow(/cardIdentifyKey/)
  })

  it('refuses an operation it does not implement', async () => {
    const provider = await providerWith({ default: meisai('202601', []) })
    await expect(provider.invoke('balances.list' as never, {})).rejects.toThrow(/unsupported/)
  })

  it('fingerprints on fields that survive re-billing', async () => {
    const policy = (await providerWith({ default: meisai('202601', []) }))
      .transactionObservationPolicy
    expect(policy?.identity.kind).toBe('ordered-snapshot')
  })
})
