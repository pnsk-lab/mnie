export interface MobileSuicaCaptcha {
  /** Raw CAPTCHA image bytes. */
  image: Uint8Array
  contentType: string
}

export interface MobileSuicaLoginOptions {
  /** Mobile Suica account email. Defaults to `MOBILE_SUICA_USER`. */
  user?: string
  /** Mobile Suica password. Defaults to `MOBILE_SUICA_PASS`. */
  password?: string
  /** Mobile Suica web origin. Paths, queries, and fragments are not accepted. */
  baseURL: string | URL
  /** Displays the CAPTCHA to the account holder and returns its answer. */
  onCaptcha: (captcha: MobileSuicaCaptcha) => string | Promise<string>
}

interface ParsedHistoryTableRowBase {
  id: string
  date: string
  typeFrom: string
  placeFrom: string
  typeTo: string
  placeTo: string
  balanceText: string
  amountText: string
  amount: number | null
  balance: number | null
}

interface ParsedHistoryTableRowRail extends ParsedHistoryTableRowBase {
  kind: 'rail'
  typeFrom: '入' | '＊入'
  typeTo: '出'
}

interface ParsedHistoryTableRowCharge extends ParsedHistoryTableRowBase {
  kind: 'charge'
  typeFrom: 'ｶｰﾄﾞ'
  placeFrom: 'ﾓﾊﾞｲﾙ'
}

interface ParsedHistoryTableRowPayment extends ParsedHistoryTableRowBase {
  kind: 'payment'
  typeFrom: '物販'
}

interface ParsedHistoryTableRowBus extends ParsedHistoryTableRowBase {
  kind: 'bus'
  typeFrom: 'ﾊﾞｽ等'
}

interface ParsedHistoryTableRowCarryover extends ParsedHistoryTableRowBase {
  kind: 'carryover'
  typeFrom: '繰'
}

interface ParsedHistoryTableRowOther extends ParsedHistoryTableRowBase {
  kind: 'other'
}

type ParsedHistoryTableRow =
  | ParsedHistoryTableRowRail
  | ParsedHistoryTableRowCharge
  | ParsedHistoryTableRowPayment
  | ParsedHistoryTableRowBus
  | ParsedHistoryTableRowCarryover
  | ParsedHistoryTableRowOther

export interface MobileSuicaProfile {
  readonly baseURL: string
  readonly session: { export(): MobileSuicaSession }
  logout(): Promise<void>
}

const historyReaders = new WeakMap<MobileSuicaProfile, () => Promise<ParsedHistoryTableRow[]>>()

class MobileSuicaCaptchaRequiredError extends Error {}

