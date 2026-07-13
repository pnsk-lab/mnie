import iconv from 'iconv-lite'
import { parse } from 'node-html-parser'
import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  Page,
  Transaction,
} from '@mnie/types'
import { CookieJar } from './cookie-jar'

export interface PayPayBankLoginOptions {
  branchNo?: string
  accountNo?: string
  password?: string
  /** PayPay Bank login origin. It must not contain a path, query, or fragment. */
  baseURL?: string | URL
}

export interface PayPayBankBalance {
  currency: 'JPY'
  amount: number
  monthlyAverage: number
  interest: number
  interestPoints: number
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

export interface PayPayBankProfile {
  readonly baseURL: string
  readonly branchNo: string
  readonly accountNo: string
  readonly session: { export(): PayPayBankSession }
  getBalance(): Promise<PayPayBankBalance>
  getHistory(options?: { startDate?: string; endDate?: string }): Promise<PayPayBankHistoryRecord[]>
  logout(): Promise<void>
}

export interface PayPayBankHistoryRecord {
  date: string
  description: string
  direction: 'deposit' | 'withdrawal' | 'unknown'
  amount: number
  balance: number
  transactionNumber: string
  memo: string
}

export interface PayPayBankClient {
  readonly baseURL: string
  login(options?: Omit<PayPayBankLoginOptions, 'baseURL'>): Promise<PayPayBankProfile>
  importSession(session: PayPayBankSession): Promise<PayPayBankProfile>
}

const defaultBaseURL = 'PAYPAY_BANK_BASE_URL'
const loginPath = '/wctx/LoginAction.do'
const actionPath = '/wctx/NBCW2101.do'
const balancePath = '/wctx/AsyncNBG13130G12.do'
const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'user-agent': userAgent,
}

export const normalizePayPayBankOrigin = (value: string | URL): string => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

const fetchWithCookies = async (url: URL, init: RequestInit, jar: CookieJar) => {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(url, { ...init, headers, redirect: 'manual' })
  jar.apply(response)
  return response
}

const readShiftJis = async (response: Response, operation: string) => {
  if (!response.ok && (response.status < 300 || response.status >= 400)) {
    throw new Error(`${operation} failed: HTTP ${response.status}`)
  }
  return iconv.decode(Buffer.from(await response.arrayBuffer()), 'Shift_JIS')
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2]

const inputFields = (html: string) => {
  const fields: Record<string, string> = {}
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(match[0], 'name')
    if (name) fields[name] = attribute(match[0], 'value') ?? ''
  }
  return fields
}

const required = (fields: Record<string, string>, name: string) => {
  const value = fields[name]
  if (value === undefined) throw new Error(`response did not include ${name}`)
  return value
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, value]) => `${encodeShiftJis(name)}=${encodeShiftJis(value)}`)
    .join('&')

const encodeShiftJis = (value: string) => {
  let result = ''
  for (const byte of iconv.encode(value, 'Shift_JIS')) {
    if (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      [0x2a, 0x2d, 0x2e, 0x5f].includes(byte)
    )
      result += String.fromCharCode(byte)
    else if (byte === 0x20) result += '+'
    else result += `%${byte.toString(16).padStart(2, '0').toUpperCase()}`
  }
  return result
}

const credentials = (options: PayPayBankLoginOptions) => {
  const branchNo = options.branchNo ?? process.env.PAYPAY_BANK_BRANCH
  const accountNo = options.accountNo ?? process.env.PAYPAY_BANK_ACCOUNT
  const password = options.password ?? process.env.PAYPAY_BANK_PASSWORD
  if (!branchNo || !accountNo || !password)
    throw new Error('branchNo, accountNo, and password are required')
  if (!/^\d{3}$/.test(branchNo)) throw new Error('branchNo must be three digits')
  if (!/^\d{7}$/.test(accountNo)) throw new Error('accountNo must be seven digits')
  if (!/^[\x20-\x7e]{1,32}$/.test(password))
    throw new Error('password must be 1–32 ASCII characters')
  return { branchNo, accountNo, password }
}

const parseInteger = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !/^-?[\d,]+$/.test(value))
    throw new Error(`${name} was not an integer`)
  const result = Number(value.replaceAll(',', ''))
  if (!Number.isSafeInteger(result)) throw new Error(`${name} was outside the safe integer range`)
  return result
}

const parseYen = (value: string, name: string) => {
  const normalized = value.replace(/[^\d-]/g, '')
  const amount = Number.parseInt(normalized, 10)
  if (!Number.isSafeInteger(amount)) throw new Error(`${name} was not an integer`)
  return amount
}

