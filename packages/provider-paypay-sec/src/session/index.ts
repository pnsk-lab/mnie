import { createHash, randomUUID } from 'node:crypto'
import { createPayPaySecClient } from '../client'
import { PayPaySecError } from '../errors'
import { CookieJar, normalizePayPaySecOrigin } from '../transport'
import type {
  LoginWithPasskeyOptions,
  PasskeyAssertionProvider,
  PayPaySecClient,
  PayPaySecFetch,
  PayPaySecPasskeyClientOptions,
  WebAuthnAssertion,
} from '../types'
import { createStoredCredentialPasskeyProvider } from './passkey'

type JsonRecord = Record<string, unknown>
type PasskeyPhase = 'prepare' | 'options' | 'credential' | 'complete'

interface PasskeyEndpointConfig {
  baseURL: string
  passkeyBffBaseURL: string
}

const PASSKEY_ACTION = 'VERIFY'
const PASSKEY_APP_ID = 'NATIVE_PC'
const TRANSIENT_AUTH_COOKIE_PREFIX = '__Secure-client-auth-state-'

export const loginWithPasskey = async (
  options: LoginWithPasskeyOptions,
  clientOptions: PayPaySecPasskeyClientOptions = {},
): Promise<PayPaySecClient> => {
  const endpoints = resolveEndpointConfig(options)
  const provider = resolvePasskeyProvider(options)
  const providerOrigin = validatePasskeyProvider(provider)
  const fetch = clientOptions.fetch ?? globalThis.fetch
  const deviceId = safeMetadata(clientOptions.deviceId ?? randomUUID(), 'deviceId')
  const deviceName = safeMetadata(clientOptions.deviceName ?? 'mnie-node', 'deviceName')
  const timeZone = safeMetadata(
    clientOptions.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Tokyo',
    'timeZone',
  )

  const webJar = new CookieJar()
  const loginURL = new URL('/login/', endpoints.baseURL)
  const loginResponse = await fetchWithCookies(fetch, webJar, loginURL, {
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  if (!loginResponse.ok) {
    throw new PayPaySecError(
      `PayPay Securities login entry failed: HTTP ${loginResponse.status}`,
      'PASSKEY_LOGIN_ENTRY_FAILED',
    )
  }
  await loginResponse.arrayBuffer()

  const authJar = new CookieJar({ DEVICE_ID: deviceId, DEVICE_NAME: deviceName })
  const requestBff = createBffRequester({
    baseURL: endpoints.passkeyBffBaseURL,
    deviceId,
    deviceName,
    fetch,
    jar: authJar,
    origin: providerOrigin,
    timeZone,
  })
  const callbackURL = new URL('/login/passkey/callback', endpoints.baseURL).toString()

  const prepared = await requestBff('prepare', '/api/passkey/prepare/v1', 'POST', {
    redirect_url: callbackURL,
  })
  const tempId = requiredString(prepared.temp_id, 'prepare.temp_id')

  const optionResponse = await requestBff('options', '/api/passkey/options/v1', 'DELETE', {
    temp_id: tempId,
  })
  const optionEnvelope = requiredRecord(optionResponse.options, 'options.options')
  const publicKey = requiredRecord(optionEnvelope.publicKey, 'options.options.publicKey')
  const challenge = requiredString(publicKey.challenge, 'options.options.publicKey.challenge')
  const rpId = requiredString(publicKey.rpId, 'options.options.publicKey.rpId')
  if (rpId !== provider.rpId) {
    throw new PayPaySecError(
      'PayPay Securities passkey RP ID did not match the configured credential',
      'PASSKEY_RP_ID_MISMATCH',
    )
  }

  const assertion = await provider.createAssertion({ challenge, rpId })
  validateAssertion(assertion, { challenge, origin: providerOrigin, rpId })
  await requestBff('credential', '/api/passkey/credential/v1', 'POST', {
    public_key_credential: {
      authenticatorAttachment: assertion.authenticatorAttachment ?? 'platform',
      clientExtensionResults: assertion.clientExtensionResults ?? {},
      id: assertion.id,
      rawId: assertion.rawId,
      response: {
        authenticatorData: assertion.authenticatorData,
        clientDataJSON: assertion.clientDataJSON,
        signature: assertion.signature,
        userHandle: assertion.userHandle,
      },
      type: 'public-key',
    },
    temp_id: tempId,
  })
  await requestBff('complete', '/api/passkey/complete/v1', 'POST', { temp_id: tempId })

  const callbackJar = new CookieJar({ ...webJar.export(), ...authJar.export() })
  await completeWebLogin(fetch, callbackJar, endpoints.baseURL, providerOrigin)

  const cookies = Object.fromEntries(
    Object.entries(callbackJar.export()).filter(
      ([name]) => !name.startsWith(TRANSIENT_AUTH_COOKIE_PREFIX),
    ),
  )
  return createPayPaySecClient({
    accountId: clientOptions.accountId,
    baseURL: endpoints.baseURL,
    cookies,
    fetch,
  })
}

const resolvePasskeyProvider = (options: LoginWithPasskeyOptions): PasskeyAssertionProvider => {
  if ('passkeyProvider' in options && options.passkeyProvider) return options.passkeyProvider
  if ('passkeyCredential' in options && options.passkeyCredential) {
    return createStoredCredentialPasskeyProvider(options.passkeyCredential)
  }
  throw new PayPaySecError(
    'passkeyCredential or passkeyProvider is required',
    'MISSING_PASSKEY_CREDENTIAL',
  )
}

const resolveEndpointConfig = (options: LoginWithPasskeyOptions): PasskeyEndpointConfig => {
  const baseURL = options.baseURL?.toString() ?? process.env.PAYPAY_SEC_BASE_URL
  const passkeyBffBaseURL =
    options.passkeyBffBaseURL?.toString() ?? process.env.PAYPAY_SEC_PASSKEY_BFF_BASE_URL
  if (!baseURL?.trim()) {
    throw new PayPaySecError('baseURL is required', 'MISSING_CONFIGURATION')
  }
  if (!passkeyBffBaseURL?.trim()) {
    throw new PayPaySecError('passkeyBffBaseURL is required', 'MISSING_CONFIGURATION')
  }
  return {
    baseURL: normalizePayPaySecOrigin(baseURL),
    passkeyBffBaseURL: normalizePayPaySecOrigin(passkeyBffBaseURL),
  }
}

const validatePasskeyProvider = (provider: PasskeyAssertionProvider) => {
  if (!provider.rpId || !/^[a-z0-9.-]+$/i.test(provider.rpId)) {
    throw new PayPaySecError('passkey provider has an invalid RP ID', 'INVALID_PASSKEY_CREDENTIAL')
  }
  let origin: URL
  try {
    origin = new URL(provider.origin)
  } catch (cause) {
    throw new PayPaySecError(
      'passkey provider has an invalid origin',
      'INVALID_PASSKEY_CREDENTIAL',
      { cause },
    )
  }
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (origin.hostname !== provider.rpId && !origin.hostname.endsWith(`.${provider.rpId}`))
  ) {
    throw new PayPaySecError(
      'passkey provider origin is not an HTTPS origin within its RP ID',
      'PASSKEY_ORIGIN_MISMATCH',
    )
  }
  return origin.origin
}

const createBffRequester =
  (options: {
    baseURL: string
    deviceId: string
    deviceName: string
    fetch: PayPaySecFetch
    jar: CookieJar
    origin: string
    timeZone: string
  }) =>
  async (
    phase: PasskeyPhase,
    path: string,
    method: 'DELETE' | 'POST',
    body: JsonRecord,
  ): Promise<JsonRecord> => {
    const url = new URL(path, options.baseURL)
    url.searchParams.set('action', PASSKEY_ACTION)
    const response = await fetchWithCookies(options.fetch, options.jar, url, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'app-id': PASSKEY_APP_ID,
        'content-type': 'application/json',
        'device-id': options.deviceId,
        'device-name': options.deviceName,
        origin: options.origin,
        referer: `${options.origin}/`,
        'time-zone': options.timeZone,
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let value: unknown
    try {
      value = text ? JSON.parse(text) : null
    } catch (cause) {
      if (!response.ok) {
        throw new PayPaySecError(
          `PayPay Securities passkey ${phase} failed: HTTP ${response.status}`,
          'PASSKEY_BFF_REJECTED',
          { cause },
        )
      }
      throw new PayPaySecError(
        `PayPay Securities passkey ${phase} returned invalid JSON`,
        'INVALID_PASSKEY_RESPONSE',
        { cause },
      )
    }
    const businessCode = findBusinessErrorCode(value)
    if (!response.ok || businessCode) {
      throw new PayPaySecError(
        businessCode
          ? `PayPay Securities passkey ${phase} was rejected: ${businessCode}`
          : `PayPay Securities passkey ${phase} failed: HTTP ${response.status}`,
        'PASSKEY_BFF_REJECTED',
      )
    }
    return requiredRecord(value, `${phase} response`)
  }

const findBusinessErrorCode = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as JsonRecord
  if (typeof record.business_error_code === 'string' && record.business_error_code) {
    return record.business_error_code
  }
  if (record.halfsheet_error) {
    return (
      findBusinessErrorCode(record.halfsheet_error) ??
      (typeof record.halfsheet_error === 'string' ? record.halfsheet_error : 'halfsheet_error')
    )
  }
  return findBusinessErrorCode(record.error)
}

const completeWebLogin = async (
  fetch: PayPaySecFetch,
  jar: CookieJar,
  baseURL: string,
  passkeyOrigin: string,
) => {
  let url = new URL('/login/passkey/callback?passkey_status=success', baseURL)
  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    const response = await fetchWithCookies(fetch, jar, url, {
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: `${passkeyOrigin}/`,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new PayPaySecError(
          'PayPay Securities passkey callback redirect did not include Location',
          'INVALID_PASSKEY_CALLBACK',
        )
      }
      const nextURL = new URL(location, url)
      if (nextURL.origin !== baseURL) {
        throw new PayPaySecError(
          'PayPay Securities passkey callback attempted a cross-origin redirect',
          'INVALID_PASSKEY_CALLBACK',
        )
      }
      await response.arrayBuffer()
      url = nextURL
      continue
    }
    await response.arrayBuffer()
    if (response.ok && url.pathname === '/trade/') return
    throw new PayPaySecError(
      `PayPay Securities passkey callback failed: HTTP ${response.status}`,
      'PASSKEY_CALLBACK_FAILED',
    )
  }
  throw new PayPaySecError(
    'PayPay Securities passkey callback exceeded the redirect limit',
    'INVALID_PASSKEY_CALLBACK',
  )
}

