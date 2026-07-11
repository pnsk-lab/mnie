import iconv from 'iconv-lite'
import type { Account, Balance, CommonOperations, FinancialProvider, Page } from '@mnie/types'

export interface PayPayBankLoginOptions {
  /** Three-digit branch number. Defaults to `PAYPAY_BANK_BRANCH`. */
  branchNo?: string
  /** Seven-digit account number. Defaults to `PAYPAY_BANK_ACCOUNT`. */
  accountNo?: string
  /** Login password. Defaults to `PAYPAY_BANK_PASSWORD`. */
  password?: string
  /** PayPay Bank login origin. Defaults to `PAYPAY_BANK_BASE_URL`. */
  baseURL?: string | URL
}

export interface PayPayBankBalance {
  currency: 'JPY'
  amount: number
  monthlyAverage: number
  interest: number
  interestPoints: number
}

export interface PayPayBankProfile {
  readonly baseURL: string
  readonly branchNo: string
  readonly accountNo: string
  readonly session: { export(): PayPayBankSession }
  getBalance(): Promise<PayPayBankBalance>
  logout(): Promise<void>
}

/** Converts an authenticated PayPay Bank session to the provider-neutral API. */
export const createProvider = (profile: PayPayBankProfile): FinancialProvider<CommonOperations> => {
  const account: Account = {
    id: `${profile.branchNo}-${profile.accountNo}`,
    providerId: 'paypay-bank',
    kind: 'bank',
    name: 'PayPay Bank ordinary deposit',
    maskedNumber: `***${profile.accountNo.slice(-4)}`,
  }
  return {
    descriptor: { id: 'paypay-bank', name: 'PayPay Bank' },
    accountId: account.id,
    capabilities: () => ['accounts:read', 'balances:read'],
    operations: () => ['accounts.list', 'balances.list'],
    checkAvailability: async () => {
      try {
        await profile.getBalance()
        return { ok: true }
      } catch (message) {
        return { ok: false, message }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return { items: [account] } as Page<Account> as never
      if (name === 'balances.list') {
        const input = request as { accountId?: string }
        if (input.accountId && input.accountId !== account.id) return [] as never
        const value = await profile.getBalance()
        const asOf = new Date().toISOString()
        return [
          {
            accountId: account.id,
            type: 'current',
            amount: {
              kind: 'money',
              money: { currency: value.currency, value: String(value.amount) },
            },
            asOf,
          },
        ] as Balance[] as never
      }
      throw new Error(`unsupported PayPay Bank operation: ${name}`)
    },
    exportSession: () => profile.session.export(),
    close: () => profile.logout(),
  }
}

export interface PayPayBankClient {
  readonly baseURL: string
  login(options?: Omit<PayPayBankLoginOptions, 'baseURL'>): Promise<PayPayBankProfile>
  importSession(session: PayPayBankSession): Promise<PayPayBankProfile>
}

export interface PayPayBankSession {
  baseURL: string
  branchNo: string
  accountNo: string
  password: string
  cookies: Record<string, string>
  sid: string
  uid: string
}

const defaultBaseURL = 'PAYPAY_BANK_BASE_URL'

export const normalizePayPayBankOrigin = (value: string | URL): string => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
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
  return iconv.decode(Buffer.from(bytes), 'Shift_JIS')
}

const inputFields = (html: string) => {
  const fields: Record<string, string> = {}
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(input[0], 'name')
    const value = attribute(input[0], 'value')
    if (name) fields[name] = value ?? ''
  }
  return fields
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]

const required = (fields: Record<string, string>, name: string) => {
  const value = fields[name]
  if (value === undefined) throw new Error(`response did not include ${name}`)
  return value
}

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

const credentials = (options: PayPayBankLoginOptions) => {
  const branchNo = options.branchNo ?? process.env.PAYPAY_BANK_BRANCH
  const accountNo = options.accountNo ?? process.env.PAYPAY_BANK_ACCOUNT
  const password = options.password ?? process.env.PAYPAY_BANK_PASSWORD
  if (!branchNo || !accountNo || !password) {
    throw new Error('branchNo, accountNo, and password are required')
  }
  if (!/^\d{3}$/.test(branchNo)) throw new Error('branchNo must be three digits')
  if (!/^\d{7}$/.test(accountNo)) throw new Error('accountNo must be seven digits')
  if (!/^[\x20-\x7e]{1,32}$/.test(password)) {
    throw new Error('password must be 1–32 ASCII characters')
  }
  return { branchNo, accountNo, password }
}