const dateParts = (value: string, name: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`${name} must use YYYY-MM-DD`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  )
    throw new Error(`${name} is not a real date`)
  return { year: match[1]!, month: match[2]!, day: match[3]!, date }
}

const hostFormFields = (html: string) => {
  const host = parse(html).querySelector('form[name="HOST"]')
  if (!host) throw new Error('PayPay Bank history response did not include the HOST form')
  const fields: Record<string, string> = {}
  for (const input of host.querySelectorAll('input[name]')) {
    const name = input.getAttribute('name')
    if (name) fields[name] = input.getAttribute('value') ?? ''
  }
  for (const select of host.querySelectorAll('select[name]')) {
    const name = select.getAttribute('name')
    const option = select.querySelector('option[selected]') ?? select.querySelector('option')
    if (name && option) fields[name] = option.getAttribute('value') ?? option.text.trim()
  }
  return fields
}

const requiredField = (fields: Record<string, string>, name: string) => {
  const value = fields[name]
  if (value === undefined) throw new Error(`PayPay Bank history response did not include ${name}`)
  return value
}

const historyRecordsFromHtml = (html: string) => {
  const records: PayPayBankHistoryRecord[] = []
  for (const [index, element] of parse(html).querySelectorAll('.detail-list').entries()) {
    const date = element.querySelector('.detail-inner-date')?.text.trim()
    const amount = element.querySelector('.detail-inner-val')?.text
    const balance = element.querySelector('.detail-inner-balance')?.text
    const transactionNumber = element
      .querySelector('.detail-inner-no')
      ?.text.replace('取引番号：', '')
      .trim()
    const description =
      element.querySelector('[name="detailLink"]')?.text.trim() ??
      element
        .querySelector('.detail-inner-date-summary')
        ?.text.replace(date ?? '', '')
        .trim()
    if (!date || !amount || !balance || !transactionNumber || !description) {
      throw new Error(`PayPay Bank history row ${index + 1} is missing required fields`)
    }
    records.push({
      date,
      description,
      direction: element.querySelector('.mark-deposit')
        ? 'deposit'
        : element.querySelector('.mark-payment')
          ? 'withdrawal'
          : 'unknown',
      amount: parseYen(amount, `history row ${index + 1} amount`),
      balance: parseYen(balance, `history row ${index + 1} balance`),
      transactionNumber,
      memo: element.querySelector('.memoTextView')?.text.trim() ?? '',
    })
  }
  return records
}

interface AdditionalHistoryResponse {
  ResultCode: string
  meisai?: Array<{
    SosaDate: string
    SosaTime: string
    IchirenNo: string
    Memo: string
    Tekiyo: string
    OshiharaiKin: string
    OazukariKin: string
    Zandaka: string
  }>
  BgnRenNo: string
  BgnJunNo: string
  EndJunNo: string
  EndRenNo: string
  BgnDate: string
  EndDate: string
  NextClk: string
  NextLoadFlg: string
  __sid: string
}

const additionalRecord = (
  record: NonNullable<AdditionalHistoryResponse['meisai']>[number],
  index: number,
): PayPayBankHistoryRecord => {
  const withdrawal = record.OshiharaiKin !== ''
  const amount = withdrawal ? record.OshiharaiKin : record.OazukariKin
  if (!amount) throw new Error(`PayPay Bank additional history row ${index + 1} has no amount`)
  return {
    date: `${record.SosaDate} ${record.SosaTime}`,
    description: record.Tekiyo,
    direction: withdrawal ? 'withdrawal' : record.OazukariKin ? 'deposit' : 'unknown',
    amount: parseYen(amount, `additional history row ${index + 1} amount`),
    balance: parseYen(record.Zandaka, `additional history row ${index + 1} balance`),
    transactionNumber: record.IchirenNo,
    memo: record.Memo,
  }
}

