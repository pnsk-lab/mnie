import { CookieJar } from './cookie-jar'
import { buildAuthRequest, type BuildAuthRequestOptions, type LoginMethod } from './auth'
import { DEFAULT_VPASS_OS_VERSION, buildVpassUserAgent } from './constants'

/**
 * Transport for the two APIs a VPass session spans.
 *
 * The app API (`/api/v3/…`) authenticates and hands back a token; its login
 * response also sets the member-site session cookies, so the member-site API
 * (`/memapi/jaxrs/…`) — which is where statements actually live — works off the
 * same jar with no separate sign-on step.
 */

/** `RESPONSE_OK` on the app API. */
const APP_STATUS_OK = 200
const SAFE_PROVIDER_TYPE = /^[A-Za-z0-9_.-]{1,64}$/
const APP_FAILURE_TYPES = new Set([
  'required_app_version_update',
  'optional_app_version_update',
  'login_invalid',
  'login_token_expired',
  'vpass_login_invalid',
])

export interface VpassErrorMetadata {
  /** HTTP transport status, independent of the JSON envelope. */
  httpStatus?: number
  /** Numeric status carried by the VPass JSON envelope. */
  providerStatus?: number
  /** Sanitized machine-readable provider code. Never a human description. */
  providerType?: string
}

export class VpassError extends Error {
  readonly httpStatus?: number
  readonly providerStatus?: number
  readonly providerType?: string

  constructor(message: string, metadata: VpassErrorMetadata = {}) {
    super(message)
    this.name = 'VpassError'
    this.httpStatus = metadata.httpStatus
    this.providerStatus = metadata.providerStatus
    this.providerType = metadata.providerType
  }
}

export class VpassAuthError extends VpassError {
  constructor(message: string, metadata: VpassErrorMetadata = {}) {
    super(message, metadata)
    this.name = 'VpassAuthError'
  }
}