const fetchWithCookies = async (
  fetch: PayPaySecFetch,
  jar: CookieJar,
  url: URL,
  init: RequestInit,
) => {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (cause) {
    throw new PayPaySecError('PayPay Securities passkey network request failed', 'NETWORK_ERROR', {
      cause,
    })
  }
  jar.apply(response)
  return response
}

const validateAssertion = (
  assertion: WebAuthnAssertion,
  expected: { challenge: string; origin: string; rpId: string },
) => {
  requiredBase64Url(assertion.id, 'assertion.id')
  requiredBase64Url(assertion.rawId, 'assertion.rawId')
  requiredBase64Url(assertion.authenticatorData, 'assertion.authenticatorData')
  requiredBase64Url(assertion.clientDataJSON, 'assertion.clientDataJSON')
  requiredBase64Url(assertion.signature, 'assertion.signature')
  if (assertion.userHandle) requiredBase64Url(assertion.userHandle, 'assertion.userHandle')
  if (assertion.id !== assertion.rawId) {
    throw new PayPaySecError(
      'passkey assertion id and rawId did not match',
      'INVALID_PASSKEY_ASSERTION',
    )
  }
  const authenticatorData = Buffer.from(assertion.authenticatorData, 'base64url')
  if (authenticatorData.length < 37) {
    throw new PayPaySecError(
      'passkey assertion authenticatorData was too short',
      'INVALID_PASSKEY_ASSERTION',
    )
  }
  const expectedRpIdHash = createHash('sha256').update(expected.rpId).digest()
  const flags = authenticatorData[32] ?? 0
  if (
    !authenticatorData.subarray(0, 32).equals(expectedRpIdHash) ||
    (flags & 0x01) === 0 ||
    (flags & 0x04) === 0
  ) {
    throw new PayPaySecError(
      'passkey assertion authenticator data did not satisfy the RP and user verification request',
      'INVALID_PASSKEY_ASSERTION',
    )
  }
  let clientData: JsonRecord
  try {
    clientData = requiredRecord(
      JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString('utf8')),
      'assertion.clientDataJSON',
    )
  } catch (cause) {
    if (cause instanceof PayPaySecError) throw cause
    throw new PayPaySecError(
      'passkey assertion clientDataJSON was invalid',
      'INVALID_PASSKEY_ASSERTION',
      { cause },
    )
  }
  if (
    clientData.type !== 'webauthn.get' ||
    clientData.challenge !== expected.challenge ||
    clientData.origin !== expected.origin ||
    clientData.crossOrigin !== false
  ) {
    throw new PayPaySecError(
      'passkey assertion client data did not match the request',
      'INVALID_PASSKEY_ASSERTION',
    )
  }
}

const requiredBase64Url = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PayPaySecError(`${name} was not valid Base64URL`, 'INVALID_PASSKEY_ASSERTION')
  }
  return value
}

const requiredRecord = (value: unknown, name: string): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayPaySecError(`PayPay Securities did not return ${name}`, 'INVALID_PASSKEY_RESPONSE')
  }
  return value as JsonRecord
}

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value) {
    throw new PayPaySecError(`PayPay Securities did not return ${name}`, 'INVALID_PASSKEY_RESPONSE')
  }
  return value
}

const safeMetadata = (value: string, name: string) => {
  const hasUnsafeCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f || character === ';' || character === ','
  })
  if (!value || hasUnsafeCharacter) {
    throw new PayPaySecError(`${name} contains invalid characters`, 'INVALID_ARGUMENT')
  }
  return value
}
