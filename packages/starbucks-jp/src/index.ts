import { createHash, randomBytes, randomUUID } from 'node:crypto'

export interface StarbucksJpClientOptions {
  /** API gateway origin. Paths, queries, and fragments are rejected. */
  apiOrigin: string | URL
  /** OAuth login origin. Paths, queries, and fragments are rejected. */
  loginOrigin: string | URL
  /** Light Web App origin used to construct the redirect URI. */
  appOrigin: string | URL
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface StarbucksAuthorization {
  url: string
  redirectUri: string
  state: string
  codeVerifier: string
}

export interface StarbucksJpSessionData {
  sessionId: string
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
  listCreditCards(): Promise<StarbucksCreditCard[]>
  listHistories(cardNumber: string): Promise<StarbucksHistory[]>
}

export type StarbucksFingerPrintHeaders = {
  'X-SAPIG-DeviceFingerPrint': string
}

export const getIoBlackbox = async (): Promise<string> => ''

export const getdeviceFingerprint = async (): Promise<string> => ''

export const getFingerPrintHeaders = async (): Promise<StarbucksFingerPrintHeaders> => ({
  'X-SAPIG-DeviceFingerPrint': await getdeviceFingerprint(),
})

export interface StarbucksJpClient {
  readonly apiOrigin: string
  readonly loginOrigin: string
  readonly appOrigin: string
  beginAuthorization(callbackPath: string): Promise<StarbucksAuthorization>
  completeAuthorization(
    authorization: StarbucksAuthorization,
    callbackURL: string | URL,
  ): Promise<StarbucksJpSession>
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

const setCookieValues = (headers: Headers) =>
  (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
  (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])

const sessionIdFrom = (response: Response) => {
  for (const value of setCookieValues(response.headers)) {
    const match = /(?:^|,\s*)session_id=([^;,]*)/.exec(value)
    if (match?.[1]) return match[1]
  }
  throw new StarbucksJpAuthError('authorization response did not set session_id')
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

  const request = async (url: URL, init: RequestInit, operation: string) => {
    const response = await requestFetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
    if (!response.ok) throw new StarbucksJpError(`${operation} failed: HTTP ${response.status}`)
    return response
  }

  const importSession = ({ sessionId }: StarbucksJpSessionData): StarbucksJpSession => {
    if (!sessionId) throw new StarbucksJpAuthError('sessionId is required')

    const execute = async (
      path: string,
      method: 'get' | 'post',
      body: object,
      operation: string,
    ) => {
      const response = await request(
        new URL(paths.execute, apiOrigin),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `session_id=${sessionId}`,
            'x-sbj-proxy-http-key': 'sapig',
            'x-sbj-proxy-http-method': method,
            'x-sbj-proxy-http-path': path,
            'x-sbj-proxy-headers': JSON.stringify({
              'X-SBJApp-Version': '999.999.999 lwa 999.999.999',
              'X-SAPIG-Feature-Flag': '',
              'X-SAPIG-Platform': 'lwa',
            }),
          },
          body: JSON.stringify(body),
        },
        operation,
      )
      return assertRecord(await response.json(), operation)
    }

    return {
      session: { export: () => ({ sessionId }) },
      async getUserInfo() {
        return (await execute(paths.userInfo, 'get', {}, 'getUserInfo')) as StarbucksUserInfo
      },
      async listCards() {
        const result = await execute(paths.cards, 'get', {}, 'listCards')
        return assertArray<StarbucksCard>(result.sbcards, 'listCards')
      },
      async listCreditCards() {
        const result = await execute(paths.creditCards, 'get', {}, 'listCreditCards')
        return assertArray<StarbucksCreditCard>(result.credit_cards, 'listCreditCards')
      },
      async listHistories(cardNumber) {
        if (!/^\d{16}$/.test(cardNumber)) throw new StarbucksJpError('cardNumber must be 16 digits')
        const result = await execute(
          paths.histories,
          'post',
          { card_number: cardNumber },
          'listHistories',
        )
        return assertArray<StarbucksHistory>(result.histories, 'listHistories')
      },
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
    async completeAuthorization(authorization, callbackURL) {
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
      const url = new URL(paths.exchange, apiOrigin)
      url.search = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: authorization.codeVerifier,
        redirect_uri: authorization.redirectUri,
      }).toString()
      const response = await request(url, { method: 'GET' }, 'completeAuthorization')
      return importSession({ sessionId: sessionIdFrom(response) })
    },
    importSession,
  }
}
