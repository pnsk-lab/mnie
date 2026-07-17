import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  generateStarbucksLoginFormData,
  type StarbucksIoBlackboxRuntime,
  type StarbucksKxzRuntime,
} from './anti-bot'
export {
  createStarbucksIoBlackboxRuntimeFromLogin,
  createStarbucksKxzRuntimeFromApp,
  fetchStarbucksIoBlackboxScript,
  fetchStarbucksIoDynamicScript,
  fetchStarbucksIoLogoScript,
  fetchStarbucksIoRemoteWdpScript,
  fetchStarbucksKxzScripts,
  type StarbucksDynamicScriptLoaderOptions,
} from './anti-bot-loader'
import type { StarbucksNodeFingerprintOptions } from './fingerprint'
export {
  collectStarbucksIoBrowserSignals,
  collectStarbucksIoBrowserSignalsAsync,
  createStarbucksIoInteractionCollector,
  decodeStarbucksIoBlackbox,
  decodeStarbucksIoBlackboxes,
  parseStarbucksIoDynamicScript,
  parseStarbucksIoLogoScript,
  STARBUCKS_IO_BLACKBOX_FIELD_NAMES,
} from './iovation'
export type {
  StarbucksIoBlackboxFieldName,
  StarbucksIoBlackboxOptions,
  StarbucksIoBlackboxSignals,
  StarbucksIoBrowserEnvironment,
} from './iovation'

export {
  createStarbucksIoBlackboxRuntime,
  createStarbucksKxzRuntime,
  generateStarbucksLoginFormData,
  STARBUCKS_KXZ_HEADER_PREFIX,
  STARBUCKS_KXZ_HEADER_SUFFIXES,
  STARBUCKS_LOGIN_ANTI_BOT_FIELD_PREFIX,
  type StarbucksAntiBotScripts,
  type StarbucksIoBlackboxRuntime,
  type StarbucksKxzRequest,
  type StarbucksKxzRuntime,
  type StarbucksKxzRuntimeOptions,
  type StarbucksKxzStage,
  type StarbucksLoginFormData,
  type StarbucksLoginFormOptions,
  type StarbucksLoginFormValues,
} from './anti-bot'
export {
  collectStarbucksNodeFingerprint,
  getStarbucksNodeFingerprint,
  type StarbucksNodeFingerprint,
  type StarbucksNodeFingerprintOptions,
} from './fingerprint'
export {
  createStarbucksKxzHeaders,
  parseStarbucksKxzBootstrapInit,
  parseStarbucksLoginCompletionEvent,
  parseStarbucksLoginBootstrapEvent,
  parseStarbucksKxzSeedURL,
  readStarbucksKxzHeaders,
  matchesStarbucksKxzRequest,
  splitStarbucksKxzHeaderValue,
  chunkStarbucksKxzHeader,
  createStarbucksKxzInstrumented,
  STARBUCKS_KXZ_SUFFIXES,
  type StarbucksKxzAccessorHook,
  type StarbucksKxzHeaderValues,
  type StarbucksKxzHookBus,
  type StarbucksKxzInstrumented,
  type StarbucksKxzInvocation,
  type StarbucksKxzInvocationHook,
  type StarbucksKxzMatcherConfig,
  type StarbucksKxzChunkConfig,
  type StarbucksKxzRequestLike,
  type StarbucksKxzSeedParameters,
  type StarbucksKxzSuffix,
  type StarbucksLoginBootstrapEvent,
  type StarbucksLoginCompletionEventOptions,
} from './kxz-protocol'
export {
  createStarbucksPureKxzVm,
  createStarbucksPureLoginVm,
  type StarbucksPureKxzVmData,
  type StarbucksPureKxzVmOptions,
  type StarbucksPureVmEvent,
  type StarbucksPureVmRuntime,
} from './kxz-vm'
export {
  createStarbucksQuickJsBrowserRuntime,
  type StarbucksQuickJsBrowserOptions,
  type StarbucksQuickJsBrowserRuntime,
} from './quickjs-browser'
export { createStarbucksProvider, type StarbucksJpProviderOptions } from './provider'