/** Converts an authenticated Mobile Suica session to the provider-neutral API. */
export const createProvider = (
  profile: MobileSuicaProfile,
): FinancialProvider<CommonOperations> => {
  const account: Account = {
    id: 'mobile-suica',
    providerId: 'mobile-suica',
    kind: 'transit-card',
    name: 'Mobile Suica',
  }
  return {
    descriptor: { id: 'mobile-suica', name: 'Mobile Suica' },
    accountId: account.id,
    capabilities: () => ['accounts:read', 'transactions:read', 'transit-cards:read'],
    operations: () => ['accounts.list', 'transactions.list', 'history.list'],
    checkAvailability: async () => {
      try {
        const readHistory = historyReaders.get(profile)
        if (!readHistory) {
          return {
            ok: false,
            message: 'Mobile Suica profile does not have a transaction reader',
            reason: 'UNKNOWN',
          }
        }
        await readHistory()
        return { ok: true }
      } catch (cause) {
        return {
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
          reason: cause instanceof MobileSuicaCaptchaRequiredError ? 'CAPTCHA_REQIRED' : 'UNKNOWN',
        }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return { items: [account] } as Page<Account> as never
      if (name === 'transactions.list') {
        const readHistory = historyReaders.get(profile)
        if (!readHistory) throw new Error('Mobile Suica profile does not have a transaction reader')
        const items = (await readHistory()).map((row) => transactionFromHistoryRow(account.id, row))
        return { items } as Page<Transaction> as never
      }
      if (name === 'history.list') {
        const input = request as HistoryListRequest
        if (input.kinds?.some((kind) => kind !== 'transaction')) {
          throw new Error('Mobile Suica history.list supports transaction history only')
        }
        const transactions = (await createProvider(profile).invoke('transactions.list', input))
          .items
        return {
          items: transactions.map((transaction) => ({
            kind: 'transaction' as const,
            occurredAt: transaction.occurredAt,
            transaction,
          })),
        } as Page<HistoryItem> as never
      }
      throw new Error(`unsupported Mobile Suica operation: ${name}`)
    },
    exportSession: () => profile.session.export(),
    close: () => profile.logout(),
  }
}

export interface MobileSuicaSession {
  baseURL: string
  user: string
  password: string
  cookies: Record<string, string>
  historyURL: string
}

interface LoginPage {
  url: URL
  formAction: string
  fields: Record<string, string>
  captchaUrl: URL
}

const browserHeaders = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'ja;q=0.6',
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'sec-gpc': '1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

/** Normalizes and validates an origin-only Mobile Suica URL. */
export const normalizeMobileSuicaOrigin = (baseURL: string | URL): string => {
  const url = new URL(baseURL)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[]
    }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const separator = pair.indexOf('=')
      if (separator > 0) this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  export() {
    return Object.fromEntries(this.#cookies)
  }

  import(cookies: Record<string, string>) {
    this.#cookies = new Map(Object.entries(cookies))
  }
}

const splitSetCookie = (header: string | null) =>
  header ? header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()) : []

const fetchWithCookies = async (url: URL, init: RequestInit, jar: CookieJar) => {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(url, { ...init, headers, redirect: 'manual' })
  jar.apply(response)
  return response
}

