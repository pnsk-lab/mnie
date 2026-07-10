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
  provider: 'sbi-sec'
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

export interface PasskeyLoginResponse {
  type: 'passkey-login-response'
  requestUrl: string
  status: number
  body: ArrayBuffer
  text: string
  accessToken?: string
  header: {
    sessionId: string
    trCode: string
    resultCode: string
  } | null
}

export interface ForeignStockEndpointConfig {
  baseUrl?: string
  restUrl: string
  graphqlBffUrl: string
  graphqlIntUrl: string
  userAgent?: string
}

export interface ForeignStockSession {
  endpoints: ForeignStockEndpointConfig
  ssoToken?: string
  sessionId?: string
  accountId?: string
  marketPriceHash?: string
  candleHash?: string
  loginAuthenticated?: boolean
}

export interface MainSiteAuthCache {
  baseUrl: string
  assetsUrl: string
  cookieHeader: string
  authenticatedAt: string
}

export interface MainSiteSession {
  baseUrl?: string
  etGatePath?: string
  assetsValuationsPath?: string
  exchangeOrderInputPath?: string
  exchangeOrderPasswordPath?: string
  exchangeOrderConfirmPath?: string
  exchangeOrderCompletePath?: string
  auth?: MainSiteAuthCache
  authPromise?: Promise<MainSiteAuthCache>
}

export interface SbiSession {
  mtsBaseUrl: string
  izanagiBaseUrl?: string
  foreignStock?: ForeignStockSession
  mainSite?: MainSiteSession
  profile: AccountProfile
  loginResponse: PasskeyLoginResponse
  tradePassword?: string
  deviceIdRegistered?: boolean
  tradeAuthentication?: SbiTradeAuthenticationOptions
}

export interface LoginWithPasskeyOptions {
  passkeyCredential: PlaintextStoredWebAuthnCredential
  authBaseUrl?: string
  mtsBaseUrl?: string
  izanagiBaseUrl?: string
  foreignStockBaseUrl?: string
  usStockBaseUrl?: string
  foreignStockRestUrl?: string
  foreignStockGraphqlBffUrl?: string
  foreignStockGraphqlIntUrl?: string
  foreignStockUserAgent?: string
  mainSiteBaseUrl?: string
  mainSiteEtGatePath?: string
  mainSiteAssetsValuationsPath?: string
  mainSiteExchangeOrderInputPath?: string
  mainSiteExchangeOrderPasswordPath?: string
  mainSiteExchangeOrderConfirmPath?: string
  mainSiteExchangeOrderCompletePath?: string
}

export interface SbiClientOptions {
  tradePassword?: string
  deviceId?: string
  tradeAuthentication?: SbiTradeAuthenticationOptions
}

export interface SbiTradeAuthenticationRequest {
  type: 'phone'
  telNo?: string
  phoneNo?: string
  sbiCallNo?: string
  authLimitTime?: string
}

export interface SbiTradeAuthenticationOptions {
  onRequired?: (request: SbiTradeAuthenticationRequest) => void | Promise<void>
  confirmAttempts?: number
  confirmIntervalMs?: number
}

export type IssueCode = string
export type DomesticMarketCode = 'XTKS' | 'XNGO' | 'XFKA' | 'XSAP'
export type SKabuMarketCode = 'STK'
export type UsStockMarketCode = 'XNAS' | 'XNYS' | 'ARCX'
export type MarketCode = DomesticMarketCode | SKabuMarketCode | UsStockMarketCode
export type OrderId = string
export type WatchlistId = string
export type PositionId = string
export type ThemeId = string

export interface CurrencyAmount {
  value: number | null
  text: string
  currency: 'JPY' | 'USD'
}

export interface PercentValue {
  value: number | null
  text: string
}

export interface SignedTextValue {
  value: number | null
  text: string
  sign?: 'positive' | 'negative' | 'zero'
}

export interface AccountAssetsValuationSummary {
  assetsErrorType: unknown
  valuation: number | null
  netChange: number | null
  percentChange: number | null
  monthOnMonth: number | null
  monthOnMonthRatio: unknown
  profitLoss: number | null
  profitLossRate: number | null
  acquisitionCost: number | null
}

