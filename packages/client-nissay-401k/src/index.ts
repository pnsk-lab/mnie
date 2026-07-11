import iconv from 'iconv-lite'
import { parse, type HTMLElement } from 'node-html-parser'
import type { FinancialProvider, PensionOperations } from '@mnie/types'

export type {
  PensionContribution,
  PensionContributionAllocation,
  PensionCurrentAssets,
  PensionHistoricalAssetEntry,
  PensionHistoricalAssets,
  PensionHolding,
  PensionOperations,
  PensionParticipant,
} from '@mnie/types'

export interface Nissay401kClientOptions {
  /** Nissay 401k origin. Paths, queries, and fragments are rejected. */
  baseURL: string | URL
  /** Request timeout. Defaults to 15 seconds. */
  timeoutMs?: number
  fetch?: typeof fetch
}

export interface Nissay401kLoginOptions {
  userId: string
  password: string
}
export interface Nissay401kSession {
  baseURL: string
  userId: string
  password: string
  cookies: Record<string, string>
}
export interface NissayHeader {
  name: string
}
export interface NissayCurrentAssetHolding {
  operationType: string
  productName: string
  totalAsset: number
  profitLoss: number
  assetRatio: number
}
export interface NissayCurrentAssets {
  planName: string
  lastLogin: Date
  totalAsset: number
  totalContribution: number
  totalProfitLoss: number
  roi: number
  date: Date
  holdings: NissayCurrentAssetHolding[]
}
export interface NissayContributionAllocation {
  operationType: string
  productName: string
  contributionRatio: number
}
export interface NissayContribution {
  planName: string
  lastLogin: Date
  contributionAmount: number
  contributionDate: Date
  date: Date
  allocations: NissayContributionAllocation[]
}
export interface NissayHistoricalAssetEntry {
  date: Date
  totalAsset: number
  totalContribution: number
  totalProfitLoss: number
}
export interface NissayHistoricalAssets {
  planName: string
  lastLogin: Date
  entries: NissayHistoricalAssetEntry[]
}

export class Nissay401kError extends Error {
  override name = 'Nissay401kError'
}
export class Nissay401kAuthError extends Nissay401kError {
  override name = 'Nissay401kAuthError'
}

export type Nissay401kOperations = PensionOperations

export interface Nissay401kProfile extends FinancialProvider<Nissay401kOperations> {
  readonly baseURL: string
  readonly session: { export(): Nissay401kSession }
  getHeader(): Promise<NissayHeader>
  getCurrentAssets(): Promise<NissayCurrentAssets>
  getContribution(): Promise<NissayContribution>
  getHistoricalAssets(): Promise<NissayHistoricalAssets>
  logout(): Promise<void>
}
export interface Nissay401kClient {
  readonly baseURL: string
  login(options: Nissay401kLoginOptions): Promise<Nissay401kProfile>
  importSession(session: Nissay401kSession): Nissay401kProfile
}

const paths = {
  loginPage: '/dmckanyusha/salsa_open/auth/extra/Login_ip.jsp',
  login: '/dmckanyusha/transactions/login',
  menu: '/dmckanyusha/transactions/menu_init',
  saveUser: '/dmckanyusha/transactions/ck1._V300100_ck100041',
  logout: '/dmckanyusha/transactions/menu_logout?reason_code=1299',
  header: '/dmckanyusha/transactions/ck1._V300100_ck100001',
  current: '/dmckanyusha/transactions/ck1._V300100_ck100020',
  contribution: '/dmckanyusha/transactions/ck1._V300100_ck100021',
  history: '/dmckanyusha/transactions/ck1._V300100_ck100022',
} as const

export const normalizeNissay401kOrigin = (value: string | URL) => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  return url.origin
}