export interface StarbucksFingerprintOptions extends StarbucksNodeFingerprintOptions {
  /** Optional runtime executing the captured iOvation WDP script. */
  ioBlackboxRuntime?: StarbucksIoBlackboxRuntime
}

export interface StarbucksJpClientOptions {
  /** API gateway origin. Paths, queries, and fragments are rejected. */
  apiOrigin: string | URL
  /** OAuth login origin. Paths, queries, and fragments are rejected. */
  loginOrigin: string | URL
  /** Light Web App origin used to construct the redirect URI. */
  appOrigin: string | URL
  fetch?: typeof fetch
  timeoutMs?: number
  /** Optional VM-free browser-scope runtime for the captured anti-bot scripts. */
  kxzRuntime?: StarbucksKxzRuntime
  /** Optional TypeScript iOvation runtime for the captured WDP script. */
  ioBlackboxRuntime?: StarbucksIoBlackboxRuntime
}

export interface StarbucksAuthorization {
  url: string
  redirectUri: string
  state: string
  codeVerifier: string
}

export interface StarbucksBrowserlessLoginOptions {
  /** Redirect path on appOrigin used for the OAuth callback. */
  callbackPath?: string
  /** Pre-authenticated login cookies, such as BARISTA_REMEMBER_ME. */
  cookies?: Record<string, string>
  /** Maximum redirects followed before the flow is rejected. */
  maxRedirects?: number
}

export interface StarbucksBrowserlessCredentialsOptions extends StarbucksBrowserlessLoginOptions {
  username: string
  password: string
  rememberMe?: boolean
  /** User agent sent with the form navigation. */
  userAgent?: string
  /** Explicit browser-generated value when no iOvation runtime is supplied. */
  deviceFingerprint?: string
}

export interface StarbucksJpSessionData {
  sessionId: string
  cookies?: Record<string, string>
}

export interface StarbucksUserInfo {
  family_name: string
  given_name: string
  family_name_kana: string
  given_name_kana: string
  nickname: string
  gender: number
  birthdate_year: number
  birthdate_month: number
  birthdate_day: number
  postal_code_1: string
  postal_code_2: string
  prefecture_code: number
  address_1: string
  address_2: string
  address_3: string
  phone_number_1: string
  phone_number_2: string
  phone_number_3: string
  mail_address_main: string
  customer_id_number: number
  customer_id_string: string
  [key: string]: unknown
}

export interface StarbucksAmount {
  amount: number
  updated_date: string
}

/** Current stored-value balance for one Starbucks Card. */
export interface StarbucksBalance extends StarbucksAmount {
  card_number: string
}

export interface StarbucksCard {
  card_number: string
  order: number
  status: number
  nickname: string
  main_card: boolean
  digital_starbucks_card: boolean
  digital_starbucks_card_type: string
  image_url: string
  latest_amount: StarbucksAmount
  auto_charge_setting: { enabled: boolean; [key: string]: unknown }
  sb_card_id: number
}

export interface StarbucksCreditCard {
  [key: string]: unknown
}

export interface StarbucksHistory {
  store_name: string
  created_date: string
  used_amount: number
}

export interface StarbucksJpSession {
  readonly session: { export(): StarbucksJpSessionData }
  getUserInfo(): Promise<StarbucksUserInfo>
  listCards(): Promise<StarbucksCard[]>
  /** Returns the current balance for every card in the authenticated account. */
  getBalance(): Promise<StarbucksBalance[]>
  listCreditCards(): Promise<StarbucksCreditCard[]>
  listHistories(cardNumber: string): Promise<StarbucksHistory[]>
  /** Alias for listHistories, matching the provider-facing naming. */
  history(cardNumber: string): Promise<StarbucksHistory[]>
}

