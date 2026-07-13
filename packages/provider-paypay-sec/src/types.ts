import type { FinancialProvider } from '@mnie/types'

export type PayPaySecMarket = 'japan' | 'japan-etf' | 'usa' | 'usa-etf'
export type PayPaySecPortfolioCountry = 'japan' | 'usa'
export type PayPaySecAccountType = 1 | 2 | 3 | 4
export type PayPaySecOrderSide = 'buy' | 'sell'
export type PayPaySecFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type WebAuthnAlgorithm = -7 | -257

export type WebAuthnUserVerification = 'required' | 'preferred' | 'discouraged'

export type WebAuthnTransport = 'ble' | 'hybrid' | 'internal' | 'nfc' | 'usb'

export interface WebAuthnJwk {
  kty: string
  crv?: string
  x?: string
  y?: string
  d?: string
  n?: string
  e?: string
  key_ops?: string[]
  ext?: boolean
  [key: string]: unknown
}

export interface StoredWebAuthnCredentialSecret {
  privateKey: {
    format: 'jwk'
    jwk: WebAuthnJwk
  }
  cosePrivateKey?: string
  registration?: {
    attestationObject?: string
    clientDataJSON?: string
  }
}

export interface StoredWebAuthnCredential {
  version: 1
  kind: 'webauthn-credential'
  provider: 'paypay-sec'
  rpId: string
  origin: string
  credentialId: string
  userHandle?: string
  alg: WebAuthnAlgorithm
  publicKey: {
    format: 'jwk'
    jwk: WebAuthnJwk
  }
  authenticator: {
    aaguid?: string
    signCount: number
    discoverable: boolean
    userVerification: WebAuthnUserVerification
    transports?: WebAuthnTransport[]
    backupEligible?: boolean
    backupState?: boolean
  }
  secret: {
    encrypted: true
    format: 'jwe-like-v1'
    kdf: {
      name: 'argon2id' | 'scrypt'
      salt: string
      params: Record<string, unknown>
    }
    cipher: {
      name: 'AES-256-GCM'
      nonce: string
      aad: string
      ciphertext: string
      tag: string
    }
  }
  createdAt: string
  updatedAt: string
}

export type PlaintextStoredWebAuthnCredential = Omit<StoredWebAuthnCredential, 'secret'> & {
  label?: string
  secretPlaintext: StoredWebAuthnCredentialSecret
}

export interface WebAuthnAssertionRequest {
  challenge: string
  rpId: string
}

export interface WebAuthnAssertion {
  id: string
  rawId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  userHandle: string
  authenticatorAttachment?: 'cross-platform' | 'platform' | null
  clientExtensionResults?: Record<string, unknown>
}

export interface PasskeyAssertionProvider {
  readonly rpId: string
  readonly origin: string
  createAssertion(request: WebAuthnAssertionRequest): Promise<WebAuthnAssertion> | WebAuthnAssertion
}

export interface PayPaySecPasskeyEndpointOptions {
  baseURL?: string | URL
  passkeyBffBaseURL?: string | URL
}

export type LoginWithPasskeyOptions = PayPaySecPasskeyEndpointOptions &
  (
    | { passkeyCredential: PlaintextStoredWebAuthnCredential; passkeyProvider?: never }
    | { passkeyProvider: PasskeyAssertionProvider; passkeyCredential?: never }
  )

export interface PayPaySecPasskeyClientOptions {
  accountId?: string
  deviceId?: string
  deviceName?: string
  timeZone?: string
  fetch?: PayPaySecFetch
}

export interface PayPaySecSession {
  accountId: string
  baseURL: string
  cookies: Record<string, string>
}

export interface PayPaySecClientOptions {
  accountId?: string
  baseURL?: string | URL
  cookies?: Record<string, string>
  fetch?: PayPaySecFetch
}

export interface PayPaySecInstrument {
  brandId: string
  name: string
  market: PayPaySecMarket
  code?: string
  imageURL?: string
}

export interface PayPaySecInstrumentDetail {
  brandId: string
  name: string
  code?: string
  price?: string
}

export interface PayPaySecValuationBrand {
  brandId: string
  securitiesValue: string
  grossProfit: string
}

export interface PayPaySecValuation {
  countryId: 2
  withdrawableCash?: string
  securitiesValueTotal: string
  grossProfitTotal?: string
  acquisitionTotal?: string
  buyableCash: string
  assetsTotal: string
  profitLossTotalVisible: boolean
  profitLossVisible: boolean
  brands: PayPaySecValuationBrand[]
}