const parseInteger = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !/^-?[\d,]+$/.test(value)) {
    throw new Error(`${name} was not an integer`)
  }
  return Number(value.replaceAll(',', ''))
}

const shiftJisForm = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, value]) => `${shiftJisComponent(name)}=${shiftJisComponent(value)}`)
    .join('&')

const shiftJisComponent = (value: string) => {
  let encoded = ''
  for (const byte of iconv.encode(value, 'Shift_JIS')) {
    if (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      [0x2a, 0x2d, 0x2e, 0x5f].includes(byte)
    ) {
      encoded += String.fromCharCode(byte)
    } else if (byte === 0x20) {
      encoded += '+'
    } else {
      encoded += `%${byte.toString(16).padStart(2, '0').toUpperCase()}`
    }
  }
  return encoded
}

interface BalanceResponse {
  ResultCode?: string
  FtZandaka?: string
  FtYokinGetsuchuHeiZan?: string
  YenFtRisokuSum?: string
  YenFtRisokuSumPoint?: string
  __sid?: string
}

const createProfile = (
  baseURL: string,
  values: ReturnType<typeof credentials>,
  jar: CookieJar,
  fields: Record<string, string>,
): PayPayBankProfile => {
  let sid = required(fields, '__sid')
  const uid = required(fields, '__uid')
  return {
    baseURL,
    branchNo: values.branchNo,
    accountNo: values.accountNo,
    session: {
      export: () => ({
        baseURL,
        branchNo: values.branchNo,
        accountNo: values.accountNo,
        password: values.password,
        cookies: jar.export(),
        sid,
        uid,
      }),
    },
    async getBalance() {
      const response = await fetchWithCookies(
        new URL('/wctx/AsyncNBG13130G12.do', baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            accept: 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            origin: baseURL,
            referer: `${baseURL}/wctx/NBCW2101.do`,
            'x-requested-with': 'XMLHttpRequest',
          },
          body: new URLSearchParams({ submitID: '000', __sid: sid, __uid: uid }),
        },
        jar,
      )
      if (!response.ok) throw new Error(`balance request failed: HTTP ${response.status}`)
      const result = (await response.json()) as BalanceResponse
      if (result.ResultCode !== '0') {
        throw new Error(`balance request failed: ResultCode ${String(result.ResultCode)}`)
      }
      if (result.__sid) sid = result.__sid
      return {
        currency: 'JPY',
        amount: parseInteger(result.FtZandaka, 'FtZandaka'),
        monthlyAverage: parseInteger(result.FtYokinGetsuchuHeiZan, 'FtYokinGetsuchuHeiZan'),
        interest: parseInteger(result.YenFtRisokuSum, 'YenFtRisokuSum'),
        interestPoints: parseInteger(result.YenFtRisokuSumPoint, 'YenFtRisokuSumPoint'),
      }
    },
    async logout() {
      const response = await fetchWithCookies(
        new URL('/wctx/NBCW2101.do', baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            'content-type': 'application/x-www-form-urlencoded',
            origin: baseURL,
            referer: `${baseURL}/wctx/NBCW2101.do`,
          },
          body: new URLSearchParams({
            __gid: 'NBG13130G12',
            __type: '0099',
            __sid: sid,
            __uid: uid,
          }),
        },
        jar,
      )
      if (!response.ok) throw new Error(`logout request failed: HTTP ${response.status}`)
    },
  }
}