class CookieJar {
  #values = new Map<string, string>()
  constructor(values: Record<string, string> = {}) {
    this.#values = new Map(Object.entries(values))
  }
  apply(response: Response) {
    const values =
      (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const at = pair.indexOf('=')
      if (at > 0) this.#values.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }
  header() {
    return [...this.#values].map(([key, value]) => `${key}=${value}`).join('; ')
  }
  export() {
    return Object.fromEntries(this.#values)
  }
}

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

const required = (element: HTMLElement | null, selector: string) => {
  if (!element) throw new Nissay401kError(`Element not found: ${selector}`)
  return element
}
const all = (root: HTMLElement, selector: string, length?: number) => {
  const elements = root.querySelectorAll(selector)
  if (length !== undefined && elements.length !== length)
    throw new Nissay401kError(
      `Expected ${length} elements for ${selector}, but found ${elements.length}`,
    )
  return elements
}
const number = (text: string) => {
  const normalized = text.trim().replaceAll(',', '').replace(/^▲/, '-').replace(/^＋/, '')
  const value = Number(normalized)
  if (!Number.isFinite(value))
    throw new Nissay401kError(`Expected a number, received: ${text.trim()}`)
  return value
}
const date = (text: string, pattern: 'datetime' | 'query' | 'day' | 'month') => {
  const regex =
    pattern === 'datetime'
      ? /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/
      : pattern === 'query'
        ? /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/
        : pattern === 'day'
          ? /(\d{4})年(\d{2})月(\d{2})日/
          : /(\d{4})年(\d{1,2})月末/
  const match = regex.exec(text)
  if (!match) throw new Nissay401kError(`Expected ${pattern} date, received: ${text.trim()}`)
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    pattern === 'month' ? 1 : Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  )
}
const decode = async (response: Response) => {
  const bytes = Buffer.from(await response.arrayBuffer())
  const header = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(
    response.headers.get('content-type') ?? '',
  )?.[1]
  let charset = header
  if (!charset)
    charset = /<meta[^>]+charset\s*=\s*["']?([^;"'\s/>]+)/i.exec(bytes.toString('latin1'))?.[1]
  return iconv.decode(bytes, charset ?? 'utf-8')
}

export const createNissay401kClient = (options: Nissay401kClientOptions): Nissay401kClient => {
  const baseURL = normalizeNissay401kOrigin(options.baseURL),
    requestFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeoutMs must be a positive finite number')

  const profile = (values: Nissay401kLoginOptions, jar: CookieJar): Nissay401kProfile => {
    const request = async (path: string, init: RequestInit = {}) => {
      let url = new URL(path, baseURL),
        method = init.method ?? 'GET',
        body = init.body
      for (let redirects = 0; redirects <= 10; redirects++) {
        const headers = new Headers({
          ...browserHeaders,
          ...Object.fromEntries(new Headers(init.headers)),
        })
        const cookie = jar.header()
        if (cookie) headers.set('cookie', cookie)
        const response = await requestFetch(url, {
          ...init,
          method,
          body,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
        jar.apply(response)
        if (response.status < 300 || response.status >= 400)
          return { response, url, html: await decode(response) }
        const location = response.headers.get('location')
        if (!location)
          throw new Nissay401kError(`redirect from ${url.pathname} did not include location`)
        url = new URL(location, url)
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && method === 'POST')
        ) {
          method = 'GET'
          body = undefined
        }
      }
      throw new Nissay401kError('too many redirects')
    }
    const checked = async (path: string) => {
      const result = await request(path, {
        headers: { referer: new URL(paths.saveUser, baseURL).toString() },
      })
      const root = parse(result.html)
      const auth =
        result.url.pathname === paths.login
          ? root
              .querySelectorAll('div#emergencyInfo')
              .map((e) => e.text.trim())
              .filter(Boolean)
              .join('\n')
          : root.querySelector('#PI2G306_errmsg_TABLE')?.text.trim()
      if (auth) throw new Nissay401kAuthError(auth)
      if (result.url.pathname !== new URL(path, baseURL).pathname)
        throw new Nissay401kError(`Unexpected response URI: ${result.url.pathname}`)
      if (!result.response.ok)
        throw new Nissay401kError(`request failed: HTTP ${result.response.status}`)
      return root
    }
    const pageHeader = (root: HTMLElement) => {
      const paragraphs = all(root, '.bodyHead p')
      if (paragraphs.length < 2)
        throw new Nissay401kError('page header did not include plan and last login')
      return {
        planName: paragraphs[0]!.text,
        lastLogin: date(required(paragraphs[1]!.querySelector('.date'), '.date').text, 'datetime'),
      }
    }
    const result: Nissay401kProfile = {
      descriptor: { id: 'nissay-401k', name: 'Nissay 401k' },
      accountId: 'primary',
      capabilities: () => ['pensions:read'],
      operations: () => [
        'pension.participant.get',
        'pension.assets.current.get',
        'pension.contribution.get',
        'pension.assets.history.list',
      ],
      checkAvailability: async () => {
        try {
          await result.getCurrentAssets()
          return { ok: true }
        } catch (message) {
          return { ok: false, message }
        }
      },
      invoke: async (name) => {
        if (name === 'pension.participant.get') return result.getHeader() as never
        if (name === 'pension.assets.current.get') return result.getCurrentAssets() as never
        if (name === 'pension.contribution.get') return result.getContribution() as never
        if (name === 'pension.assets.history.list') return result.getHistoricalAssets() as never
        throw new Error(`unsupported Nissay 401k operation: ${name}`)
      },
      exportSession: () => ({ baseURL, ...values, cookies: jar.export() }),
      close: () => result.logout(),
      baseURL,
      session: { export: () => ({ baseURL, ...values, cookies: jar.export() }) },
      async getHeader() {
        const root = await checked(paths.header)
        return { name: required(root.querySelector('.headerContents p'), '.headerContents p').text }
      },
      async getCurrentAssets() {
        const root = await checked(paths.current),
          header = pageHeader(root),
          summary = all(root, '.tableWrapper tr>td', 4)
        const rows = all(root, '.clrStyle01 tr').slice(1, -1)
        return {
          ...header,
          totalAsset: number(required(summary[0]!.querySelector('span'), 'summary asset').text),
          totalContribution: number(
            required(summary[1]!.querySelector('span'), 'summary contribution').text,
          ),
          totalProfitLoss: number(
            required(summary[2]!.querySelector('span'), 'summary profit/loss').text,
          ),
          roi: number(required(summary[3]!.querySelector('span'), 'summary ROI').text),
          date: date(
            required(root.querySelector('div#presentAsset .lineNotes01'), '.lineNotes01').text,
            'query',
          ),
          holdings: rows.map((row) => {
            const cells = all(row, 'td')
            if (cells.length < 5) throw new Nissay401kError('holding row has fewer than five cells')
            return {
              operationType: cells[0]!.text,
              productName: cells[1]!.text.trim(),
              totalAsset: number(cells[2]!.text),
              profitLoss: number(cells[3]!.text),
              assetRatio: number(cells[4]!.text),
            }
          }),
        }
      },
      async getContribution() {
        const root = await checked(paths.contribution),
          header = pageHeader(root),
          summary = all(root, '.tableWrapper tr>td', 2)
        return {
          ...header,
          contributionAmount: number(
            required(summary[0]!.querySelector('span'), 'contribution amount').text,
          ),
          contributionDate: date(summary[1]!.text, 'day'),
          date: date(required(root.querySelector('.lineNotes01'), '.lineNotes01').text, 'query'),
          allocations: all(root, '.clrStyle01 tr')
            .slice(1, -1)
            .map((row) => {
              const cells = all(row, 'td')
              if (cells.length < 3)
                throw new Nissay401kError('allocation row has fewer than three cells')
              return {
                operationType: cells[0]!.text,
                productName: cells[1]!.text.trim(),
                contributionRatio: number(cells[2]!.text),
              }
            }),
        }
      },
      async getHistoricalAssets() {
        const root = await checked(paths.history),
          header = pageHeader(root)
        return {
          ...header,
          entries: all(root, '.clrStyle01.jissekiTable tr')
            .slice(1)
            .map((row) => {
              const cells = all(row, 'th, td')
              if (cells.length < 4)
                throw new Nissay401kError('history row has fewer than four cells')
              return {
                date: date(cells[0]!.text, 'month'),
                totalContribution: number(cells[1]!.text),
                totalAsset: number(cells[2]!.text),
                totalProfitLoss: number(cells[3]!.text),
              }
            }),
        }
      },
      async logout() {
        await request(paths.logout)
      },
    }
    return result
  }
  return {
    baseURL,
    async login(values) {
      if (!values.userId || !values.password) throw new Error('userId and password are required')
      const jar = new CookieJar(),
        authenticated = profile(values, jar)
      // Establish cookies, then submit the fixed authentication form used by the service.
      const raw = async (path: string, init: RequestInit = {}) => {
        let url = new URL(path, baseURL),
          method = init.method ?? 'GET',
          body = init.body
        for (let i = 0; i <= 10; i++) {
          const headers = new Headers({
            ...browserHeaders,
            ...Object.fromEntries(new Headers(init.headers)),
          })
          const cookie = jar.header()
          if (cookie) headers.set('cookie', cookie)
          const response = await requestFetch(url, {
            ...init,
            method,
            body,
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          })
          jar.apply(response)
          if (response.status < 300 || response.status >= 400)
            return { response, url, html: await decode(response) }
          const location = response.headers.get('location')
          if (!location) throw new Nissay401kError('redirect did not include location')
          url = new URL(location, url)
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === 'POST')
          ) {
            method = 'GET'
            body = undefined
          }
        }
        throw new Nissay401kError('too many redirects')
      }
      await raw(paths.loginPage)
      const form = new URLSearchParams({
        auth_key: '5',
        LocalTestFlag: '',
        AUTH_USERID: values.userId,
        AUTH_PASSWORD: values.password,
      })
      let result = await raw(paths.login, {
        method: 'POST',
        body: form,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: new URL(paths.loginPage, baseURL).toString(),
        },
      })
      let root = parse(result.html),
        message =
          root
            .querySelectorAll('div#emergencyInfo')
            .map((e) => e.text.trim())
            .filter(Boolean)
            .join('\n') || root.querySelector('#PI2G306_errmsg_TABLE')?.text.trim()
      if (message) throw new Nissay401kAuthError(message)
      if (result.url.pathname !== paths.menu)
        throw new Nissay401kAuthError(`Unexpected response URI: ${result.url.pathname}`)
      if (root.querySelector('h1')?.text === 'ユーザーID保存確認 / User ID saving check') {
        result = await raw(paths.saveUser, {
          method: 'POST',
          body: new URLSearchParams({ NEED_SAVE: '1' }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: new URL(paths.menu, baseURL).toString(),
          },
        })
        root = parse(result.html)
        message = root.querySelector('#PI2G306_errmsg_TABLE')?.text.trim()
        if (message) throw new Nissay401kAuthError(message)
        if (result.url.pathname !== paths.saveUser)
          throw new Nissay401kAuthError(`Unexpected response URI: ${result.url.pathname}`)
      }
      return authenticated
    },
    importSession(session) {
      if (normalizeNissay401kOrigin(session.baseURL) !== baseURL)
        throw new Error('session baseURL does not match client baseURL')
      if (!session.userId || !session.password)
        throw new Error('session userId and password are required')
      return profile(
        { userId: session.userId, password: session.password },
        new CookieJar(session.cookies),
      )
    },
  }
}