export interface PayPaySecPosition {
  id: string
  brandId: string
  name: string
  country: PayPaySecPortfolioCountry
  quantity?: string
  accountType?: PayPaySecAccountType
  securitiesValue?: string
  grossProfit?: string
  acquisitionAmount?: string
  subClientSeqNo?: string
}

export type PayPaySecHistoryKind = 'trade' | 'settlement' | 'gross-profit'

export interface PayPaySecHistoryRecord {
  id: string
  kind: PayPaySecHistoryKind
  cells: Record<string, string>
  occurredAt?: string
  brandId?: string
  instrumentName?: string
  side?: PayPaySecOrderSide
  amount?: string
  quantity?: string
  price?: string
  accountType?: PayPaySecAccountType
  summaryType?: string
  status?: string
}

export interface PayPaySecAvailability {
  countryName: string
  preorderable: boolean
  buyDisabled: boolean
  sellDisabled: boolean
  brand: Record<string, unknown>
  client: Record<string, unknown>
  range: Record<string, unknown>
  holdingInfo: Array<Record<string, unknown>>
}

export interface PayPaySecBuyPreviewOptions {
  brandId: string
  amount: string
  accountType: PayPaySecAccountType
}

export type PayPaySecSellPreviewOptions = {
  brandId: string
  accountType: PayPaySecAccountType
  subClientSeqNo: string
} & ({ mode: 'amount'; amount: string } | { mode: 'all'; amount?: never })

export interface PayPaySecOrderPreview {
  confirmationId: string
  side: PayPaySecOrderSide
  brandId: string
  instrumentName: string
  accountType: PayPaySecAccountType
  amount: string
  quantity: string
  price: string
  exchangeRate: string
  expiresAt: string
  warnings: string[]
}

export interface PayPaySecOrderSubmitOptions {
  confirmationId: string
  tradePassword: string
  allowTransaction: true
}

export interface PayPaySecOrderReceipt {
  side: PayPaySecOrderSide
  brandId: string
  instrumentCode: string
  instrumentName: string
  amount: string
  message: string
}

export interface PayPaySecClient {
  readonly accountId: string
  readonly baseURL: string
  readonly session: { export(): PayPaySecSession }
  market: {
    instruments: {
      list(options: { market: PayPaySecMarket }): Promise<PayPaySecInstrument[]>
      detail(options: { brandId: string }): Promise<PayPaySecInstrumentDetail>
    }
  }
  account: { valuation(options?: { countryId?: 2 }): Promise<PayPaySecValuation> }
  portfolio: {
    positions(options: { country: PayPaySecPortfolioCountry }): Promise<PayPaySecPosition[]>
  }
  history: {
    trades(): Promise<PayPaySecHistoryRecord[]>
    settlements(): Promise<PayPaySecHistoryRecord[]>
    grossProfits(): Promise<PayPaySecHistoryRecord[]>
  }
  orders: {
    buy: {
      availability(options: { brandId: string }): Promise<PayPaySecAvailability>
      preview(options: PayPaySecBuyPreviewOptions): Promise<PayPaySecOrderPreview>
      submit(options: PayPaySecOrderSubmitOptions): Promise<PayPaySecOrderReceipt>
    }
    sell: {
      availability(options: {
        brandId: string
        subClientSeqNo: string
        accountType: PayPaySecAccountType
      }): Promise<PayPaySecAvailability>
      preview(options: PayPaySecSellPreviewOptions): Promise<PayPaySecOrderPreview>
      submit(options: PayPaySecOrderSubmitOptions): Promise<PayPaySecOrderReceipt>
    }
  }
  close(): void
}

export type PayPaySecOperations = Pick<
  import('@mnie/types').CommonOperations,
  'accounts.list' | 'balances.list' | 'assets.valuation.get' | 'transactions.list' | 'history.list'
> &
  Pick<
    import('@mnie/types').InvestmentOperations,
    | 'investments.positions.list'
    | 'investments.orders.list'
    | 'investments.orders.preview'
    | 'investments.orders.create'
    | 'investments.instruments.search'
    | 'investments.instruments.get'
  >

export type PayPaySecProvider = FinancialProvider<PayPaySecOperations>