const responseText = async (response: Response, name: string) => {
  if (!response.ok) throw new Error(`${name} failed: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  return new TextDecoder('shift_jis' as never).decode(bytes)
}

const decodeHtmlAttribute = (value: string) =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

const attribute = (tag: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  return value === undefined ? undefined : decodeHtmlAttribute(value)
}

const inputFields = (html: string) => {
  const fields: Record<string, string> = {}
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(input[0], 'name')
    if (name) fields[name] = attribute(input[0], 'value') ?? ''
  }
  return fields
}

const required = (value: string | undefined, name: string) => {
  if (value === undefined || value.length === 0) throw new Error(`response did not include ${name}`)
  return value
}

const readCredentials = (options: MobileSuicaLoginOptions) => {
  const user = options.user ?? process.env.MOBILE_SUICA_USER
  const password = options.password ?? process.env.MOBILE_SUICA_PASS
  if (!user || !password) throw new Error('user and password are required')
  return { user, password }
}

const parseLoginPage = (html: string, url: URL): LoginPage => {
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find((match) =>
    /\bname=["']MailAddress["']/i.test(match[2] ?? ''),
  )
  if (!form) throw new Error('login page did not include the Mobile Suica login form')
  const formAction = required(attribute(form[1] ?? '', 'action'), 'login form action')
  const captchaTag = [...(form[2] ?? '').matchAll(/<img\b[^>]*>/gi)].find((match) =>
    /captcha/i.test(attribute(match[0], 'src') ?? ''),
  )?.[0]
  const captchaSrc = captchaTag ? attribute(captchaTag, 'src') : undefined
  if (!captchaSrc) throw new Error('login page did not include a CAPTCHA image')
  return {
    url,
    formAction,
    fields: inputFields(form[2] ?? ''),
    captchaUrl: new URL(captchaSrc, url),
  }
}

// The login form uses Infragistics controls. Their client-side submit handler
// serializes both hidden state values; the server rejects a plain CAPTCHA value
// (or an empty WebCaptcha1_clientState) and simply re-renders LoginForm.aspx.
const captchaEditorState = (answer: string) =>
  `|0|01${answer}||[[[[]],[],[]],[{},[]],"01${answer}"]`

const captchaState = '[[[[null]],[],[]],[{},[]],null]'

const loginError = (html: string) => {
  const element =
    /<(?:[^>]+\s)?(?:id=["']captchaError["']|class=["'][^"']*contentsBox[^"']*["'])[^>]*>([\s\S]*?)<\//i.exec(
      html,
    )
  return element ? textContent(element[1] ?? '') : undefined
}

const usageHistoryUrl = (html: string, baseURL: string) => {
  const link = /\bid=["']btn_sfHistory["'][\s\S]*?<a\b[^>]*\bhref="([^"]+)"/i.exec(html)?.[1]
  if (!link) throw new Error('login response did not include the SF usage-history link')
  const target = new URL(
    link
      .replace(/^javascript:StartApplication\(['"]?/, '')
      .replace(/['"]?\)$/, '')
      .replace(/&amp;/g, '&'),
    baseURL,
  )
  const url = new URL('/iq/ir/SuicaDisp.aspx', baseURL)
  const returnId = target.searchParams.get('returnId')
  if (!returnId) throw new Error('SF usage-history link did not include returnId')
  url.searchParams.set('returnId', returnId)
  return url
}

const parseAmount = (value: string) => {
  // The yen sign on the Shift_JIS usage-history page decodes as a backslash
  // with WHATWG-compatible decoders (including Bun's TextDecoder).
  const normalized = value.replace(/[￥¥\\円,\s]/g, '')
  if (!normalized || normalized === '-') return null
  if (!/^[+-]?\d+$/.test(normalized)) return null
  return Number(normalized)
}

const textContent = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

const tableRows = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...(row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      textContent(cell[1] ?? ''),
    ),
  )

const normalizeHistoryDates = (records: ParsedHistoryTableRow[], now = new Date()) => {
  let inferredYear = now.getFullYear()
  let previousTime = Number.POSITIVE_INFINITY
  return records.map((record) => {
    const match = record.date.trim().match(/^(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?$/)
    if (!match) throw new Error(`unsupported Mobile Suica history date: ${record.date}`)
    const explicitYear = match[1] ? Number(match[1]) : undefined
    const month = Number(match[2])
    const day = Number(match[3])
    let year = explicitYear ?? inferredYear
    let time = Date.UTC(year, month - 1, day)
    if (new Date(time).getUTCMonth() !== month - 1 || new Date(time).getUTCDate() !== day) {
      throw new Error(`invalid Mobile Suica history date: ${record.date}`)
    }
    if (!explicitYear) {
      const tomorrow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      while (time > Math.min(previousTime, tomorrow)) {
        year -= 1
        time = Date.UTC(year, month - 1, day)
      }
      inferredYear = year
    }
    previousTime = time
    const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+09:00`
    return { ...record, date: isoDate }
  })
}