export type AccountAssetsValuationDetail = AccountAssetsValuationSummary & {
  category: string
  compositionRatio: number | null
}

export interface AccountAssetsValuations {
  fetchedAt: string
  summary: AccountAssetsValuationSummary
  summaryWithoutDeposit: AccountAssetsValuationSummary
  summaryWithoutIdeco?: AccountAssetsValuationSummary
  summaryWithoutDepositAndIdeco?: AccountAssetsValuationSummary
  summaryDetails: AccountAssetsValuationDetail[]
  summaryDetailsWithoutDeposit: AccountAssetsValuationDetail[]
  summaryDetailsWithoutIdeco: AccountAssetsValuationDetail[]
  summaryDetailsWithoutDepositAndIdeco: AccountAssetsValuationDetail[]
}

export type AccountType =
  | 'general'
  | 'specific'
  | 'growthInvestment'
  | 'nisa'
  | 'juniorNisa'
  | 'unknown'
export type DepositType =
  | 'general'
  | 'specific'
  | 'growthInvestment'
  | 'nisa'
  | 'juniorNisa'
  | 'unknown'
export type TradeSide = 'buy' | 'sell'
export type MarginTradeSide = 'buy' | 'sell'
export type OrderStatus = 'open' | 'executed' | 'cancelled' | 'expired' | 'rejected' | 'unknown'
export type OrderKind = 'market' | 'limit' | 'stop' | 'oco' | 'ifd' | 'ifdo' | 's' | 'unknown'
export type LoginStatus =
  | 'success'
  | 'invalidUser'
  | 'tradeForbidden'
  | 'locked'
  | 'fidoAuthorizationIncorrect'
  | 'fidoAuthorization'
  | 'passwordChangeRequired'
  | 'unknown'
export type LoginType = 'passkey' | 'password' | 'unknown'
export type SpecificAccountType =
  | 'withHolding'
  | 'withoutHolding'
  | 'nonSpecific'
  | 'notApply'
  | 'unknown'
export type IsaAccountType =
  | 'nisaTradeForbidden'
  | 'oldNisaTradePermitted'
  | 'newNisaTradePermitted'
  | 'nisaTradePermitted'
  | 'unknown'

export interface IssueRef {
  code: IssueCode
  market?: MarketCode
  name?: string
}

export type IssueSearchItem = IssueRef & {
  extract?: string
  extractWord?: string
  boldFrom?: string
  boldTo?: string
  hitString?: string
}

export type IssueSearchStatus = 'success' | 'searchError' | 'tooManyResults' | 'unknown'

export interface IssueSearchResult {
  status?: string
  statusText: IssueSearchStatus
  issues: IssueSearchItem[]
}

export type ChartPeriod = 'minute' | 'day' | 'week' | 'month'

export interface ChartPrice {
  dateTime: string
  open: CurrencyAmount
  high: CurrencyAmount
  low: CurrencyAmount
  close: CurrencyAmount
  volume?: number | null
}

export interface IssueChart {
  issue: IssueRef
  period: ChartPeriod
  unit: number
  prices: ChartPrice[]
  previousClose?: CurrencyAmount
  currentPrice?: CurrencyAmount
  highPrice?: CurrencyAmount
  lowPrice?: CurrencyAmount
  latestDateTime?: string
  error?: SbiMethodError
}

export interface SessionInfo {
  sessionId: string
  loginType: LoginType
  resultCode: string
}

export interface AccountProfile {
  session: SessionInfo
  branchCode?: string
  butenCode?: string
  accountNumber?: string
  userId?: string
  loginStatus?: LoginStatus
  loginType?: LoginType
  accountType?: AccountType
  specificAccountType?: SpecificAccountType
  hasMarginAccount?: boolean
  marginAccount?: string
  corporateFlag?: string
  commissionPlan?: string
  expireDate?: string
  lastLoginDate?: string
  lastLoginTime?: string
  tradingPassword?: string
  fxShareCol?: string
  fullTerm?: string
  fullAccount?: string
  securityAuthenticationResponseCode?: string
  fidoResponseCode?: string
  passkeyStatus?: string
  trId?: string
  txId?: string
  actionToken?: string
  nisa?: {
    enabled: boolean
    tradePermitted?: boolean
    juniorEnabled?: boolean
    accountType?: IsaAccountType
    jrNisaAccount?: string
    jrNisaSpecific?: SpecificAccountType
    jrNisaSeigen?: string
  }
  sor?: {
    defaultEnabled?: boolean
    defaultCode?: string
    lastMarket?: MarketCode
    juniorNisaLastMarket?: MarketCode
  }
  notices?: {
    hasImportantNotice?: boolean
    importantNoticeFlag?: string
    count?: number
  }
  restrictions?: {
    tradeRestricted?: boolean
    restrictedTradeFlag?: string
    message?: string
  }
  deficit?: {
    hasMessage?: boolean
    messageFlag?: string
    message?: string
  }
  maintenance?: {
    referenceable?: boolean
    referenceableMaintenanceFlag?: string
  }
}

