export type WebAuthnAlgorithm = -7 | -257

export type WebAuthnUserVerification = 'required' | 'preferred' | 'discouraged'

export type WebAuthnTransport = 'ble' | 'hybrid' | 'internal' | 'nfc' | 'usb'

export type WebAuthnJwk = {
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

export type StoredWebAuthnCredentialSecret = {
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

export type StoredWebAuthnCredential = {
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

export type PasskeyLoginResponse = {
  type: 'passkey-login-response'
  requestUrl: string
  status: number
  body: ArrayBuffer
  text: string
  header: {
    sessionId: string
    trCode: string
    resultCode: string
  } | null
}

export type SbiSession = {
  mtsBaseUrl: string
  izanagiBaseUrl?: string
  profile: AccountProfile
  loginResponse: PasskeyLoginResponse
  tradePassword?: string
  deviceIdRegistered?: boolean
  tradeAuthentication?: SbiTradeAuthenticationOptions
}

export type LoginWithPasskeyOptions = {
  passkeyCredential: PlaintextStoredWebAuthnCredential
  authBaseUrl?: string
  mtsBaseUrl?: string
  izanagiBaseUrl?: string
}

export type SbiClientOptions = {
  tradePassword?: string
  deviceId?: string
  tradeAuthentication?: SbiTradeAuthenticationOptions
}

export type SbiTradeAuthenticationRequest = {
  type: 'phone'
  telNo?: string
  phoneNo?: string
  sbiCallNo?: string
  authLimitTime?: string
}

export type SbiTradeAuthenticationOptions = {
  onRequired?: (request: SbiTradeAuthenticationRequest) => void | Promise<void>
  confirmAttempts?: number
  confirmIntervalMs?: number
}

export type IssueCode = string
export type MarketCode = string
export type OrderId = string
export type WatchlistId = string
export type PositionId = string
export type ThemeId = string

export type CurrencyAmount = {
  value: number | null
  text: string
  currency: 'JPY'
}

export type PercentValue = {
  value: number | null
  text: string
}

export type SignedTextValue = {
  value: number | null
  text: string
  sign?: 'positive' | 'negative' | 'zero'
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

export type IssueRef = {
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

export type IssueSearchResult = {
  status?: string
  statusText: IssueSearchStatus
  issues: IssueSearchItem[]
}

export type ChartPeriod = 'minute' | 'day' | 'week' | 'month'

export type ChartPrice = {
  dateTime: string
  open: CurrencyAmount
  high: CurrencyAmount
  low: CurrencyAmount
  close: CurrencyAmount
  volume?: number | null
}

export type IssueChart = {
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

export type SessionInfo = {
  sessionId: string
  loginType: LoginType
  resultCode: string
}

export type AccountProfile = {
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

export type BuyingPower = {
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

export type CollateralRatioRecord = {
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

export type CashPosition = {
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

export type CashPositionList = {
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

export type MarginPosition = {
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

export type MarginPositionList = {
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

export type ProfitLossSummary = {
  cash?: SignedTextValue
  margin?: SignedTextValue
  total?: SignedTextValue
  totalRate?: PercentValue
  error?: SbiMethodError
}

export type Quote = {
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

export type BoardPriceLevel = {
  price: CurrencyAmount
  quantity?: number | null
}

export type Board = {
  issue: IssueRef
  bids: BoardPriceLevel[]
  asks: BoardPriceLevel[]
  quote?: Quote
  error?: SbiMethodError
}

export type MarketIndex = {
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

export type DomesticMarket = {
  status?: string
  indexes: MarketIndex[]
  error?: SbiMethodError
}

export type RankingItem = {
  rank: number
  issue: IssueRef
  value?: number | string | null
  values?: Array<number | string | null>
  change?: SignedTextValue
  changeRate?: PercentValue
  exchangeName?: string
  colorFlag?: string
}

export type Ranking = {
  items: RankingItem[]
  category?: string
  updatedAt?: string
  error?: SbiMethodError
}

export type NewsItem = {
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

export type NewsList = {
  items: NewsItem[]
  error?: SbiMethodError
}

export type WatchlistItem = {
  issue: IssueRef
  sortOrder?: number
  memo?: string
  quote?: Quote
}

export type Watchlist = {
  id: WatchlistId
  name: string
  items: WatchlistItem[]
  error?: SbiMethodError
}

export type Order = {
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
  tradeId?: string
  exchangeCode?: string
  accountInformation?: string
}

export type OrderList = {
  orders: Order[]
  hasMore?: boolean
  error?: SbiMethodError
}

export type OrderCorrectionPreOrderDetail = {
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

export type OrderCorrectionPreOrder = {
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

export type OrderPreview = {
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

export type StockOrderPreOrderPriceStep = {
  from?: CurrencyAmount
  to?: CurrencyAmount
}

export type StockOrderPreOrderPaymentLimit = {
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

export type StockOrderPreOrder = {
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

export type OrderReceipt = {
  accepted: boolean
  orderId?: OrderId
  acceptedAt?: string
  message?: string
  error?: SbiMethodError
}

export type ThemeInvestment = {
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

export type ThemeInvestmentList = {
  themes: ThemeInvestment[]
  buyingPowerTotal?: CurrencyAmount
  isaBuyLimit?: CurrencyAmount
  juniorNisaBuyLimit?: CurrencyAmount
  buyingPowerTotalJuniorNisa?: CurrencyAmount
  deficitMessage?: string
  deficitMessageFlag?: string
  error?: SbiMethodError
}

export type SbiMethodError = {
  status?: string
  code?: string
  message?: string
}