const parseMobileSuicaUsageHistory = (html: string): ParsedHistoryTableRow[] => {
  const records: ParsedHistoryTableRow[] = []
  for (const cells of tableRows(html)) {
    // The first cell is the print-selection checkbox. The 100 history rows in
    // the observed page have eight cells, with the date in the second cell.
    if (cells.length < 8 || !/\d{4}|\d{1,2}[/.月]/.test(cells[1] ?? '')) continue
    const row: ParsedHistoryTableRowBase = {
      id: `${cells[1] ?? ''}:${records.length}`,
      date: cells[1] ?? '',
      typeFrom: cells[2] ?? '',
      placeFrom: cells[3] ?? '',
      typeTo: cells[4] ?? '',
      placeTo: cells[5] ?? '',
      balanceText: cells[6] ?? '',
      amountText: cells[7] ?? '',
      balance: parseAmount(cells[6] ?? ''),
      amount: parseAmount(cells[7] ?? ''),
    }
    if ((row.typeFrom === '入' || row.typeFrom === '＊入') && row.typeTo === '出') {
      records.push({ ...row, kind: 'rail', typeFrom: row.typeFrom, typeTo: '出' })
    } else if (row.typeFrom === 'ｶｰﾄﾞ' && row.placeFrom === 'ﾓﾊﾞｲﾙ') {
      records.push({ ...row, kind: 'charge', typeFrom: 'ｶｰﾄﾞ', placeFrom: 'ﾓﾊﾞｲﾙ' })
    } else if (row.typeFrom === '物販') {
      records.push({ ...row, kind: 'payment', typeFrom: '物販' })
    } else if (row.typeFrom === 'ﾊﾞｽ等') {
      records.push({ ...row, kind: 'bus', typeFrom: 'ﾊﾞｽ等' })
    } else if (row.typeFrom === '繰') {
      records.push({ ...row, kind: 'carryover', typeFrom: '繰' })
    } else {
      records.push({ ...row, kind: 'other' })
    }
  }
  if (records.length === 0) {
    const hasLoginButton = [...html.matchAll(/class=["']([^"']*)["']/gi)].some((match) => {
      const classes = (match[1] ?? '').split(/\s+/)
      return classes.includes('loginBtn') && classes.includes('ButtonBox')
    })
    if (hasLoginButton) throw new MobileSuicaCaptchaRequiredError('logged out, CAPTCHA is needed')
    throw new Error('usage history page did not include any usage rows')
  }
  return normalizeHistoryDates(records)
}

const yenAmount = (value: number | null) =>
  value === null
    ? null
    : { kind: 'money' as const, money: { currency: 'JPY', value: String(value) } }

const transactionFromHistoryRow = (accountId: string, row: ParsedHistoryTableRow): Transaction => {
  const base = {
    id: row.id,
    accountId,
    status: 'posted' as const,
    amount: yenAmount(row.amount),
    occurredAt: row.date,
    description: [row.typeFrom, row.placeFrom, row.typeTo, row.placeTo].filter(Boolean).join(' '),
    ...(row.balance === null ? {} : { balanceAfter: yenAmount(row.balance)! }),
  }
  switch (row.kind) {
    case 'rail':
      return {
        ...base,
        kind: 'transit',
        direction: 'debit',
        transit: {
          service: 'rail',
          from: row.placeFrom || undefined,
          to: row.placeTo || undefined,
        },
      }
    case 'bus':
      return {
        ...base,
        kind: 'transit',
        direction: 'debit',
        transit: { service: 'bus', from: row.placeFrom || undefined, to: row.placeTo || undefined },
      }
    case 'payment':
      return {
        ...base,
        kind: 'payment',
        direction: 'debit',
        merchant: row.placeFrom || row.placeTo || undefined,
      }
    case 'charge':
      return { ...base, kind: 'charge', direction: 'credit', charge: { method: 'card' } }
    case 'carryover':
      return { ...base, kind: 'other', direction: 'neutral' }
    case 'other':
      return { ...base, kind: 'other', direction: 'neutral' }
  }
}

const submit = async (
  url: URL,
  fields: Record<string, string>,
  jar: CookieJar,
  referer: URL,
  name: string,
) =>
  responseText(
    await fetchWithCookies(
      url,
      {
        method: 'POST',
        headers: {
          ...browserHeaders,
          'content-type': 'application/x-www-form-urlencoded',
          origin: url.origin,
          referer: referer.toString(),
        },
        body: formBody(fields),
      },
      jar,
    ),
    name,
  )

const formBody = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