export interface BuyingPower {
  cashBuyingPower?: CurrencyAmount
  marginBuyingPower?: CurrencyAmount
  withdrawableAmount?: CurrencyAmount
  collateralValue?: CurrencyAmount
  collateralRatio?: PercentValue
  sbiHybridDepositBalance?: CurrencyAmount
  noticeMessage?: string
  records?: CollateralRatioRecord[]
  error?: SbiMethodError
}

export interface CollateralRatioRecord {
  marginRequirements?: CurrencyAmount
  referenceMarginRequirements?: CurrencyAmount
  collateralRatioCash?: CurrencyAmount
  substituteSecuritiesValuationAmount?: CurrencyAmount
  unsettledPositionLoss?: SignedTextValue
  unsettledPositionLossFlag?: string
  settlementLoss?: SignedTextValue
  settlementLossFlag?: string
  paymentExpenses?: SignedTextValue
  paymentExpensesFlag?: string
  actualCollateral?: CurrencyAmount
  positionAmount?: CurrencyAmount
  sbiHybridDepositBalance?: CurrencyAmount
  minimumCollateral?: CurrencyAmount
}

export interface CashPosition {
  issue: IssueRef
  accountType?: AccountType
  depositType?: DepositType
  depositTypeCode?: string
  depositTypeText?: string
  quantity: number | null
  availableQuantity?: number | null
  unexecutedOrderQuantity?: number | null
  averagePrice?: CurrencyAmount
  purchasePrice?: CurrencyAmount
  /** Current unit price, not multiplied by quantity. */
  currentPrice?: CurrencyAmount
  priceText?: string
  /** Total position valuation amount. For cash positions this is quantity-adjusted. */
  marketValue?: CurrencyAmount
  presentValueFlag?: string
  /** Raw SBI valuation amount. Kept for source compatibility; prefer `marketValue` for totals. */
  valuationPrice?: CurrencyAmount
  valuationPriceChange?: SignedTextValue
  valuationPriceChangeRate?: PercentValue
  valuationPriceChangeFlag?: string
  profitLoss?: SignedTextValue
  profitLossRate?: PercentValue
  profitLossFlag?: string
  holdingCategory?: string
  accountInformation?: string
}

export interface CashPositionList {
  positions: CashPosition[]
  index?: number
  totalCount?: number
  totalMarketValue?: CurrencyAmount
  totalProfitLoss?: SignedTextValue
  totalProfitLossRate?: PercentValue
  totalProfitLossFlag?: string
  hasMore?: boolean
  error?: SbiMethodError
}

export interface MarginPosition {
  id?: PositionId
  issue: IssueRef
  side: MarginTradeSide
  sideText?: string
  accountType?: AccountType
  tradeKind?: string
  quantity: number | null
  availableCloseQuantity?: number | null
  unexecutedOrderQuantity?: number | null
  openPrice?: CurrencyAmount
  openAmount?: CurrencyAmount
  /** Current unit price or rate, not multiplied by quantity. */
  currentPrice?: CurrencyAmount
  rate?: CurrencyAmount
  /** Total position valuation amount when provided by SBI. */
  marketValue?: CurrencyAmount
  presentValueFlag?: string
  /** Raw SBI valuation amount. Prefer `marketValue` when calculating totals. */
  valuationPrice?: CurrencyAmount
  valuationPriceChange?: SignedTextValue
  valuationPriceChangeRate?: PercentValue
  valuationPriceChangeFlag?: string
  profitLoss?: SignedTextValue
  profitLossRate?: PercentValue
  profitLossFlag?: string
  openDate?: string
  dueDate?: string
  dueDateCode?: string
  dueDateText?: string
  depositTypeText?: string
  cost?: CurrencyAmount
  commission?: CurrencyAmount
  managementFee?: CurrencyAmount
  nameTransferFee?: CurrencyAmount
  interest?: CurrencyAmount
  backwardation?: CurrencyAmount
  collateralRatio?: PercentValue
  bargainMarketCode?: string
  bargainMarket?: string
}