export type StarbucksFingerPrintHeaders = {
  'X-SAPIG-DeviceFingerPrint': string
}

export const getIoBlackbox = async (options: StarbucksFingerprintOptions = {}): Promise<string> =>
  options.ioBlackboxRuntime
    ? options.ioBlackboxRuntime.getBlackbox()
    : (() => {
        throw new StarbucksJpAuthError(
          'getIoBlackbox requires an iOvation runtime; use getStarbucksNodeFingerprint explicitly for local testing',
        )
      })()

export const getdeviceFingerprint = async (
  options: StarbucksFingerprintOptions = {},
): Promise<string> =>
  options.ioBlackboxRuntime
    ? options.ioBlackboxRuntime.getBlackbox()
    : (() => {
        throw new StarbucksJpAuthError(
          'getdeviceFingerprint requires an iOvation runtime; use getStarbucksNodeFingerprint explicitly for local testing',
        )
      })()

export const getFingerPrintHeaders = async (
  options: StarbucksFingerprintOptions = {},
): Promise<StarbucksFingerPrintHeaders> => ({
  'X-SAPIG-DeviceFingerPrint': await getdeviceFingerprint(options),
})

export interface StarbucksJpClient {
  readonly apiOrigin: string
  readonly loginOrigin: string
  readonly appOrigin: string
  beginAuthorization(callbackPath: string): Promise<StarbucksAuthorization>
  completeAuthorization(
    authorization: StarbucksAuthorization,
    callbackURL: string | URL,
    cookies?: Record<string, string>,
  ): Promise<StarbucksJpSession>
  /** Completes OAuth without a browser when a valid pre-authenticated cookie is supplied. */
  loginWithCookies(options?: StarbucksBrowserlessLoginOptions): Promise<StarbucksJpSession>
  /** Executes the current login page anti-bot script and posts the credentials without a browser. */
  loginWithCredentials(options: StarbucksBrowserlessCredentialsOptions): Promise<StarbucksJpSession>
  importSession(data: StarbucksJpSessionData): StarbucksJpSession
}

export class StarbucksJpError extends Error {
  override name = 'StarbucksJpError'
}

export class StarbucksJpAuthError extends StarbucksJpError {
  override name = 'StarbucksJpAuthError'
}

export const normalizeStarbucksOrigin = (value: string | URL) => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('origin must not contain a path, query, or fragment')
  return url.origin
}

const paths = {
  authorize: '/oauth/authorize',
  exchange: '/auth/redirect',
  execute: '/resources/_execute-api',
  userInfo: '/api/v2/auth/userinfo',
  cards: '/api/v4/sbcards',
  creditCards: '/api/v4/credit-cards',
  histories: '/api/v4/sbcards/histories',
} as const

const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url')

const splitSetCookie = (header: string | null) =>
  header?.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()) ?? []

class StarbucksCookieJar {
  #cookies = new Map<string, string>()

  constructor(cookies: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(cookies)) {
      if (!name.trim() || /[;=\s]/.test(name) || typeof value !== 'string')
        throw new StarbucksJpAuthError('cookies must have valid names and string values')
      this.#cookies.set(name, value)
    }
  }

  apply(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0] ?? ''
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const cookieValue = pair.slice(separator + 1)
      if (/Max-Age=0(?:;|$)/i.test(value) || cookieValue === '') this.#cookies.delete(name)
      else this.#cookies.set(name, cookieValue)
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  value(name: string) {
    return this.#cookies.get(name)
  }

  export() {
    return Object.fromEntries(this.#cookies)
  }
}

const assertRecord = (value: unknown, operation: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StarbucksJpError(`${operation} returned an invalid response`)
  return value as Record<string, unknown>
}

const assertArray = <T>(value: unknown, operation: string): T[] => {
  if (!Array.isArray(value)) throw new StarbucksJpError(`${operation} returned an invalid response`)
  return value as T[]
}

