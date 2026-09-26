import { createHash } from 'node:crypto'
import { encryptPayload, type KeyOptions } from './crypto'

/**
 * Builds the cleartext that goes inside the auth envelope.
 *
 * Reverse-engineered from `BaseAuthAPI` (which ships encrypted in
 * `assets/fjcnwlye`, not in the APK's DEX files). Eight `|`-separated fields:
 *
 *   1. login id, or the saved token when re-authenticating
 *   2. password — empty when re-authenticating
 *   3. device id, run through {@link deviceIdCheckDigit}
 *   4. device token (the app's FCM registration token)
 *   5. always empty
 *   6. card company code, `001` for SMBC
 *   7. unix time in *seconds*
 *   8. SHA-256 hex over a concatenation that differs per mode
 */

/** `EncryptedMethods.f3` — also the split character in the auth response. */
export const FIELD_DELIMITER = '|'

/** SMBC. Other issuers on the shared platform use their own code. */
export const DEFAULT_CARD_COMPANY_CODE = '001'

export type LoginIdKind = 'vpass' | 'fa'

/**
 * `id_type` as the request carries it. The app stores the user's choice as
 * 1=VPass / 2=FA and inverts it on the way out, so the wire value is the
 * opposite of the stored one.
 */
export const idTypeFor = (kind: LoginIdKind): number => (kind === 'fa' ? 1 : 2)

/**
 * Rewrites a device UUID the way the app does before sending it.
 *
 * Strips the dashes, reads the result as a hex integer, renders it as a decimal
 * string zero-padded to 39 digits, then folds that with weights cycling 2..7
 * from the right. `sum % 11` becomes a check digit (0 when the remainder is 0
 * or 1, otherwise `11 - remainder`). Finally the character at index 8 is
 * dropped and the digit is inserted four characters from the end.
 */
export const deviceIdCheckDigit = (deviceId: string): string => {
  const digits = BigInt(`0x${deviceId.replaceAll('-', '')}`)
    .toString()
    .padStart(39, '0')

  let sum = 0
  let weight = 2
  for (let index = digits.length - 1; index >= 0; index--) {
    sum += Number(digits[index]) * weight
    weight = weight === 7 ? 2 : weight + 1
  }

  const remainder = sum % 11
  const check = remainder > 1 ? 11 - remainder : 0

  const withoutSeparator = deviceId.slice(0, 8) + deviceId.slice(9)
  const insertAt = deviceId.length - 4
  return withoutSeparator.slice(0, insertAt) + check + withoutSeparator.slice(insertAt)
}

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export interface CredentialLogin {
  mode: 'credential'
  /** VPass ID or FA ID, matching `idKind`. */
  loginId: string
  password: string
  idKind: LoginIdKind
}

export interface TokenLogin {
  mode: 'token'
  /** `login_token` from a previous successful auth response. */
  token: string
  idKind: LoginIdKind
}

export type LoginMethod = CredentialLogin | TokenLogin

export interface AuthPayloadContext {
  /** Device UUID. Stable per installation; generate once and keep it. */
  deviceId: string
  /** The app sends its FCM registration token here. Empty when unavailable. */
  deviceToken: string
  cardCompanyCode?: string
  /** Unix seconds. Injected so the builder stays deterministic under test. */
  issuedAt?: number
}

export const buildAuthPlaintext = (method: LoginMethod, context: AuthPayloadContext): string => {
  const cardCompanyCode = context.cardCompanyCode ?? DEFAULT_CARD_COMPANY_CODE
  const issuedAt = context.issuedAt ?? Math.floor(Date.now() / 1000)

  const identifier = method.mode === 'credential' ? method.loginId : method.token
  const password = method.mode === 'credential' ? method.password : ''

  // The digest inputs are not a rotation of the same list — the two modes order
  // and select different fields, so they are spelled out separately.
  const digestInput =
    method.mode === 'credential'
      ? `${password}${issuedAt}${identifier}${cardCompanyCode}`
      : `${cardCompanyCode}${issuedAt}${identifier}`

  return [
    identifier,
    password,
    deviceIdCheckDigit(context.deviceId),
    context.deviceToken,
    '',
    cardCompanyCode,
    String(issuedAt),
    sha256Hex(digestInput),
  ].join(FIELD_DELIMITER)
}

export interface AuthRequestBody {
  auth: string
  is_first_login: number
  push: number
  auto_login: number
  os_type: number
  id_type?: number
}

export interface BuildAuthRequestOptions extends AuthPayloadContext, KeyOptions {
  /** Whether the account has push notifications enabled. */
  push?: boolean
  /** Include `id_type`; the `Fauth` endpoint takes it, `Vauth` does not. */
  includeIdType?: boolean
}

/**
 * Assembles the JSON body for `Vauth` / `Fauth`.
 *
 * `is_first_login` and `auto_login` are not independent flags: the app derives
 * both from whether it is presenting credentials or a saved token, so they are
 * always each other's inverse here.
 */
export const buildAuthRequest = (
  method: LoginMethod,
  options: BuildAuthRequestOptions,
): AuthRequestBody => {
  const credential = method.mode === 'credential'
  const body: AuthRequestBody = {
    auth: encryptPayload(buildAuthPlaintext(method, options), options),
    is_first_login: credential ? 1 : 0,
    push: options.push ? 1 : 0,
    auto_login: credential ? 0 : 1,
    os_type: 2, // Android; the app hardcodes this too
  }
  if (options.includeIdType) body.id_type = idTypeFor(method.idKind)
  return body
}