export interface MarginPositionList {
  positions: MarginPosition[]
  index?: number
  totalCount?: number
  totalMarketValue?: CurrencyAmount
  totalProfitLoss?: SignedTextValue
  totalProfitLossRate?: PercentValue
  totalProfitLossFlag?: string
  hasMore?: boolean
  error?: SbiMethodError
}

export interface ProfitLossSummary {
  cash?: SignedTextValue
  margin?: SignedTextValue
  total?: SignedTextValue
  totalRate?: PercentValue
  error?: SbiMethodError
}

export interface Quote {
  issue: IssueRef
  price?: CurrencyAmount
  change?: SignedTextValue
  changeRate?: PercentValue
  changeFlag?: string
  open?: CurrencyAmount
  high?: CurrencyAmount
  low?: CurrencyAmount
  previousClose?: CurrencyAmount
  volume?: number | null
  timestamp?: string
  nominalPrices?: CurrencyAmount[]
  error?: SbiMethodError
}

export interface BoardPriceLevel {
  price: CurrencyAmount
  quantity?: number | null
}

export interface Board {
  issue: IssueRef
  bids: BoardPriceLevel[]
  asks: BoardPriceLevel[]
  quote?: Quote
  error?: SbiMethodError
}

export interface MarketIndex {
  code?: string
  categoryCode?: string
  name: string
  value?: number | null
  valueText?: string
  change?: SignedTextValue
  changeRate?: PercentValue
  colorFlag?: string
  timestamp?: string
  open?: CurrencyAmount
  high?: CurrencyAmount
  low?: CurrencyAmount
  previousClose?: CurrencyAmount
}

export interface DomesticMarket {
  status?: string
  indexes: MarketIndex[]
  error?: SbiMethodError
}

export interface RankingItem {
  rank: number
  issue: IssueRef
  value?: number | string | null
  values?: Array<number | string | null>
  change?: SignedTextValue
  changeRate?: PercentValue
  exchangeName?: string
  colorFlag?: string
}

export interface Ranking {
  items: RankingItem[]
  category?: string
  updatedAt?: string
  error?: SbiMethodError
}

export interface NewsItem {
  id?: string
  title: string
  source?: string
  publishedAt?: string
  url?: string
  summary?: string
  storyDate?: string
  storyTime?: string
  processedDate?: string
  takeTime?: string
  pnac?: string
}

export interface NewsList {
  items: NewsItem[]
  error?: SbiMethodError
}

export interface WatchlistItem {
  issue: IssueRef
  sortOrder?: number
  memo?: string
  quote?: Quote
}

export interface Watchlist {
  id: WatchlistId
  name: string
  items: WatchlistItem[]
  error?: SbiMethodError
}

export interface Order {
  id: OrderId
  issue: IssueRef
  side: TradeSide
  sideText?: string
  status: OrderStatus
  statusText?: string
  executionStatus?: string
  executionStatusText?: string
  kind?: OrderKind
  accountType?: AccountType
  depositType?: DepositType
  depositTypeCode?: string
  depositTypeText?: string
  quantity?: number | null
  unexecutedQuantity?: number | null
  executedQuantity?: number | null
  price?: CurrencyAmount
  executedPrice?: CurrencyAmount
  orderedAt?: string
  expiresAt?: string
  orderNumber?: string
  orderSubNo?: string
  tradeId?: string
  exchangeCode?: string
  accountInformation?: string
  cancelable?: boolean
  correctable?: boolean
}

export interface OrderList {
  orders: Order[]
  hasMore?: boolean
  error?: SbiMethodError
}