const historyDateToIso = (value: string) => {
  const match =
    /^(\d{4})(?:年|\/)(\d{1,2})(?:月|\/)(\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/.exec(
      value.trim(),
    )
  if (!match) throw new Error(`unsupported PayPay Bank history date: ${value}`)
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
  const iso = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+09:00`
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime()))
    throw new Error(`invalid PayPay Bank history date: ${value}`)
  return date.toISOString()
}

interface BalanceResponse {
  ResultCode?: string
  FtZandaka?: string
  FtYokinGetsuchuHeiZan?: string
  YenFtRisokuSum?: string
  YenFtRisokuSumPoint?: string
  __sid?: string
}

const profileFrom = (
  baseURL: string,
  values: ReturnType<typeof credentials>,
  jar: CookieJar,
  sessionFields: Record<string, string>,
): PayPayBankProfile => {
  let sid = required(sessionFields, '__sid')
  const uid = required(sessionFields, '__uid')
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
        new URL(balancePath, baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            accept: 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            origin: baseURL,
            referer: new URL(actionPath, baseURL).href,
            'x-requested-with': 'XMLHttpRequest',
          },
          body: new URLSearchParams({ submitID: '000', __sid: sid, __uid: uid }),
        },
        jar,
      )
      if (!response.ok) throw new Error(`balance request failed: HTTP ${response.status}`)
      const result = (await response.json()) as BalanceResponse
      if (result.ResultCode !== '0')
        throw new Error(`balance request failed: ResultCode ${String(result.ResultCode)}`)
      if (result.__sid) sid = result.__sid
      return {
        currency: 'JPY',
        amount: parseInteger(result.FtZandaka, 'FtZandaka'),
        monthlyAverage: parseInteger(result.FtYokinGetsuchuHeiZan, 'FtYokinGetsuchuHeiZan'),
        interest: parseInteger(result.YenFtRisokuSum, 'YenFtRisokuSum'),
        interestPoints: parseInteger(result.YenFtRisokuSumPoint, 'YenFtRisokuSumPoint'),
      }
    },
    async getHistory(options = {}) {
      if ((options.startDate === undefined) !== (options.endDate === undefined)) {
        throw new Error('startDate and endDate must be provided together')
      }

      const homeResponse = await submit(
        baseURL,
        jar,
        {
          __type: '0023',
          __sid: sid,
          __gid: 'NBG13130G12',
          __fid: 'NBG23061',
          __uid: uid,
          B_ID: '1',
        },
        new URL(actionPath, baseURL).href,
      )
      let historyHTML = await readShiftJis(homeResponse, 'history-page request')

      if (options.startDate !== undefined && options.endDate !== undefined) {
        const start = dateParts(options.startDate, 'startDate')
        const end = dateParts(options.endDate, 'endDate')
        if (start.date > end.date) throw new Error('startDate must not be after endDate')
        const fields = hostFormFields(historyHTML)
        Object.assign(fields, {
          ShokaiKbn: '3',
          __type: '0023',
          __fid: 'NBG23061',
          B_ID: '2',
          ShokaiStartDateNen: start.year,
          ShokaiStartDateTsuki: start.month,
          ShokaiStartDateHi: start.day,
          ShokaiEndDateNen: end.year,
          ShokaiEndDateTsuki: end.month,
          ShokaiEndDateHi: end.day,
        })
        const response = await submit(baseURL, jar, fields, new URL(actionPath, baseURL).href)
        historyHTML = await readShiftJis(response, 'history-range request')
      }

      const fields = hostFormFields(historyHTML)
      const records = historyRecordsFromHtml(historyHTML)
      if (records.length === 0) return records
      const continuationNames = [
        'ShokaiStartDateNen',
        'ShokaiStartDateTsuki',
        'ShokaiStartDateHi',
        'ShokaiEndDateNen',
        'ShokaiEndDateTsuki',
        'ShokaiEndDateHi',
        'ChkShokaiStartDateNen',
        'ChkShokaiStartDateTsuki',
        'ChkShokaiStartDateHi',
        'ChkShokaiEndDateNen',
        'ChkShokaiEndDateTsuki',
        'ChkShokaiEndDateHi',
      ]
      if (continuationNames.some((name) => fields[name] === undefined)) return records
      const params = new URLSearchParams()
      const add = (name: string) => params.set(name, requiredField(fields, name))
      for (const name of [
        '__uid',
        '__sid',
        'ShokaiStartDateNen',
        'ShokaiStartDateTsuki',
        'ShokaiStartDateHi',
        'ShokaiEndDateNen',
        'ShokaiEndDateTsuki',
        'ShokaiEndDateHi',
        'ChkShokaiStartDateNen',
        'ChkShokaiStartDateTsuki',
        'ChkShokaiStartDateHi',
        'ChkShokaiEndDateNen',
        'ChkShokaiEndDateTsuki',
        'ChkShokaiEndDateHi',
        'BgnRenNo',
        'BgnJunNo',
        'EndJunNo',
        'EndRenNo',
        'BgnDate',
        'EndDate',
        'NextClk',
        'sortOrder',
      ])
        add(name)
      params.set('HonjitsuDate', requiredField(fields, 'HonDate'))
      // The bank's default page can contain rows while its continuation cursor
      // is not initialized. Only use the JSON continuation endpoint after an
      // explicit range request, where the range form initializes that cursor.
      if (options.startDate === undefined || records.length === 0) return records
      while (true) {
        const response = await fetchWithCookies(
          new URL('/wctx/AsyncAddListNBG23061G11.do', baseURL),
          {
            method: 'POST',
            headers: {
              ...browserHeaders,
              accept: 'application/json, text/javascript, */*; q=0.01',
              'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
              origin: baseURL,
              referer: new URL(actionPath, baseURL).href,
              'x-requested-with': 'XMLHttpRequest',
            },
            body: params,
          },
          jar,
        )
        if (!response.ok)
          throw new Error(`additional history request failed: HTTP ${response.status}`)
        const data = (await response.json()) as AdditionalHistoryResponse
        if (data.ResultCode === '9') return records
        if (data.ResultCode !== '0')
          throw new Error(`additional history request failed: ResultCode ${data.ResultCode}`)
        for (const [index, record] of (data.meisai ?? []).entries())
          records.push(additionalRecord(record, index))
        sid = data.__sid
        params.set('__sid', data.__sid)
        params.set('BgnRenNo', data.BgnRenNo)
        params.set('BgnJunNo', data.BgnJunNo)
        params.set('EndJunNo', data.EndJunNo)
        params.set('EndRenNo', data.EndRenNo)
        params.set('BgnDate', data.BgnDate)
        params.set('EndDate', data.EndDate)
        params.set('NextClk', data.NextClk)
        if (data.NextLoadFlg !== '1') break
      }
      return records
    },
    async logout() {
      const response = await fetchWithCookies(
        new URL(actionPath, baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            'content-type': 'application/x-www-form-urlencoded',
            origin: baseURL,
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
      if (!response.ok && (response.status < 300 || response.status >= 400)) {
        throw new Error(`logout request failed: HTTP ${response.status}`)
      }
    },
  }
}

const loginForm = (page: Record<string, string>, values: ReturnType<typeof credentials>) => ({
  ...page,
  __type: '0001',
  __fid: 'NBG12340',
  __uid: values.branchNo + values.accountNo,
  __bid: '20',
  LoginIdFlg: '0',
  rw_screenparam_loginIdFlg: '',
  rw_screenparam_button: 'login',
  userAgent,
  TimeZone: new Date().toString(),
  TimeZoneDetect: 'Asia/Tokyo',
  ScreenWidth: '1920',
  ScreenHeight: '1080',
  ScreenColorDepth: '24',
  NavigatorPlatform: 'Linux x86_64',
  TenNo: values.branchNo,
  KozaNo: values.accountNo,
  Pw: values.password,
  login: 'ログイン',
})

const rejectedLogin = (html: string) =>
  html.includes('店番号、口座番号、ログインパスワードが一致しません') ||
  html.includes('ログインパスワードを正しく入力してください')

const submit = async (
  baseURL: string,
  jar: CookieJar,
  fields: Record<string, string>,
  referer: string,
) =>
  fetchWithCookies(
    new URL(actionPath, baseURL),
    {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: baseURL,
        referer,
      },
      body: form(fields),
    },
    jar,
  )

export const login = async (options: PayPayBankLoginOptions = {}): Promise<PayPayBankProfile> => {
  const configured = options.baseURL ?? process.env[defaultBaseURL]
  if (!configured) throw new Error(`baseURL is required (or set ${defaultBaseURL})`)
  const baseURL = normalizePayPayBankOrigin(configured)
  const values = credentials(options)
  const jar = new CookieJar()
  const pageResponse = await fetchWithCookies(
    new URL(loginPath, baseURL),
    { headers: browserHeaders },
    jar,
  )
  const pageHTML = await readShiftJis(pageResponse, 'login-page request')
  let fields: Record<string, string> = loginForm(inputFields(pageHTML), values)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await submit(baseURL, jar, fields, new URL(loginPath, baseURL).href)
    const html = await readShiftJis(response, 'login request')
    fields = inputFields(html)
    if (rejectedLogin(html))
      throw new Error('PayPay Bank rejected the branch, account number, or login password')
    const gid = fields.__gid
    if (gid === 'NBG12340G13') break
    if (gid !== 'NBG12340G91' || attempt === 1) {
      const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim() ?? 'untitled'
      throw new Error(`unexpected login transition: ${String(gid)} (${title})`)
    }
    fields = { ...fields, ...loginForm(fields, values), __type: '0091' }
  }

  if (fields.__gid !== 'NBG12340G13')
    throw new Error(`unexpected login transition: ${String(fields.__gid)}`)
  const welcomeResponse = await submit(
    baseURL,
    jar,
    {
      __gid: required(fields, '__gid'),
      __type: required(fields, '__type'),
      __fid: required(fields, '__fid'),
      B_ID: fields.B_ID ?? '2',
      __sid: required(fields, '__sid'),
      __uid: required(fields, '__uid'),
      MenuSelect: fields.MenuSelect ?? '1',
    },
    new URL(actionPath, baseURL).href,
  )
  const welcomeFields = inputFields(await readShiftJis(welcomeResponse, 'welcome-page request'))
  if (!welcomeFields.__sid || !welcomeFields.__uid)
    throw new Error('welcome page did not include an authenticated session')
  return profileFrom(baseURL, values, jar, welcomeFields)
}

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
    capabilities: () => ['accounts:read', 'balances:read', 'transactions:read'],
    operations: () => ['accounts.list', 'balances.list', 'transactions.list', 'history.list'],
    checkAvailability: async () => {
      try {
        await profile.getBalance()
        return { ok: true }
      } catch (message) {
        return { ok: false, message, reason: 'UNKNOWN' }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return { items: [account] } as Page<Account> as never
      if (name === 'balances.list') {
        const accountId = (request as { accountId?: string }).accountId
        if (accountId && accountId !== account.id) return [] as never
        const value = await profile.getBalance()
        return [
          {
            accountId: account.id,
            type: 'current',
            amount: {
              kind: 'money',
              money: { currency: value.currency, value: String(value.amount) },
            },
            asOf: new Date().toISOString(),
          },
        ] as Balance[] as never
      }
      if (name === 'transactions.list' || name === 'history.list') {
        const input = (request ?? {}) as HistoryListRequest
        if (input.accountId && input.accountId !== account.id) return { items: [] } as never
        if (input.kinds?.some((kind) => kind !== 'transaction')) {
          throw new Error('PayPay Bank history.list supports transaction history only')
        }
        const records = await profile.getHistory({ startDate: input.from, endDate: input.to })
        const transactions: Transaction[] = records.map((record, index) => {
          const occurredAt = historyDateToIso(record.date)
          const base = {
            id: `${occurredAt}-${record.transactionNumber}-${index}`,
            accountId: account.id,
            status: 'posted' as const,
            amount: {
              kind: 'money' as const,
              money: { currency: 'JPY', value: String(record.amount) },
            },
            occurredAt,
            description: record.memo ? `${record.description} ${record.memo}` : record.description,
            balanceAfter: {
              kind: 'money' as const,
              money: { currency: 'JPY', value: String(record.balance) },
            },
          }
          if (record.direction === 'deposit')
            return { ...base, kind: 'deposit' as const, direction: 'credit' as const }
          if (record.direction === 'withdrawal')
            return { ...base, kind: 'withdrawal' as const, direction: 'debit' as const }
          return { ...base, kind: 'other' as const, direction: 'neutral' as const }
        })
        if (name === 'transactions.list')
          return { items: transactions } as Page<Transaction> as never
        return {
          items: transactions.map((transaction) => ({
            kind: 'transaction' as const,
            occurredAt: transaction.occurredAt,
            transaction,
          })),
        } as Page<HistoryItem> as never
      }
      throw new Error(`unsupported PayPay Bank operation: ${name}`)
    },
    exportSession: () => profile.session.export(),
    close: () => profile.logout(),
  }
}

export const connect = async (options: PayPayBankLoginOptions = {}) =>
  createProvider(await login(options))
export const getBalance = ({ profile }: { profile: PayPayBankProfile }) => profile.getBalance()
export const exportSession = (profile: PayPayBankProfile) => profile.session.export()

export const importSession = async (session: PayPayBankSession): Promise<PayPayBankProfile> => {
  const baseURL = normalizePayPayBankOrigin(session.baseURL)
  const values = credentials(session)
  if (!session.sid || !session.uid)
    throw new Error('PayPay Bank session is missing authenticated state')
  if (!session.cookies || typeof session.cookies !== 'object')
    throw new Error('PayPay Bank session contains invalid cookies')
  const jar = new CookieJar()
  jar.import(session.cookies)
  return profileFrom(baseURL, values, jar, { __sid: session.sid, __uid: session.uid })
}

export const createPayPayBankClient = (options: { baseURL: string | URL }): PayPayBankClient => {
  const baseURL = normalizePayPayBankOrigin(options.baseURL)
  return {
    baseURL,
    login: (loginOptions = {}) => login({ ...loginOptions, baseURL }),
    importSession,
  }
}
