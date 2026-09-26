export {
  KEY_ALPHABET,
  VPASS_AUTH_PUBLIC_KEY_PEM,
  decryptPayload,
  encryptPayload,
  splitEnvelope,
  type EnvelopeParts,
  type KeyOptions,
} from './crypto'

export {
  DEFAULT_CARD_COMPANY_CODE,
  FIELD_DELIMITER,
  buildAuthPlaintext,
  buildAuthRequest,
  deviceIdCheckDigit,
  idTypeFor,
  type AuthPayloadContext,
  type AuthRequestBody,
  type BuildAuthRequestOptions,
  type CredentialLogin,
  type LoginIdKind,
  type LoginMethod,
  type TokenLogin,
} from './auth'

export {
  DEFAULT_VPASS_OS_VERSION,
  DEFAULT_VPASS_WEBVIEW_USER_AGENT,
  buildVpassUserAgent,
} from './constants'

export {
  VpassAuthError,
  VpassClient,
  VpassError,
  normalizeOrigin,
  requestHash,
  type AppEnvelope,
  type AuthResponseData,
  type FetchLike,
  type MemberApiOptions,
  type VpassClientOptions,
  type VpassErrorMetadata,
} from './client'

export { CookieJar } from './cookie-jar'

export {
  VpassProfile,
  connect,
  resume,
  type ConnectOptions,
  type VpassCard,
  type VpassSession,
  type VpassStatement,
  type VpassStatementEntry,
} from './profile'

export { createProvider } from './provider'