export const login = async (options: PayPayBankLoginOptions = {}): Promise<PayPayBankProfile> => {
  const configuredBaseURL = options.baseURL ?? process.env[defaultBaseURL]
  if (!configuredBaseURL) throw new Error(`baseURL is required (or set ${defaultBaseURL})`)
  const baseURL = normalizePayPayBankOrigin(configuredBaseURL)
  const values = credentials(options)
  const jar = new CookieJar()

  const loginPageResponse = await fetchWithCookies(
    new URL('/wctx/LoginAction.do', baseURL),
    {
      headers: {
        ...browserHeaders,
      },
    },
    jar,
  )
  let transitionFields = inputFields(await responseText(loginPageResponse, 'login-page request'))
  Object.assign(transitionFields, {
    __type: '0001',
    __fid: 'NBG12340',
    __bid: '20',
    LoginIdFlg: '0',
    rw_screenparam_loginIdFlg: '',
  })

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchWithCookies(
      new URL('/wctx/NBCW2101.do', baseURL),
      {
        method: 'POST',
        headers: {
          ...browserHeaders,
          'content-type': 'application/x-www-form-urlencoded',
          origin: baseURL,
          referer: `${baseURL}/wctx/LoginAction.do`,
        },
        body: shiftJisForm({
          ...transitionFields,
          __uid: `${values.branchNo}${values.accountNo}`,
          userAgent: browserHeaders['user-agent'],
          rw_screenparam_button: 'login',
          TimeZone: new Date().toString(),
          TimeZoneDetect: 'Asia/Tokyo',
          ScreenWidth: '1680',
          ScreenHeight: '1050',
          ScreenColorDepth: '24',
          NavigatorPlatform: 'Linux x86_64',
          TenNo: values.branchNo,
          KozaNo: values.accountNo,
          Pw: values.password,
          login: 'ログイン',
        }),
      },
      jar,
    )
    const transitionHtml = await responseText(response, 'login request')
    transitionFields = inputFields(transitionHtml)
    if (transitionFields.__gid === 'NBG12340G13') break
    if (transitionFields.__gid !== 'NBG12340G91') {
      if (
        transitionHtml.includes('店番号、口座番号、ログインパスワードが一致しません') ||
        transitionHtml.includes('ログインパスワードを正しく入力してください')
      ) {
        throw new Error('PayPay Bank rejected the branch, account number, or login password')
      }
      const title = /<title[^>]*>([^<]*)/i.exec(transitionHtml)?.[1]?.trim()
      throw new Error(
        `unexpected login transition: ${String(transitionFields.__gid)} (${title ?? 'untitled'})`,
      )
    }
  }

  const sid = required(transitionFields, '__sid')
  const uid = required(transitionFields, '__uid')
  const gid = required(transitionFields, '__gid')
  if (gid !== 'NBG12340G13') throw new Error(`unexpected login transition: ${gid}`)

  const welcomeResponse = await fetchWithCookies(
    new URL('/wctx/NBCW2101.do', baseURL),
    {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: baseURL,
        referer: `${baseURL}/wctx/NBCW2101.do`,
      },
      body: new URLSearchParams({
        __gid: gid,
        __type: required(transitionFields, '__type'),
        __fid: required(transitionFields, '__fid'),
        B_ID: transitionFields.B_ID ?? '2',
        __sid: sid,
        __uid: uid,
        MenuSelect: transitionFields.MenuSelect ?? '1',
      }),
    },
    jar,
  )
  const welcomeHtml = await responseText(welcomeResponse, 'welcome-page request')
  const welcomeFields = inputFields(welcomeHtml)
  if (!welcomeFields.__sid || !welcomeFields.__uid) {
    throw new Error('welcome page did not include an authenticated session')
  }
  return createProfile(baseURL, values, jar, welcomeFields)
}

/** Connects to PayPay Bank and returns the provider-neutral financial interface. */
export const connect = async (
  options: PayPayBankLoginOptions = {},
): Promise<FinancialProvider<CommonOperations>> => createProvider(await login(options))

export const getBalance = ({ profile }: { profile: PayPayBankProfile }) => profile.getBalance()

export const exportSession = (profile: PayPayBankProfile): PayPayBankSession =>
  profile.session.export()

export const importSession = async (session: PayPayBankSession): Promise<PayPayBankProfile> => {
  const baseURL = normalizePayPayBankOrigin(session.baseURL)
  if (
    !/^\d{3}$/.test(session.branchNo) ||
    !/^\d{7}$/.test(session.accountNo) ||
    !session.password
  ) {
    throw new Error('PayPay Bank session contains invalid credentials')
  }
  if (!session.sid || !session.uid)
    throw new Error('PayPay Bank session is missing authenticated state')
  const jar = new CookieJar()
  jar.import(session.cookies)
  return createProfile(
    baseURL,
    { branchNo: session.branchNo, accountNo: session.accountNo, password: session.password },
    jar,
    { __sid: session.sid, __uid: session.uid },
  )
}

export const createPayPayBankClient = (options: { baseURL: string | URL }): PayPayBankClient => {
  const baseURL = normalizePayPayBankOrigin(options.baseURL)
  return {
    baseURL,
    login: (loginOptions = {}) => login({ ...loginOptions, baseURL }),
    importSession,
  }
}
