import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  sign,
  constants,
} from 'node:crypto'
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createMethodsFromSession, registerDeviceId } from '../methods'
import { mtsMarketToDomestic } from '../markets'
import type {
  AccountProfile,
  ForeignStockEndpointConfig,
  ForeignStockSession,
  LoginWithPasskeyOptions,
  PasskeyLoginResponse,
  PlaintextStoredWebAuthnCredential,
  SbiClientOptions,
  SbiSession,
} from '../types'
import type { SbiClientMethods } from '../methods/types'

interface PasskeyLoginStart {
  url: string
  privateKeyPem: string
  publicKey: string
}

interface PasskeyAccessToken {
  callbackUrl: string
  accessToken: string
}

interface CredentialRequest {
  challenge: string
  rpId: string
  csrfToken?: string
}

interface SbiEndpointConfig {
  authBaseUrl: string
  mtsBaseUrl: string
  izanagiBaseUrl?: string
  foreignStock?: ForeignStockEndpointConfig
  mainSiteBaseUrl?: string
  mainSiteEtGatePath?: string
  mainSiteAssetsValuationsPath?: string
  mainSiteExchangeOrderInputPath?: string
  mainSiteExchangeOrderPasswordPath?: string
  mainSiteExchangeOrderConfirmPath?: string
  mainSiteExchangeOrderCompletePath?: string
}

const MAIN_SITE_DEFAULT_PATHS = {
  etGate: '/ETGate/',
  assetsValuations: '/account/api/assets/valuations/current',
  exchangeOrderInput: '/exchange/order/input',
  exchangeOrderPassword: '/exchange/api/order/input/password',
  exchangeOrderConfirm: '/exchange/order/confirm',
  exchangeOrderComplete: '/exchange/order/complete',
} as const

export const loginWithPasskey = async (
  options: LoginWithPasskeyOptions,
  clientOptions: SbiClientOptions = {},
): Promise<SbiClientMethods> => {
  const session = await createPasskeySession(options, clientOptions)
  return createMethodsFromSession(session)
}

export const createPasskeySession = async (
  options: LoginWithPasskeyOptions,
  clientOptions: SbiClientOptions = {},
): Promise<SbiSession> => {
  const endpoints = resolveSbiEndpointConfig(options)
  const domesticAccess = await requestPasskeyAccessToken({
    authBaseUrl: endpoints.authBaseUrl,
    passkeyCredential: options.passkeyCredential,
    channel: 'kabu-app',
  })
  const loginResponse = await finishPasskeyLogin({
    accessToken: domesticAccess.accessToken,
    mtsBaseUrl: endpoints.mtsBaseUrl,
  })
  const profile = parsePasskeyLoginProfile(loginResponse)
  const foreignStock = endpoints.foreignStock
    ? await createForeignStockSession(
        endpoints.foreignStock,
        (
          await requestPasskeyAccessToken({
            authBaseUrl: endpoints.authBaseUrl,
            passkeyCredential: options.passkeyCredential,
            channel: 'foreign-kabu-app',
          })
        ).accessToken,
      )
    : undefined
  const session: SbiSession = {
    mtsBaseUrl: endpoints.mtsBaseUrl,
    izanagiBaseUrl: endpoints.izanagiBaseUrl,
    foreignStock,
    mainSite: endpoints.mainSiteBaseUrl
      ? {
          baseUrl: endpoints.mainSiteBaseUrl,
          etGatePath: endpoints.mainSiteEtGatePath,
          assetsValuationsPath: endpoints.mainSiteAssetsValuationsPath,
          exchangeOrderInputPath: endpoints.mainSiteExchangeOrderInputPath,
          exchangeOrderPasswordPath: endpoints.mainSiteExchangeOrderPasswordPath,
          exchangeOrderConfirmPath: endpoints.mainSiteExchangeOrderConfirmPath,
          exchangeOrderCompletePath: endpoints.mainSiteExchangeOrderCompletePath,
        }
      : undefined,
    profile,
    loginResponse,
    tradePassword: clientOptions.tradePassword,
    tradeAuthentication: clientOptions.tradeAuthentication,
  }
  if (clientOptions.deviceId) {
    await registerDeviceId(session, clientOptions.deviceId)
    session.deviceIdRegistered = true
  }
  return session
}