export interface TradeRecord {
  id: string
  issue: IssueRef
  tradeRecordTypeCode?: string
  tradeCurrencyCode?: string
  listedSecuritiesStatus?: string
  orderPriceKindCode?: string
  accountType?: AccountType
  settlementCurrencyCode?: string
  amount?: CurrencyAmount
  quantity?: number | null
  price?: CurrencyAmount
  tradeDate?: string
  valueDate?: string
  marginCloseLimitType?: string
}

export interface TradeRecordList {
  records: TradeRecord[]
  hasMore?: boolean
  error?: SbiMethodError
}

export interface OrderCorrectionPreOrderDetail {
  exchangeName?: string
  marketLoanKbn?: string
  marketIppanLoanKbn?: string
  currentPrice?: CurrencyAmount
  tradeColorFlag?: string
  priceTick?: string
  priceTickText?: string
  tradeTime?: string
  changeText?: string
  volumeText?: string
}

export interface OrderCorrectionPreOrder {
  issue: IssueRef
  tradeTitle?: string
  buyingPowerTotal?: CurrencyAmount
  controlledStockCode?: string
  hasTradeWarning?: boolean
  deficitMessageFlag?: string
  deficitMessage?: string
  details: OrderCorrectionPreOrderDetail[]
  orderNumber?: string
  orderId?: string
  primaryOrderMethod?: string
  primaryTriggerZone?: string
  primaryTriggerPrice?: number | null
  status?: string
  statusText?: string
  tradeId?: string
  tradeName?: string
  quantity?: number | null
  quantityText?: string
  orderLimit?: string
  orderLimitText?: string
  priceSteps: StockOrderPreOrderPriceStep[]
  sessionRange?: string
  inputDateText?: string
  primaryOrderTerm?: string
  nonSpecificTradeText?: string
  marketName?: string
  rbeOrderStatus?: string
  priceCondition?: string
  price?: number | null
  priceAmount?: CurrencyAmount
  exchangeName?: string
  transId?: string
  ptsDayNightFlag?: string
  smallTickFlag?: string
  juniorBuyingPowerTotal?: CurrencyAmount
  secondaryPriceCondition?: string
  secondaryPrice?: number | null
  secondaryPriceAmount?: CurrencyAmount
  autoOrderKind?: string
  autoOrderNumber?: string
  autoOrderInputDate?: string
  secondaryOrderMethod?: string
  secondaryTriggerZone?: string
  secondaryTriggerPrice?: number | null
  secondaryOrderCondition?: string
  secondaryLimitPrice?: number | null
  secondaryLimitPriceAmount?: CurrencyAmount
  secondaryOrderTerm?: string
  secondaryOcoPriceCondition?: string
  secondaryOcoPrice?: number | null
  secondaryOcoPriceAmount?: CurrencyAmount
  exchangeList?: string
}

export interface OrderPreview {
  issue: IssueRef
  side: TradeSide
  quantity?: number
  price?: CurrencyAmount
  estimatedAmount?: CurrencyAmount
  commission?: CurrencyAmount
  tax?: CurrencyAmount
  warnings: string[]
  confirmationId?: string
  message?: string
  correction?: OrderCorrectionPreOrder
  error?: SbiMethodError
}

export interface StockOrderPreOrderPriceStep {
  from?: CurrencyAmount
  to?: CurrencyAmount
}

export interface StockOrderPreOrderPaymentLimit {
  text?: string
  code?: string
}

export type StockOrderPreOrderMarginTradeType =
  | 'standard'
  | 'generalBuy'
  | 'generalSellShort'
  | 'generalSellInventoryLimited'
  | 'generalSellInventoryUnlimited'
  | 'day'
  | 'hyper'