export interface VpassClientOptions {
  /** App API origin. Paths, queries, and fragments are not accepted. */
  apiBaseURL: string | URL
  /** Member-site origin. Paths, queries, and fragments are not accepted. */
  webBaseURL: string | URL
  /** Version sent in the app prefix and `X-App-Version`. */
  appVersion: string
  /** Android release sent as `X-OS-Version`. Defaults to the verified provider profile. */
  osVersion?: string
  /**
   * Full app User-Agent. Defaults to the provider's generic WebView identity,
   * prefixed with the externally selected `appVersion`.
   */
  userAgent?: string
  apiVersion?: string
  /**
   * Transport. Typed as the minimum this client uses rather than `typeof fetch`,
   * whose exact shape differs between the DOM and Bun lib definitions and would
   * otherwise force callers to cast their stubs.
   */
  fetch?: FetchLike
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>

export const normalizeOrigin = (value: string | URL, name: string): string => {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'https:') throw new Error(`${name} must be https`)
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or fragment`)
  }
  return url.origin
}

export interface AuthResponseData {
  login_token?: string
  [key: string]: unknown
}

export interface AppEnvelope<Data = unknown> {
  status: number
  type: string
  description?: string
  description_sub?: string
  data: Data
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const providerTypeOf = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_PROVIDER_TYPE.test(value) ? value : undefined

const headerValue = (name: string, value: string): string => {
  if (!value || /[\r\n]/.test(value))
    throw new Error(`${name} must be a non-empty HTTP header value`)
  return value
}

/**
 * Adler-32 of the request path, which the member site sends as `requestHash`.
 *
 * Mirrors `vp/alcor/util/adler32` in the site's own bundle. It is a checksum of
 * the path, not a signature — there is no secret involved.
 */
export const requestHash = (pathname: string): number => {
  let a = 1
  let b = 0
  for (let index = 0; index < pathname.length; index++) {
    a = (a + pathname.charCodeAt(index)) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

export interface MemberApiOptions {
  /** Goes into `body.content`. */
  content?: Record<string, unknown>
  token?: string
}

export class VpassClient {
  readonly jar = new CookieJar()
  readonly #apiOrigin: string
  readonly #webOrigin: string
  readonly #apiVersion: string
  readonly #appVersion: string
  readonly #osVersion: string
  readonly #userAgent: string
  readonly #fetch: FetchLike

  constructor(options: VpassClientOptions) {
    this.#apiOrigin = normalizeOrigin(options.apiBaseURL, 'apiBaseURL')
    this.#webOrigin = normalizeOrigin(options.webBaseURL, 'webBaseURL')
    this.#apiVersion = options.apiVersion ?? 'v3'
    this.#appVersion = headerValue('appVersion', options.appVersion)
    this.#osVersion = headerValue('osVersion', options.osVersion ?? DEFAULT_VPASS_OS_VERSION)
    this.#userAgent = headerValue(
      'userAgent',
      options.userAgent ?? buildVpassUserAgent(this.#appVersion),
    )
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  #headers(extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      'User-Agent': this.#userAgent,
      Accept: 'application/json',
      ...extra,
    }
    const cookie = this.jar.header()
    if (cookie) headers.Cookie = cookie
    return headers
  }

  #appHeaders(extra: Record<string, string> = {}) {
    return this.#headers({
      'X-App-Version': this.#appVersion,
      'X-OS-Version': this.#osVersion,
      'Cache-Control': 'no-cache',
      ...extra,
    })
  }

  /**
   * POST to the app API. `path` is relative to `/api/<version>/`.
   *
   * The auth endpoints are declared with a bare `application/json` in the app's
   * Retrofit interface while everything else carries a charset, so the header
   * is matched per endpoint rather than sent uniformly.
   */
  async callApp<Data = unknown>(
    path: string,
    body: unknown,
    authorization?: string,
  ): Promise<AppEnvelope<Data>> {
    const url = new URL(`/api/${this.#apiVersion}/${path}`, this.#apiOrigin)
    const isAuth = path === 'Fauth' || path === 'Vauth'
    const response = await this.#fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: this.#appHeaders({
        'Content-Type': isAuth ? 'application/json' : 'application/json; charset=UTF-8',
        ...(authorization ? { Authorization: authorization } : {}),
      }),
      body: JSON.stringify(body),
    })
    this.jar.apply(response)

    let parsed: unknown
    try {
      parsed = JSON.parse(await response.text())
    } catch {
      throw new VpassError(`${path} returned a non-JSON response`, {
        httpStatus: response.status,
      })
    }

    const providerStatus =
      isRecord(parsed) && typeof parsed.status === 'number' && Number.isFinite(parsed.status)
        ? parsed.status
        : undefined
    const providerType = isRecord(parsed) ? providerTypeOf(parsed.type) : undefined
    const metadata = { httpStatus: response.status, providerStatus, providerType }

    if (!response.ok || providerStatus !== APP_STATUS_OK) {
      throw new VpassError(`${path} request failed`, metadata)
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string' || !('data' in parsed)) {
      throw new VpassError(`${path} returned an invalid response`, metadata)
    }
    if (providerType && APP_FAILURE_TYPES.has(providerType)) {
      throw new VpassError(`${path} request failed`, metadata)
    }

    return parsed as unknown as AppEnvelope<Data>
  }

  /**
   * POST to the member-site API, which wraps everything in a header/body pair
   * and expects `requestHash` to match the path it was sent to.
   */
  async callMember<Content = unknown>(
    path: string,
    options: MemberApiOptions = {},
  ): Promise<Content> {
    const pathname = `/memapi/jaxrs/${path}`
    const url = new URL(pathname, this.#webOrigin)
    const body: Record<string, unknown> = {
      header: { requestHash: String(requestHash(pathname)) },
      body: { content: options.content ?? {} },
    }
    if (options.token) (body.body as Record<string, unknown>).token = options.token

    const response = await this.#fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: this.#headers({ 'Content-Type': 'application/json; charset=UTF-8' }),
      body: JSON.stringify(body),
    })
    this.jar.apply(response)

    let parsed: unknown
    try {
      parsed = JSON.parse(await response.text())
    } catch {
      throw new VpassError(`${path} returned a non-JSON response`, {
        httpStatus: response.status,
      })
    }

    const payload = isRecord(parsed) ? parsed : undefined
    const header = payload && isRecord(payload.header) ? payload.header : undefined
    const providerType = providerTypeOf(header?.resultCode)
    const metadata = { httpStatus: response.status, providerType }
    if (!response.ok) throw new VpassError(`${path} request failed`, metadata)
    if (!payload || !header) throw new VpassError(`${path} returned an invalid response`, metadata)
    if (header.loginFlg === false) {
      throw new VpassAuthError(`${path} was called without a live session`, metadata)
    }
    if (typeof header.resultCode === 'string' && header.resultCode !== '0') {
      throw new VpassError(`${path} request failed`, metadata)
    }

    const responseBody = isRecord(payload.body) ? payload.body : undefined
    if (!responseBody || !('content' in responseBody)) {
      throw new VpassError(`${path} returned no content`, metadata)
    }
    return responseBody.content as Content
  }

  /**
   * Authenticates and, as a side effect, populates the jar with the member-site
   * session the statement calls need.
   *
   * `Fauth` is the endpoint for the unified (FA) ID and for VPass IDs on the
   * current app; `Vauth` is the older VPass-only route.
   */
  async authenticate(
    method: LoginMethod,
    options: Omit<BuildAuthRequestOptions, 'includeIdType'> & { endpoint?: 'Fauth' | 'Vauth' },
  ): Promise<AuthResponseData> {
    const endpoint = options.endpoint ?? 'Fauth'
    const body = buildAuthRequest(method, {
      ...options,
      includeIdType: endpoint === 'Fauth',
    })
    try {
      const envelope = await this.callApp<AuthResponseData>(endpoint, body)
      if (!envelope.data) throw new VpassAuthError(`${endpoint} returned no data`)
      return envelope.data
    } catch (error) {
      if (error instanceof VpassError && !(error instanceof VpassAuthError)) {
        throw new VpassAuthError(error.message, {
          httpStatus: error.httpStatus,
          providerStatus: error.providerStatus,
          providerType: error.providerType,
        })
      }
      throw error
    }
  }
}