export const login = async (options: MobileSuicaLoginOptions): Promise<MobileSuicaProfile> => {
  const baseURL = normalizeMobileSuicaOrigin(options.baseURL)
  const { user, password } = readCredentials(options)
  const jar = new CookieJar()
  const entryUrl = new URL('/index.aspx', baseURL)
  const loginResponse = await fetchWithCookies(
    entryUrl,
    {
      headers: {
        ...browserHeaders,
        referer: new URL('/cm/lb/SessionTimeout.html', baseURL).toString(),
      },
    },
    jar,
  )
  const loginPage = parseLoginPage(
    await responseText(loginResponse, 'login page request'),
    entryUrl,
  )
  const captchaResponse = await fetchWithCookies(
    loginPage.captchaUrl,
    {
      headers: {
        ...browserHeaders,
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
      },
    },
    jar,
  )
  if (!captchaResponse.ok)
    throw new Error(`CAPTCHA image request failed: HTTP ${captchaResponse.status}`)
  const answer = (
    await options.onCaptcha({
      image: new Uint8Array(await captchaResponse.arrayBuffer()),
      contentType: captchaResponse.headers.get('content-type') ?? 'application/octet-stream',
    })
  ).trim()
  if (!answer) throw new Error('onCaptcha must return a non-empty answer')

  const loginUrl = new URL(loginPage.formAction, loginPage.url)
  const topPage = await submit(
    loginUrl,
    {
      ...loginPage.fields,
      MailAddress: user,
      Password: password,
      WebCaptcha1__editor: answer,
      WebCaptcha1__editor_clientState: captchaEditorState(answer),
      WebCaptcha1_clientState: captchaState,
      // Preserve the form's Shift_JIS submit-label bytes exactly as emitted by
      // the working web flow. URLSearchParams encodes the percent characters.
      LOGIN: '%83%8D%83O%83C%83%93',
    },
    jar,
    loginUrl,
    'login request',
  )
  const error = loginError(topPage)
  if (error) throw new Error(`Mobile Suica login failed: ${error}`)
  const historyUrl = usageHistoryUrl(topPage, baseURL)

  return createProfile(baseURL, user, password, jar, historyUrl)
}

/** Connects to Mobile Suica and returns the provider-neutral financial interface. */
export const connect = async (
  options: MobileSuicaLoginOptions,
): Promise<FinancialProvider<CommonOperations>> => createProvider(await login(options))

const createProfile = (
  baseURL: string,
  user: string,
  password: string,
  jar: CookieJar,
  historyUrl: URL,
): MobileSuicaProfile => {
  const profile: MobileSuicaProfile = {
    baseURL,
    session: {
      export: () => ({
        baseURL,
        user,
        password,
        cookies: jar.export(),
        historyURL: historyUrl.toString(),
      }),
    },
    async logout() {
      const response = await fetchWithCookies(
        new URL('/ka/lg/LogoutComplete.aspx?logout=pc', baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            origin: baseURL,
            referer: historyUrl.toString(),
          },
        },
        jar,
      )
      if (!response.ok) throw new Error(`logout request failed: HTTP ${response.status}`)
    },
  }
  historyReaders.set(profile, async () => {
    const html = await submit(historyUrl, {}, jar, historyUrl, 'usage history request')
    return parseMobileSuicaUsageHistory(html)
  })
  return profile
}

export const exportSession = (profile: MobileSuicaProfile): MobileSuicaSession =>
  profile.session.export()

export const importSession = async (session: MobileSuicaSession): Promise<MobileSuicaProfile> => {
  const baseURL = normalizeMobileSuicaOrigin(session.baseURL)
  if (!session.user || !session.password || !session.historyURL) {
    throw new Error('Mobile Suica session is missing authentication state')
  }
  const historyUrl = new URL(session.historyURL)
  if (historyUrl.origin !== baseURL)
    throw new Error('Mobile Suica session history URL origin is invalid')
  const jar = new CookieJar()
  jar.import(session.cookies)
  return createProfile(baseURL, session.user, session.password, jar, historyUrl)
}
import type {
  Account,
  CommonOperations,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  Page,
  Transaction,
} from '@mnie/types'