const resolveSbiEndpointConfig = (options: LoginWithPasskeyOptions): SbiEndpointConfig => {
  const authBaseUrl = options.authBaseUrl ?? process.env.SBI_AUTH_BASE_URL
  const mtsBaseUrl = options.mtsBaseUrl ?? process.env.SBI_MTS_BASE_URL
  const izanagiBaseUrl = options.izanagiBaseUrl ?? process.env.SBI_IZANAGI_BASE_URL
  const foreignStock = resolveForeignStockEndpointConfig(options)
  const mainSiteBaseUrl = options.mainSiteBaseUrl ?? process.env.SBI_MAIN_SITE_BASE_URL
  const mainSiteEtGatePath =
    options.mainSiteEtGatePath ??
    process.env.SBI_MAIN_SITE_ET_GATE_PATH ??
    MAIN_SITE_DEFAULT_PATHS.etGate
  const mainSiteAssetsValuationsPath =
    options.mainSiteAssetsValuationsPath ??
    process.env.SBI_MAIN_SITE_ASSETS_VALUATIONS_PATH ??
    MAIN_SITE_DEFAULT_PATHS.assetsValuations
  const mainSiteExchangeOrderInputPath =
    options.mainSiteExchangeOrderInputPath ??
    process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_INPUT_PATH ??
    MAIN_SITE_DEFAULT_PATHS.exchangeOrderInput
  const mainSiteExchangeOrderPasswordPath =
    options.mainSiteExchangeOrderPasswordPath ??
    process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_PASSWORD_PATH ??
    MAIN_SITE_DEFAULT_PATHS.exchangeOrderPassword
  const mainSiteExchangeOrderConfirmPath =
    options.mainSiteExchangeOrderConfirmPath ??
    process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_CONFIRM_PATH ??
    MAIN_SITE_DEFAULT_PATHS.exchangeOrderConfirm
  const mainSiteExchangeOrderCompletePath =
    options.mainSiteExchangeOrderCompletePath ??
    process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_COMPLETE_PATH ??
    MAIN_SITE_DEFAULT_PATHS.exchangeOrderComplete

  if (!authBaseUrl) throw new Error('SBI_AUTH_BASE_URL is required')
  if (!mtsBaseUrl) throw new Error('SBI_MTS_BASE_URL is required')

  return {
    authBaseUrl,
    mtsBaseUrl,
    izanagiBaseUrl: optionalUrl(izanagiBaseUrl),
    foreignStock,
    mainSiteBaseUrl: optionalUrl(mainSiteBaseUrl),
    mainSiteEtGatePath,
    mainSiteAssetsValuationsPath,
    mainSiteExchangeOrderInputPath,
    mainSiteExchangeOrderPasswordPath,
    mainSiteExchangeOrderConfirmPath,
    mainSiteExchangeOrderCompletePath,
  }
}

const optionalUrl = (value: string | undefined) => {
  if (!value) return undefined
  return new URL(value).toString()
}

const resolveForeignStockEndpointConfig = (
  options: LoginWithPasskeyOptions,
): ForeignStockEndpointConfig | undefined => {
  const baseUrl =
    options.foreignStockBaseUrl ??
    options.usStockBaseUrl ??
    process.env.SBI_FOREIGN_STOCK_BASE_URL ??
    process.env.SBI_US_STOCK_BASE_URL
  const restUrl = options.foreignStockRestUrl ?? process.env.SBI_FOREIGN_STOCK_REST_URL
  const graphqlBffUrl =
    options.foreignStockGraphqlBffUrl ?? process.env.SBI_FOREIGN_STOCK_GRAPHQL_BFF_URL
  const graphqlIntUrl =
    options.foreignStockGraphqlIntUrl ?? process.env.SBI_FOREIGN_STOCK_GRAPHQL_INT_URL
  const userAgent = options.foreignStockUserAgent ?? process.env.SBI_FOREIGN_STOCK_USER_AGENT

  if (!baseUrl && !restUrl && !graphqlBffUrl && !graphqlIntUrl) return undefined
  if (!baseUrl && (!restUrl || !graphqlBffUrl || !graphqlIntUrl)) {
    throw new Error(
      'foreign stock endpoints require foreignStockBaseUrl/usStockBaseUrl or all foreignStockRestUrl, foreignStockGraphqlBffUrl, and foreignStockGraphqlIntUrl',
    )
  }

  return {
    baseUrl: optionalUrl(baseUrl),
    restUrl: optionalUrl(restUrl) ?? requiredDerivedUrl(baseUrl, '/rest/'),
    graphqlBffUrl: optionalUrl(graphqlBffUrl) ?? requiredDerivedUrl(baseUrl, '/graphql/bff'),
    graphqlIntUrl: optionalUrl(graphqlIntUrl) ?? requiredDerivedUrl(baseUrl, '/graphql/int'),
    userAgent: userAgent || 'SBIFStockAndroid/1.6.10(mnie/0)',
  }
}

const requiredDerivedUrl = (baseUrl: string | undefined, path: string) => {
  if (!baseUrl) throw new Error(`foreign stock base URL is required to derive ${path}`)
  return new URL(path, baseUrl).toString()
}

