import { PayPaySecError, SessionLockedError } from './errors'
import type { PayPaySecFetch } from './types'

export const normalizePayPaySecOrigin = (value: string | URL): string => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new PayPaySecError(
      'baseURL must be an origin without a path, query, or fragment',
      'INVALID_BASE_URL',
    )
  }
  return url.origin
}

const splitSetCookie = (header: string | null) =>
  header?.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()) ?? []

export class CookieJar {
  #cookies: Map<string, string>

  constructor(cookies: Record<string, string> = {}) {
    this.#cookies = new Map()
    for (const [name, value] of Object.entries(cookies)) {
      if (!name.trim() || /[;=\s]/.test(name) || typeof value !== 'string') {
        throw new PayPaySecError(
          'cookies must have valid names and string values',
          'INVALID_COOKIE',
        )
      }
      this.#cookies.set(name, value)
    }
  }

  apply(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
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
    const value = this.#cookies.get(name)
    if (value === undefined) return undefined
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  export() {
    return Object.fromEntries(this.#cookies)
  }

  clear() {
    this.#cookies.clear()
  }
}

interface TransportOptions {
  baseURL: string
  cookies: Record<string, string>
  fetch: PayPaySecFetch
  onLocked(): void
}

export interface PayPaySecTransport {
  readonly baseURL: string
  readonly cookies: CookieJar
  html(path: string, referer?: string): Promise<string>
  json<T>(
    path: string,
    options?: { method?: 'GET' | 'POST'; form?: Record<string, string>; referer?: string },
  ): Promise<T>
  close(): void
}

const browserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

export const createTransport = (options: TransportOptions): PayPaySecTransport => {
  const jar = new CookieJar(options.cookies)
  let closed = false

  const request = async (path: string, init: RequestInit, ajax: boolean) => {
    if (closed) throw new SessionLockedError()
    const url = new URL(path, options.baseURL)
    if (url.origin !== options.baseURL) {
      throw new PayPaySecError('cross-origin requests are not allowed', 'CROSS_ORIGIN_REQUEST')
    }
    const headers = new Headers(init.headers)
    const cookie = jar.header()
    if (cookie) headers.set('cookie', cookie)
    if (ajax) headers.set('x-requested-with', 'XMLHttpRequest')
    let response: Response
    try {
      response = await options.fetch(url, { ...init, headers })
    } catch (cause) {
      throw new PayPaySecError('PayPay Securities network request failed', 'NETWORK_ERROR', {
        cause,
      })
    }
    jar.apply(response)
    if (!response.ok) {
      throw new PayPaySecError(
        `PayPay Securities request failed: HTTP ${response.status}`,
        'HTTP_ERROR',
      )
    }
    return response
  }

  const refererURL = (referer: string | undefined) =>
    new URL(referer ?? '/', options.baseURL).toString()

  return {
    baseURL: options.baseURL,
    cookies: jar,
    async html(path, referer) {
      const response = await request(
        path,
        { headers: { accept: browserAccept, referer: refererURL(referer) } },
        false,
      )
      return response.text()
    },
    async json<T>(
      path: string,
      jsonOptions: {
        method?: 'GET' | 'POST'
        form?: Record<string, string>
        referer?: string
      } = {},
    ) {
      const method = jsonOptions.method ?? (jsonOptions.form ? 'POST' : 'GET')
      const headers: Record<string, string> = {
        accept: 'application/json, text/javascript, */*; q=0.01',
        referer: refererURL(jsonOptions.referer),
      }
      let body: URLSearchParams | undefined
      if (jsonOptions.form) {
        headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
        headers.origin = options.baseURL
        body = new URLSearchParams(jsonOptions.form)
      }
      const response = await request(path, { method, headers, body }, true)
      const text = await response.text()
      let value: unknown
      try {
        value = text ? JSON.parse(text) : null
      } catch (cause) {
        throw new PayPaySecError('PayPay Securities returned invalid JSON', 'INVALID_JSON', {
          cause,
        })
      }
      if (value === null) {
        throw new PayPaySecError('PayPay Securities returned an empty response', 'EMPTY_RESPONSE')
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PayPaySecError(
          'PayPay Securities returned an invalid response',
          'INVALID_RESPONSE',
        )
      }
      const record = value as Record<string, unknown>
      if (record.LOCK_FLG) {
        closed = true
        jar.clear()
        options.onLocked()
        throw new SessionLockedError()
      }
      if (record.STATUS === false || record.status === 'NG') {
        const messages = Array.isArray(record.MESSAGE_ARRAY)
          ? record.MESSAGE_ARRAY.filter((item): item is string => typeof item === 'string')
          : []
        const code = messages.some((message) => /取引パスワード|trade\s*password/i.test(message))
          ? 'TRADE_PASSWORD_INVALID'
          : 'API_ERROR'
        throw new PayPaySecError(
          messages.length > 0
            ? `PayPay Securities rejected the request: ${messages.join('; ')}`
            : 'PayPay Securities rejected the request',
          code,
        )
      }
      return value as T
    },
    close() {
      closed = true
      jar.clear()
    },
  }
}