export const createStarbucksJpClient = (options: StarbucksJpClientOptions): StarbucksJpClient => {
  const apiOrigin = normalizeStarbucksOrigin(options.apiOrigin)
  const loginOrigin = normalizeStarbucksOrigin(options.loginOrigin)
  const appOrigin = normalizeStarbucksOrigin(options.appOrigin)
  const requestFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeoutMs must be a positive finite number')

  const request = async (
    url: URL,
    init: RequestInit,
    operation: string,
    cookies?: StarbucksCookieJar,
  ) => {
    const headers = new Headers(init.headers)
    if (!headers.has('cookie')) {
      const cookie = cookies?.header()
      if (cookie) headers.set('cookie', cookie)
    }
    const response = await requestFetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
    cookies?.apply(response)
    if (!response.ok) throw new StarbucksJpError(`${operation} failed: HTTP ${response.status}`)
    return response
  }

  const importSession = ({ sessionId, cookies }: StarbucksJpSessionData): StarbucksJpSession => {
    if (!sessionId) throw new StarbucksJpAuthError('sessionId is required')
    const cookieJar = new StarbucksCookieJar({ ...cookies, session_id: sessionId })

    const execute = async (
      path: string,
      method: 'get' | 'post',
      body: object,
      operation: string,
    ) => {
      const url = new URL(paths.execute, apiOrigin)
      const requestBody = JSON.stringify(body)
      const proxyHeaders: Record<string, string> = {
        'X-SBJApp-Version': '999.999.999 lwa 999.999.999',
        'X-SAPIG-Feature-Flag': '',
        'X-SAPIG-Platform': 'lwa',
      }
      if (options.ioBlackboxRuntime) {
        proxyHeaders['X-SAPIG-DeviceFingerPrint'] = await options.ioBlackboxRuntime.getBlackbox()
      }
      const headers = new Headers({
        'content-type': 'application/json',
        'x-sbj-proxy-http-key': 'sapig',
        'x-sbj-proxy-http-method': method,
        'x-sbj-proxy-http-path': path,
        'x-sbj-proxy-headers': JSON.stringify(proxyHeaders),
      })
      if (options.kxzRuntime) {
        const kxzHeaders = await options.kxzRuntime.getHeaders({
          url,
          method: 'POST',
          headers,
          body: requestBody,
        })
        for (const [name, value] of Object.entries(kxzHeaders)) headers.set(name, value)
      }
      const response = await request(
        url,
        { method: 'POST', headers, body: requestBody },
        operation,
        cookieJar,
      )
      return assertRecord(await response.json(), operation)
    }

    const listCards = async () => {
      const result = await execute(paths.cards, 'get', {}, 'listCards')
      return assertArray<StarbucksCard>(result.sbcards, 'listCards')
    }
    const getBalance = async (): Promise<StarbucksBalance[]> =>
      (await listCards()).map((card) => ({
        card_number: card.card_number,
        amount: card.latest_amount.amount,
        updated_date: card.latest_amount.updated_date,
      }))
    const listHistories = async (cardNumber: string) => {
      if (!/^\d{16}$/.test(cardNumber)) throw new StarbucksJpError('cardNumber must be 16 digits')
      const result = await execute(
        paths.histories,
        'post',
        { card_number: cardNumber },
        'listHistories',
      )
      return assertArray<StarbucksHistory>(result.histories, 'listHistories')
    }

    return {
      session: { export: () => ({ sessionId, cookies: cookieJar.export() }) },
      async getUserInfo() {
        return (await execute(paths.userInfo, 'get', {}, 'getUserInfo')) as StarbucksUserInfo
      },
      listCards,
      getBalance,
      async listCreditCards() {
        const result = await execute(paths.creditCards, 'get', {}, 'listCreditCards')
        return assertArray<StarbucksCreditCard>(result.credit_cards, 'listCreditCards')
      },
      listHistories,
      history: listHistories,
    }
  }

  return {
    apiOrigin,
    loginOrigin,
    appOrigin,
    async beginAuthorization(callbackPath) {
      if (!callbackPath.startsWith('/'))
        throw new StarbucksJpAuthError('callbackPath must start with /')
      const callback = new URL(callbackPath, appOrigin)
      if (callback.origin !== appOrigin)
        throw new StarbucksJpAuthError('callbackPath must remain on appOrigin')
      const codeVerifier = base64url(randomBytes(32))
      const challenge = base64url(createHash('sha256').update(codeVerifier).digest())
      const state = randomUUID()
      const url = new URL(paths.authorize, loginOrigin)
      url.search = new URLSearchParams({
        redirect_uri: callback.href,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        mode: 'lwa',
        response_type: 'code',
        state,
        client_id: 'light-web-app',
      }).toString()
      return { url: url.href, redirectUri: callback.href, state, codeVerifier }
    },
    async completeAuthorization(authorization, callbackURL, initialCookies = {}) {
      const callback = new URL(callbackURL)
      if (
        callback.origin + callback.pathname !==
        new URL(authorization.redirectUri).origin + new URL(authorization.redirectUri).pathname
      )
        throw new StarbucksJpAuthError('callback URL does not match redirectUri')
      if (callback.searchParams.get('state') !== authorization.state)
        throw new StarbucksJpAuthError('authorization state does not match')
      const code = callback.searchParams.get('code')
      if (!code) throw new StarbucksJpAuthError('callback URL does not contain a code')
      const cookies = new StarbucksCookieJar(initialCookies)
      const url = new URL(paths.exchange, apiOrigin)
      url.search = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: authorization.codeVerifier,
        redirect_uri: authorization.redirectUri,
      }).toString()
      await request(url, { method: 'GET' }, 'completeAuthorization', cookies)
      const sessionId = cookies.value('session_id')
      if (!sessionId) {
        throw new StarbucksJpAuthError('authorization response did not set session_id')
      }
      return importSession({ sessionId, cookies: cookies.export() })
    },
    async loginWithCookies(loginOptions = {}) {
      const callbackPath = loginOptions.callbackPath ?? '/redirect?pageRedirect=/card/sbcardinfo'
      const maxRedirects = loginOptions.maxRedirects ?? 8
      if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
        throw new StarbucksJpAuthError('maxRedirects must be a non-negative integer')
      const authorization = await this.beginAuthorization(callbackPath)
      const cookies = new StarbucksCookieJar(loginOptions.cookies)
      let current = new URL(authorization.url)

      for (let redirects = 0; ; redirects++) {
        const headers = new Headers()
        const cookie = cookies.header()
        if (cookie) headers.set('cookie', cookie)
        const response = await requestFetch(current, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        })
        cookies.apply(response)
        if (response.status >= 300 && response.status < 400) {
          if (redirects >= maxRedirects)
            throw new StarbucksJpAuthError('browserless login exceeded maxRedirects')
          const location = response.headers.get('location')
          if (!location) throw new StarbucksJpAuthError('login redirect did not contain a location')
          const next = new URL(location, current)
          if (next.origin === appOrigin)
            return this.completeAuthorization(authorization, next, cookies.export())
          if (next.origin !== loginOrigin)
            throw new StarbucksJpAuthError('login redirect left the configured origins')
          current = next
          continue
        }
        if (current.origin === loginOrigin && current.pathname === '/login') {
          throw new StarbucksJpAuthError(
            'login requires an interactive form; provide a valid pre-authenticated cookie',
          )
        }
        throw new StarbucksJpAuthError(`login failed: HTTP ${response.status}`)
      }
    },
    async loginWithCredentials(loginOptions) {
      if (!loginOptions.username || !loginOptions.password)
        throw new StarbucksJpAuthError('username and password are required')
      const callbackPath = loginOptions.callbackPath ?? '/redirect?pageRedirect=/card/sbcardinfo'
      const maxRedirects = loginOptions.maxRedirects ?? 8
      if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
        throw new StarbucksJpAuthError('maxRedirects must be a non-negative integer')
      const deviceFingerprint =
        loginOptions.deviceFingerprint ??
        (options.ioBlackboxRuntime ? await options.ioBlackboxRuntime.getBlackbox() : undefined)
      if (!deviceFingerprint)
        throw new StarbucksJpAuthError(
          'loginWithCredentials requires a browser-generated deviceFingerprint or ioBlackboxRuntime',
        )

      const authorization = await this.beginAuthorization(callbackPath)
      const cookies = new StarbucksCookieJar(loginOptions.cookies)
      let current = new URL(authorization.url)
      let formSubmitted = false

      for (let redirects = 0; ; redirects++) {
        const headers = new Headers()
        const cookie = cookies.header()
        if (cookie) headers.set('cookie', cookie)
        const response = await requestFetch(current, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        })
        cookies.apply(response)
        if (response.status >= 300 && response.status < 400) {
          if (redirects >= maxRedirects)
            throw new StarbucksJpAuthError('browserless login exceeded maxRedirects')
          const location = response.headers.get('location')
          if (!location) throw new StarbucksJpAuthError('login redirect did not contain a location')
          const next = new URL(location, current)
          if (next.origin === appOrigin)
            return this.completeAuthorization(authorization, next, cookies.export())
          if (next.origin !== loginOrigin)
            throw new StarbucksJpAuthError('login redirect left the configured origins')
          current = next
          continue
        }

        if (current.origin !== loginOrigin || current.pathname !== '/login')
          throw new StarbucksJpAuthError(`login failed: HTTP ${response.status}`)
        if (response.status !== 200)
          throw new StarbucksJpAuthError(`login page failed: HTTP ${response.status}`)
        if (formSubmitted) throw new StarbucksJpAuthError('login credentials were rejected')

        const html = await response.text()
        const formData = await generateStarbucksLoginFormData(
          html,
          {
            username: loginOptions.username,
            password: loginOptions.password,
            rememberMe: loginOptions.rememberMe,
            deviceFingerprint,
          },
          { pageURL: current, timeoutMs, userAgent: loginOptions.userAgent, fetch: requestFetch },
        )
        const action = new URL(formData.action, current)
        if (action.origin !== loginOrigin)
          throw new StarbucksJpAuthError('login form action left the configured origin')
        if (formData.method !== 'POST')
          throw new StarbucksJpAuthError(`login form uses unsupported method ${formData.method}`)
        const postHeaders = new Headers({
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'content-type': 'application/x-www-form-urlencoded',
          origin: loginOrigin,
          referer: current.href,
          'user-agent':
            loginOptions.userAgent ??
            'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
        })
        const postCookie = cookies.header()
        if (postCookie) postHeaders.set('cookie', postCookie)
        const postResponse = await requestFetch(action, {
          method: 'POST',
          headers: postHeaders,
          body: formData.fields.toString(),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        })
        cookies.apply(postResponse)
        formSubmitted = true
        if (postResponse.status >= 300 && postResponse.status < 400) {
          if (redirects >= maxRedirects)
            throw new StarbucksJpAuthError('browserless login exceeded maxRedirects')
          const location = postResponse.headers.get('location')
          if (!location) throw new StarbucksJpAuthError('login redirect did not contain a location')
          const next = new URL(location, action)
          if (next.origin === appOrigin)
            return this.completeAuthorization(authorization, next, cookies.export())
          if (next.origin !== loginOrigin)
            throw new StarbucksJpAuthError('login redirect left the configured origins')
          current = next
          continue
        }
        throw new StarbucksJpAuthError(
          `login credentials were rejected: HTTP ${postResponse.status}`,
        )
      }
    },
    importSession,
  }
}