const createForeignStockSession = async (
  endpoints: ForeignStockEndpointConfig,
  ssoToken: string | undefined,
): Promise<ForeignStockSession> => {
  if (!ssoToken) {
    throw new Error('foreign stock SSO login requires a passkey callback access token')
  }

  const response = await fetch(new URL('account/authentication:ssoLogin', endpoints.restUrl), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ssoToken }),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`foreign stock SSO login failed with HTTP ${response.status}: ${text}`)
  }

  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    throw new Error('foreign stock SSO login returned non-JSON response')
  }
  const objectBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const sessionId = response.headers.get('Set-Session') ?? stringField(objectBody, 'sessionId')
  const accountId = response.headers.get('Account-Id') ?? stringField(objectBody, 'accountId')
  if (!sessionId || !accountId) {
    throw new Error('foreign stock SSO login did not return Set-Session and Account-Id')
  }
  const marketPriceHash = await fetchForeignStockMarketPriceHash(endpoints, sessionId, accountId)
  const candleHash = await fetchForeignStockHash(
    endpoints,
    sessionId,
    accountId,
    'information/chart/countries/US/candle_hashes',
    'foreign stock candle hash',
  )

  return {
    endpoints,
    ssoToken,
    sessionId,
    accountId,
    marketPriceHash,
    candleHash,
    loginAuthenticated: true,
  }
}

const fetchForeignStockMarketPriceHash = async (
  endpoints: ForeignStockEndpointConfig,
  sessionId: string,
  accountId: string,
) => {
  return fetchForeignStockHash(
    endpoints,
    sessionId,
    accountId,
    'information/market_price/countries/US/price_hashes',
    'foreign stock market price hash',
  )
}

const fetchForeignStockHash = async (
  endpoints: ForeignStockEndpointConfig,
  sessionId: string,
  accountId: string,
  path: string,
  label: string,
) => {
  const response = await fetch(new URL(path, endpoints.restUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${sessionId}`,
      'account-id': accountId,
      ...(endpoints.userAgent ? { 'user-agent': endpoints.userAgent } : {}),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text}`)
  }

  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    throw new Error(`${label} returned non-JSON response`)
  }
  const objectBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const hashValue = stringField(objectBody, 'hashValue')
  if (!hashValue) {
    throw new Error(`${label} response did not include hashValue`)
  }
  return hashValue
}