export interface StockOrderPreOrder {
  issue: IssueRef
  tradeTitle?: string
  buyingPowerTotal?: CurrencyAmount
  controlledStockCode?: string
  hasTradeWarning?: boolean
  market?: MarketCode
  exchangeList?: string
  exchangeListName?: string
  exchangeListIndexFlag?: string
  marketLoanKbn?: string
  marketIppanLoanKbn?: string
  currentPrice?: CurrencyAmount
  tradeColorFlag?: string
  priceTick?: string
  priceTickText?: string
  tradeTime?: string
  changeText?: string
  volume?: number | null
  lotSize?: number | null
  priceSteps: StockOrderPreOrderPriceStep[]
  sessionRange?: string
  basePrice?: CurrencyAmount
  orderTerms: string[]
  orderTermDates: string[]
  paymentLimits: StockOrderPreOrderPaymentLimit[]
  nonSpecificTradeText?: string
  paymentLimitText?: string
  acquisitionPrice?: CurrencyAmount
  position?: number | null
  unexecutedQuantity?: number | null
  lotSize2?: number | null
  ptsDayNightFlag?: string
  sorServiceType?: string
  nisa?: {
    serviceKbn?: string
    buyLimit?: CurrencyAmount
    growthServiceKbn?: string
    juniorServiceKbn?: string
    juniorBuyLimit?: CurrencyAmount
    juniorBuyingPowerTotal?: CurrencyAmount
  }
  smallTickFlag?: string
  margin?: {
    tradeTypes?: StockOrderPreOrderMarginTradeType[]
    ippanShort?: string
    ippanLong?: string
    dayBuy?: string
    daySell?: string
    premiumShortSelling?: string
    premiumFee?: CurrencyAmount
    ippanPaymentLimit?: string
    positionStatus?: string
  }
  sKabu?: {
    code?: string
    available?: boolean
  }
  deficitMessageFlag?: string
  deficitMessage?: string
  error?: SbiMethodError
}

export interface OrderReceipt {
  accepted: boolean
  orderId?: OrderId
  acceptedAt?: string
  message?: string
  error?: SbiMethodError
}

export type ExchangeOrderSide = 'buy' | 'sell'
export type ExchangeSpecificMethod = 'foreign' | 'domestic'
export type ExchangeAccountKind = 'GENERAL' | 'JR_NISA'
export type ExchangeSellMethod = 'SELL_PART' | 'SELL_ALL'

export interface ExchangeOrderPreview {
  currencyCode: string
  currencyName?: string
  side: ExchangeOrderSide
  exchangeType?: string
  accountKind?: ExchangeAccountKind
  specificMethod?: ExchangeSpecificMethod
  sellMethod?: ExchangeSellMethod | null
  tradeQuantity?: string
  orderAmount?: string
  exchangeRate?: string
  netAmount?: string
  valueDate?: string
  rateDateTime?: string
  warningMessage?: string | null
  isMaintenance?: boolean
  csrfToken: string
}

export interface ExchangeOrderReceipt {
  accepted: boolean
  currencyCode?: string
  side?: ExchangeOrderSide
  message?: string
  warningMessage?: string | null
  rawTitle?: string
}

export interface ExchangeRateInfo {
  currencyCode: string
  side: ExchangeOrderSide
  referenceExchangeRate?: string
  computeExchangeRate?: string
  basePrice?: string
  exchangeTradeType?: string
  updateTime?: string
  buyPossibleAmount?: string
  sellPossibleAmount?: string
  buyUnit?: string
  sellUnit?: string
  buyLimitMin?: string
  buyLimitMax?: string
  sellLimitMin?: string
  sellLimitMax?: string
  raw: Record<string, unknown>
}

export interface ThemeInvestment {
  id: ThemeId
  name: string
  issues: ThemeInvestmentIssue[]
  minimumAmount?: CurrencyAmount
}

export type ThemeInvestmentIssue = IssueRef & {
  controlledStockCode?: string
  hasTradeWarning?: boolean
  nisaServiceKbn?: string
  juniorNisaServiceKbn?: string
  growthNisaServiceKbn?: string
  sKabuCode?: string
  sKabuAvailable?: boolean
  lotSize?: number | null
  currentPrice?: CurrencyAmount
  tradeColorFlag?: string
  priceTick?: string
  priceTickText?: string
  tradeTime?: string
}

export interface ThemeInvestmentList {
  themes: ThemeInvestment[]
  buyingPowerTotal?: CurrencyAmount
  isaBuyLimit?: CurrencyAmount
  juniorNisaBuyLimit?: CurrencyAmount
  buyingPowerTotalJuniorNisa?: CurrencyAmount
  deficitMessage?: string
  deficitMessageFlag?: string
  error?: SbiMethodError
}

export interface SbiMethodError {
  status?: string
  code?: string
  message?: string
}