const stringField = (object: Record<string, unknown>, key: string) => {
  const value = object[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const requestPasskeyAccessToken = async (options: {
  authBaseUrl: string
  passkeyCredential: PlaintextStoredWebAuthnCredential
  channel: string
}): Promise<PasskeyAccessToken> => {
  const started = startPasskeyLogin(options.authBaseUrl, options.channel)
  const jar = new CookieJar()
  const headers = defaultBrowserHeaders()

  const entry = await fetchWithCookies(started.url, {
    jar,
    headers: {
      ...headers,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'upgrade-insecure-requests': '1',
    },
  })
  const entryText = await entry.text()
  const csrfToken = extractCsrfToken(entryText)

  const challengeUrl = new URL('/api/fido2/auth/challenge', started.url)
  challengeUrl.searchParams.set('cccid', options.channel)
  const challengeResponse = await fetchWithCookies(challengeUrl, {
    jar,
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/javascript, */*; q=0.01',
      origin: new URL(started.url).origin,
      referer: started.url,
      'x-requested-with': 'XMLHttpRequest',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
  })
  assertOk(challengeResponse, `passkey challenge (${options.channel})`)

  const challengeJson = await challengeResponse.json()
  const credentialRequest = normalizeCredentialRequest(challengeJson, options.passkeyCredential)
  const assertion = createWebAuthnAssertion(options.passkeyCredential, credentialRequest)
  const csrf = credentialRequest.csrfToken ?? csrfToken
  if (!csrf) throw new Error(`missing CSRF token for passkey authentication (${options.channel})`)

  const authUrl = new URL('/fido2/auth', started.url)
  authUrl.searchParams.set('cccid', options.channel)
  const authResponse = await fetchWithCookies(authUrl, {
    jar,
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...headers,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      origin: new URL(started.url).origin,
      referer: started.url,
      'upgrade-insecure-requests': '1',
    },
    body: new URLSearchParams({
      _csrf: csrf,
      id: assertion.id,
      rawId: assertion.rawId,
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
      userHandle: assertion.userHandle,
      type: 'public-key',
    }),
  })

  const channelUrl = new URL(
    authResponse.headers.get('location') ?? `/sso/channel?cccid=${options.channel}`,
    started.url,
  )
  const channelResponse = await fetchWithCookies(channelUrl, {
    jar,
    headers: {
      ...headers,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: authUrl.toString(),
      'upgrade-insecure-requests': '1',
    },
  })
  assertOk(channelResponse, `passkey callback (${options.channel})`)

  const channelHtml = await channelResponse.text()
  const callbackUrl = extractCallbackUrl(channelHtml)
  if (!callbackUrl) {
    throw new Error(
      `passkey callback token was not found in sso/channel response (${options.channel})`,
    )
  }

  return {
    callbackUrl,
    accessToken: extractPasskeyAccessToken(callbackUrl, started.privateKeyPem),
  }
}

const startPasskeyLogin = (authBaseUrl: string, channel: string): PasskeyLoginStart => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const publicKeyParam = base64Url(publicKey, true)
  const url = new URL(authBaseUrl)
  url.searchParams.set('channel', channel)
  url.searchParams.set('pk', publicKeyParam)
  url.searchParams.set('ap', 'true')

  return {
    url: url.toString(),
    privateKeyPem: privateKey,
    publicKey: publicKeyParam,
  }
}

const finishPasskeyLogin = async (options: {
  accessToken: string
  mtsBaseUrl: string
}): Promise<PasskeyLoginResponse> => {
  const requestUrl = new URL('/mtsmobile/ssologingate', options.mtsBaseUrl)
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      KIND: 'L',
      TOKEN: options.accessToken,
    }),
  })

  const body = await response.arrayBuffer()
  const text = decodeShiftJis(body)

  return {
    type: 'passkey-login-response',
    requestUrl: requestUrl.toString(),
    status: response.status,
    body,
    text,
    accessToken: options.accessToken,
    header: parseMtsHeader(text),
  }
}

const extractPasskeyAccessToken = (callbackUrl: string, privateKeyPem: string) => {
  const encryptedToken = extractEncryptedToken(callbackUrl)
  if (!encryptedToken) {
    throw new Error('callbackUrl must contain token=...')
  }
  return decryptPasskeyToken(encryptedToken, privateKeyPem)
}

const extractEncryptedToken = (callbackUrl: string) => {
  const url = new URL(callbackUrl)
  if (url.searchParams.get('cmd') === 'pwlogin') return undefined
  return url.searchParams.get('token') ?? undefined
}

const parsePasskeyLoginProfile = (response: PasskeyLoginResponse): AccountProfile => {
  const buffer = Buffer.from(response.body)
  const header = response.header
  let offset = 70

  const loginStatusRaw = readShiftJisField(buffer, offset, 1)
  offset += 1

  if (loginStatusRaw === '7') {
    const trId = readShiftJisField(buffer, offset, 20)
    offset += 20
    const txId = readShiftJisField(buffer, offset, 36)
    offset += 36
    const actionToken = readShiftJisField(buffer, offset, 36)
    offset += 36
    const securityAuthenticationResponseCode = readShiftJisField(buffer, offset, 3)
    offset += 3
    const fidoResponseCode = readShiftJisField(buffer, offset, 4)

    return {
      session: {
        sessionId: header?.sessionId ?? '',
        loginType: 'passkey',
        resultCode: header?.resultCode ?? '',
      },
      loginStatus: mapLoginStatus(loginStatusRaw),
      loginType: 'passkey',
      securityAuthenticationResponseCode: emptyToUndefined(securityAuthenticationResponseCode),
      fidoResponseCode: emptyToUndefined(fidoResponseCode),
      trId: emptyToUndefined(trId),
      txId: emptyToUndefined(txId),
      actionToken: emptyToUndefined(actionToken),
    }
  }

  const butenCode = readShiftJisField(buffer, offset, 3)
  offset += 3
  const accountNumber = readShiftJisField(buffer, offset, 7)
  offset += 7
  const nextField = readShiftJisField(buffer, offset, 2)
  if (isSpecificAccountTypeRaw(nextField)) {
    const specificAccountTypeRaw = nextField
    offset += 2
    const marginAccount = readShiftJisField(buffer, offset, 1)
    offset += 1
    const userId = readShiftJisField(buffer, offset, 32)
    offset += 32
    const nisaAccountRaw = readShiftJisField(buffer, offset, 1)
    offset += 1
    const jrNisaAccount = readShiftJisField(buffer, offset, 1)
    offset += 1
    const jrNisaSpecificRaw = readShiftJisField(buffer, offset, 2)
    offset += 2
    const jrNisaSeigen = readShiftJisField(buffer, offset, 1)
    offset += 1
    const sorDefaultCode = readShiftJisField(buffer, offset, 1)
    offset += 1
    const sorLastMarket = readShiftJisField(buffer, offset, 3)
    offset += 3
    const sorLastMarketJrNisa = readShiftJisField(buffer, offset, 3)
    offset += 3
    const importantNoticeFlag = readShiftJisField(buffer, offset, 1)
    offset += 1
    const noticeCount = parseIntOrUndefined(readShiftJisField(buffer, offset, 8))
    offset += 8
    const restrictedTradeFlag = readShiftJisField(buffer, offset, 1)
    offset += 1
    const deficitMessageFlag = readShiftJisField(buffer, offset, 1)
    offset += 1
    const deficitMessage = readShiftJisField(buffer, offset, 1500)
    offset += 1500
    const referenceableMaintenanceFlag = readShiftJisField(buffer, offset, 1)

    return {
      session: {
        sessionId: header?.sessionId ?? '',
        loginType: 'passkey',
        resultCode: header?.resultCode ?? '',
      },
      branchCode: emptyToUndefined(butenCode),
      butenCode: emptyToUndefined(butenCode),
      accountNumber: emptyToUndefined(accountNumber),
      userId: emptyToUndefined(userId),
      loginStatus: mapLoginStatus(loginStatusRaw),
      loginType: 'passkey',
      accountType: mapSpecificAccountToAccountType(specificAccountTypeRaw),
      specificAccountType: mapSpecificAccountType(specificAccountTypeRaw),
      hasMarginAccount: marginAccount === '1',
      marginAccount: emptyToUndefined(marginAccount),
      nisa: {
        enabled: nisaAccountRaw !== '0' && nisaAccountRaw !== '',
        tradePermitted: nisaAccountRaw === '1' || nisaAccountRaw === '2' || nisaAccountRaw === '3',
        juniorEnabled: jrNisaAccount === '1',
        accountType: mapIsaAccountType(nisaAccountRaw),
        jrNisaAccount: emptyToUndefined(jrNisaAccount),
        jrNisaSpecific: mapSpecificAccountType(jrNisaSpecificRaw),
        jrNisaSeigen: emptyToUndefined(jrNisaSeigen),
      },
      sor: {
        defaultEnabled: sorDefaultCode === '1',
        defaultCode: emptyToUndefined(sorDefaultCode),
        lastMarket: mtsMarketToDomestic(emptyToUndefined(sorLastMarket)),
        juniorNisaLastMarket: mtsMarketToDomestic(emptyToUndefined(sorLastMarketJrNisa)),
      },
      notices: {
        hasImportantNotice: importantNoticeFlag === '1',
        importantNoticeFlag: emptyToUndefined(importantNoticeFlag),
        count: noticeCount,
      },
      restrictions: {
        tradeRestricted: restrictedTradeFlag === '1',
        restrictedTradeFlag: emptyToUndefined(restrictedTradeFlag),
      },
      deficit: {
        hasMessage: deficitMessageFlag === '1',
        messageFlag: emptyToUndefined(deficitMessageFlag),
        message: emptyToUndefined(deficitMessage),
      },
      maintenance: {
        referenceable: referenceableMaintenanceFlag === '1',
        referenceableMaintenanceFlag: emptyToUndefined(referenceableMaintenanceFlag),
      },
    }
  }
  const expireDate = readShiftJisField(buffer, offset, 8)
  offset += 8
  const lastLoginDate = readShiftJisField(buffer, offset, 8)
  offset += 8
  const lastLoginTime = readShiftJisField(buffer, offset, 6)
  offset += 6
  const corporateFlag = readShiftJisField(buffer, offset, 1)
  offset += 1
  const specificAccountTypeRaw = readShiftJisField(buffer, offset, 2)
  offset += 2
  const marginAccount = readShiftJisField(buffer, offset, 1)
  offset += 1
  const commissionPlan = readShiftJisField(buffer, offset, 1)
  offset += 1
  const userId = readShiftJisField(buffer, offset, 32)
  offset += 32
  const deficitMessage = readShiftJisField(buffer, offset, 1500)
  offset += 1500
  const tradingPassword = readShiftJisField(buffer, offset, 32)
  offset += 32
  const importantNoticeFlag = readShiftJisField(buffer, offset, 1)
  offset += 1
  const restrictedTradeFlag = readShiftJisField(buffer, offset, 1)
  offset += 1
  const noticeCount = parseIntOrUndefined(readShiftJisField(buffer, offset, 8))
  offset += 8
  const restrictedMessage = readShiftJisField(buffer, offset, 500)
  offset += 500
  const fxShareCol = readShiftJisField(buffer, offset, 1)
  offset += 1
  const deficitMessageFlag = readShiftJisField(buffer, offset, 1)
  offset += 1
  const nisaAccountRaw = readShiftJisField(buffer, offset, 1)
  offset += 1
  const jrNisaAccount = readShiftJisField(buffer, offset, 1)
  offset += 1
  const jrNisaSpecificRaw = readShiftJisField(buffer, offset, 2)
  offset += 2
  const jrNisaSeigen = readShiftJisField(buffer, offset, 1)
  offset += 1
  const fullTerm = readShiftJisField(buffer, offset, 8)
  offset += 8
  const fullAccount = readShiftJisField(buffer, offset, 1)
  offset += 1
  offset += 8
  offset += 1
  const sorDefaultCode = readShiftJisField(buffer, offset, 1)
  offset += 1
  const sorLastMarket = readShiftJisField(buffer, offset, 3)
  offset += 3
  const sorLastMarketJrNisa = readShiftJisField(buffer, offset, 3)
  offset += 3
  const securityAuthenticationResponseCode = readShiftJisField(buffer, offset, 3)
  offset += 3
  const fidoResponseCode = readShiftJisField(buffer, offset, 4)
  offset += 4
  const referenceableMaintenanceFlag = readShiftJisField(buffer, offset, 1)
  offset += 1
  const passkeyStatus = readShiftJisField(buffer, offset, 1)

  return {
    session: {
      sessionId: header?.sessionId ?? '',
      loginType: 'passkey',
      resultCode: header?.resultCode ?? '',
    },
    branchCode: emptyToUndefined(butenCode),
    butenCode: emptyToUndefined(butenCode),
    accountNumber: emptyToUndefined(accountNumber),
    userId: emptyToUndefined(userId),
    loginStatus: mapLoginStatus(loginStatusRaw),
    loginType: 'passkey',
    accountType: mapSpecificAccountToAccountType(specificAccountTypeRaw),
    specificAccountType: mapSpecificAccountType(specificAccountTypeRaw),
    hasMarginAccount: marginAccount === '1',
    marginAccount: emptyToUndefined(marginAccount),
    corporateFlag: emptyToUndefined(corporateFlag),
    commissionPlan: emptyToUndefined(commissionPlan),
    expireDate: emptyToUndefined(expireDate),
    lastLoginDate: emptyToUndefined(lastLoginDate),
    lastLoginTime: emptyToUndefined(lastLoginTime),
    tradingPassword: emptyToUndefined(tradingPassword),
    fxShareCol: emptyToUndefined(fxShareCol),
    fullTerm: emptyToUndefined(fullTerm),
    fullAccount: emptyToUndefined(fullAccount),
    securityAuthenticationResponseCode: emptyToUndefined(securityAuthenticationResponseCode),
    fidoResponseCode: emptyToUndefined(fidoResponseCode),
    passkeyStatus: emptyToUndefined(passkeyStatus),
    nisa: {
      enabled: nisaAccountRaw !== '0' && nisaAccountRaw !== '',
      tradePermitted: nisaAccountRaw === '1' || nisaAccountRaw === '2' || nisaAccountRaw === '3',
      juniorEnabled: jrNisaAccount === '1',
      accountType: mapIsaAccountType(nisaAccountRaw),
      jrNisaAccount: emptyToUndefined(jrNisaAccount),
      jrNisaSpecific: mapSpecificAccountType(jrNisaSpecificRaw),
      jrNisaSeigen: emptyToUndefined(jrNisaSeigen),
    },
    sor: {
      defaultEnabled: sorDefaultCode === '1',
      defaultCode: emptyToUndefined(sorDefaultCode),
      lastMarket: mtsMarketToDomestic(emptyToUndefined(sorLastMarket)),
      juniorNisaLastMarket: mtsMarketToDomestic(emptyToUndefined(sorLastMarketJrNisa)),
    },
    notices: {
      hasImportantNotice: importantNoticeFlag === '1',
      importantNoticeFlag: emptyToUndefined(importantNoticeFlag),
      count: noticeCount,
    },
    restrictions: {
      tradeRestricted: restrictedTradeFlag === '1',
      restrictedTradeFlag: emptyToUndefined(restrictedTradeFlag),
      message: emptyToUndefined(restrictedMessage),
    },
    deficit: {
      hasMessage: deficitMessageFlag === '1',
      messageFlag: emptyToUndefined(deficitMessageFlag),
      message: emptyToUndefined(deficitMessage),
    },
    maintenance: {
      referenceable: referenceableMaintenanceFlag === '1',
      referenceableMaintenanceFlag: emptyToUndefined(referenceableMaintenanceFlag),
    },
  }
}

const readShiftJisField = (buffer: Buffer, offset: number, length: number) => {
  if (offset >= buffer.length) return ''
  return decodeShiftJis(buffer.subarray(offset, Math.min(offset + length, buffer.length)))
    .replaceAll('\u0000', '')
    .trim()
}

const emptyToUndefined = (value: string) => (value.length > 0 ? value : undefined)

const parseIntOrUndefined = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const mapLoginStatus = (value: string): AccountProfile['loginStatus'] => {
  switch (value) {
    case '0':
      return 'success'
    case '1':
      return 'invalidUser'
    case '2':
      return 'tradeForbidden'
    case '5':
      return 'locked'
    case '6':
      return 'fidoAuthorizationIncorrect'
    case '7':
      return 'fidoAuthorization'
    case '8':
      return 'passwordChangeRequired'
    default:
      return 'unknown'
  }
}

const mapSpecificAccountType = (value: string): AccountProfile['specificAccountType'] => {
  switch (value) {
    case '00':
      return 'withHolding'
    case '01':
      return 'withoutHolding'
    case '10':
      return 'nonSpecific'
    case '-':
      return 'notApply'
    default:
      return 'unknown'
  }
}

const isSpecificAccountTypeRaw = (value: string) =>
  value === '00' || value === '01' || value === '10' || value === '-'

const mapSpecificAccountToAccountType = (value: string): AccountProfile['accountType'] => {
  switch (mapSpecificAccountType(value)) {
    case 'withHolding':
    case 'withoutHolding':
      return 'specific'
    case 'nonSpecific':
      return 'general'
    default:
      return 'unknown'
  }
}

const mapIsaAccountType = (value: string): NonNullable<AccountProfile['nisa']>['accountType'] => {
  switch (value) {
    case '0':
      return 'nisaTradeForbidden'
    case '1':
      return 'oldNisaTradePermitted'
    case '2':
      return 'newNisaTradePermitted'
    case '3':
      return 'nisaTradePermitted'
    default:
      return 'unknown'
  }
}

const defaultBrowserHeaders = () => ({
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent':
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
})

class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie
    const values = getSetCookie
      ? getSetCookie.call(response.headers)
      : splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const index = pair.indexOf('=')
      if (index <= 0) continue
      this.#cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

const fetchWithCookies = async (input: string | URL, init: RequestInit & { jar: CookieJar }) => {
  const cookie = init.jar.header()
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(input, { ...init, headers })
  init.jar.apply(response)
  return response
}

const splitSetCookie = (header: string | null) => {
  if (!header) return []
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim())
}

const assertOk = (response: Response, label: string) => {
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`)
  }
}

const extractCsrfToken = (html: string) => {
  const patterns = [
    /<meta[^>]+name=["']_csrf["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']_csrf["']/i,
    /<input[^>]+name=["']_csrf["'][^>]+value=["']([^"']+)["']/i,
    /["']_csrf["']\s*:\s*["']([^"']+)["']/i,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return htmlDecode(match[1])
  }
  return undefined
}

const normalizeCredentialRequest = (
  challengeJson: unknown,
  credential: PlaintextStoredWebAuthnCredential,
): CredentialRequest => {
  const root = challengeJson as Record<string, unknown>
  const data =
    pickObject(root.data) ??
    pickObject(root.publicKey) ??
    pickObject(root.publicKeyCredentialRequestOptions) ??
    root
  const publicKey =
    pickObject(data.publicKey) ?? pickObject(data.publicKeyCredentialRequestOptions) ?? data
  const challenge = pickString(publicKey.challenge) ?? pickString(data.challenge)
  if (!challenge) throw new Error('passkey challenge response did not include challenge')

  return {
    challenge,
    rpId: pickString(publicKey.rpId) ?? credential.rpId,
    csrfToken:
      pickString(root.csrfToken) ??
      pickString(root._csrf) ??
      pickString(data.csrfToken) ??
      pickString(data._csrf) ??
      pickString(publicKey.csrfToken) ??
      pickString(publicKey._csrf),
  }
}

const pickObject = (value: unknown) => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const pickString = (value: unknown) => {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const createWebAuthnAssertion = (
  credential: PlaintextStoredWebAuthnCredential,
  request: CredentialRequest,
) => {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: request.challenge,
      origin: credential.origin,
      crossOrigin: false,
    }),
  )
  const signCount =
    credential.authenticator.signCount > 0 ? credential.authenticator.signCount + 1 : 0
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(request.rpId).digest(),
    Buffer.from([assertionFlags(credential)]),
    uint32be(signCount),
  ])
  const signedData = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataJSON).digest(),
  ])
  const key = createPrivateKey({
    key: credential.secretPlaintext.privateKey.jwk,
    format: 'jwk',
  })
  const signature = sign('sha256', signedData, key)

  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    clientDataJSON: base64Url(clientDataJSON),
    authenticatorData: base64Url(authenticatorData),
    signature: base64Url(signature),
    userHandle: credential.userHandle ?? '',
  }
}

const assertionFlags = (credential: PlaintextStoredWebAuthnCredential) => {
  let flags = 0x01
  if (credential.authenticator.userVerification !== 'discouraged') flags |= 0x04
  if (credential.authenticator.backupEligible) flags |= 0x08
  if (credential.authenticator.backupState) flags |= 0x10
  return flags
}

const uint32be = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

const extractCallbackUrl = (html: string) => {
  const match =
    html.match(/[a-z][a-z0-9+.-]*:\\\/\\\/auth\\\/callback\?token=[^"'<\\]+/i) ??
    html.match(/[a-z][a-z0-9+.-]*:\/\/auth\/callback\?token=[^"'<\\]+/i)
  if (!match) return undefined
  return match[0].replaceAll('\\/', '/')
}

const htmlDecode = (value: string) => {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const decryptPasskeyToken = (encryptedToken: string, privateKeyPem: string) => {
  const encrypted = base64UrlToBuffer(encryptedToken)
  const openssl = decryptWithOpenSsl(encrypted, privateKeyPem)
  if (openssl) return openssl.toString('utf8')

  return rsaOaepSha256Mgf1Sha1Decrypt(encrypted, privateKeyPem).toString('utf8')
}

const decryptWithOpenSsl = (encrypted: Buffer, privateKeyPem: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'sbi-passkey-'))
  const keyPath = join(dir, 'private.pem')
  try {
    writeFileSync(keyPath, privateKeyPem, { mode: 0o600 })
    const result = spawnSync(
      'openssl',
      [
        'pkeyutl',
        '-decrypt',
        '-inkey',
        keyPath,
        '-pkeyopt',
        'rsa_padding_mode:oaep',
        '-pkeyopt',
        'rsa_oaep_md:sha256',
        '-pkeyopt',
        'rsa_mgf1_md:sha1',
      ],
      { input: encrypted },
    )
    if (result.status !== 0) return undefined
    return result.stdout
  } finally {
    try {
      unlinkSync(keyPath)
    } catch {
      // ignore cleanup errors
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

const base64Url = (data: Buffer, keepPadding = false) => {
  const encoded = data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  return keepPadding ? encoded : encoded.replace(/=+$/g, '')
}

const base64UrlToBuffer = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
}

const rsaOaepSha256Mgf1Sha1Decrypt = (encrypted: Buffer, privateKeyPem: string) => {
  const encodedMessage = privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_NO_PADDING,
    },
    encrypted,
  )
  return oaepUnpad(encodedMessage, 'sha256', 'sha1')
}

const oaepUnpad = (encodedMessage: Buffer, labelHashName: 'sha256', mgfHashName: 'sha1') => {
  const labelHash = createHash(labelHashName).update(Buffer.alloc(0)).digest()
  const hashLength = labelHash.length

  if (encodedMessage.length < 2 * hashLength + 2 || encodedMessage[0] !== 0) {
    throw new Error('invalid OAEP block')
  }

  const maskedSeed = encodedMessage.subarray(1, 1 + hashLength)
  const maskedDb = encodedMessage.subarray(1 + hashLength)
  const seedMask = mgf1(maskedDb, hashLength, mgfHashName)
  const seed = xor(maskedSeed, seedMask)
  const dbMask = mgf1(seed, maskedDb.length, mgfHashName)
  const db = xor(maskedDb, dbMask)

  if (!db.subarray(0, hashLength).equals(labelHash)) {
    throw new Error('invalid OAEP label hash')
  }

  let index = hashLength
  while (index < db.length && db[index] === 0) index++
  if (db[index] !== 1) {
    throw new Error('invalid OAEP delimiter')
  }
  return db.subarray(index + 1)
}

const mgf1 = (seed: Buffer, length: number, hashName: 'sha1') => {
  const chunks: Buffer[] = []
  for (let counter = 0; Buffer.concat(chunks).length < length; counter++) {
    const c = Buffer.alloc(4)
    c.writeUInt32BE(counter, 0)
    chunks.push(createHash(hashName).update(seed).update(c).digest())
  }
  return Buffer.concat(chunks).subarray(0, length)
}

const xor = (left: Buffer, right: Buffer) => {
  if (left.length !== right.length) throw new Error('xor length mismatch')
  const out = Buffer.alloc(left.length)
  for (let i = 0; i < left.length; i++) out[i] = left[i]! ^ right[i]!
  return out
}

const decodeShiftJis = (body: ArrayBuffer | Uint8Array) => {
  try {
    return new TextDecoder('shift-jis' as ConstructorParameters<typeof TextDecoder>[0]).decode(body)
  } catch {
    return (
      body instanceof ArrayBuffer
        ? Buffer.from(body)
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    ).toString('binary')
  }
}

const parseMtsHeader = (text: string) => {
  if (text.length < 70) return null
  return {
    sessionId: text.slice(6, 34).trim(),
    trCode: text.slice(34, 39).trim(),
    resultCode: text.slice(45, 51).trim(),
  }
}
