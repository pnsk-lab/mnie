/** Provider identifiers are intentionally open: adding a provider is not a breaking SDK change. */
export type ProviderId = string

/** Product areas a provider can expose. */
export type Capability =
  | 'accounts:read'
  | 'balances:read'
  | 'transactions:read'
  | 'transfers:read'
  | 'transfers:preview'
  | 'transfers:create'
  | 'payments:read'
  | 'payments:create'
  | 'messages:read'
  | 'messages:send'
  | 'cards:read'
  | 'transit-cards:read'
  | 'points:read'
  | 'investments:read'
  | 'investments:trade'
  | 'pensions:read'

export interface ProviderDescriptor {
  id: ProviderId
  name: string
}

export interface ProfileDescriptor {
  id: string
  provider: ProviderDescriptor
  label: string
  category: ProviderCategory
  defaultColor: string
}

export type ProviderCategory = 'brokerage' | 'bank' | 'transit' | 'pension' | 'other'

export type ConnectionId = string & { readonly __brand: 'ConnectionId' }
export type PhysicalAccountId = string & { readonly __brand: 'PhysicalAccountId' }
export type FinancialAccountId = string & { readonly __brand: 'FinancialAccountId' }
export type VirtualAccountId = FinancialAccountId & { readonly __virtual: true }
export type VirtualOrderId = string & { readonly __brand: 'VirtualOrderId' }
export type VirtualQuoteId = string & { readonly __brand: 'VirtualQuoteId' }

export interface PublicFinancialAccount {
  id: FinancialAccountId
  implementation: 'virtual-brokerage' | 'passthrough-readonly'
  category: ProviderCategory
  provider?: string
  label: string
  kind: 'personal' | 'agent' | 'system'
  status: 'active' | 'frozen' | 'reconciliation_required' | 'closed'
  capabilities: readonly string[]
  permissions: { read: boolean; trade: boolean; manage: boolean }
  color?: string
  icon?: string
  version: number
}

export interface VirtualAccountAsset {
  accountId: FinancialAccountId
  assetKey: string
  assetKind: 'cash' | 'security'
  available: string
  reserved: string
  pending: string
  version: number
  updatedAt: string
}

export type FinancialAssetReference =
  | { kind: 'cash'; currency: string }
  | {
      kind: 'security'
      instrumentId: string
      venue: string
      positionType: 'cash'
      accountType?: string
    }

/** Provider-reported physical asset change. Workspace applies it to a virtual account. */
export interface FinancialAssetChange {
  asset: FinancialAssetReference
  availableDelta: string
  reservedDelta: string
  pendingDelta: string
}

export interface FinancialOperationEffects {
  /** Stable provider-side reference, normally an order ID. */
  referenceId: string
  changes: FinancialAssetChange[]
  /** Provider references whose still-active changes this operation reverses. */
  reversesReferenceIds?: string[]
}

export interface FinancialOperationEffectResult {
  effects?: FinancialOperationEffects
  /**
   * When true on a cancellation result, the provider confirmed the order
   * reached a terminal state and any reported effects are final.
   */
  confirmed?: boolean
}

export interface Money {
  /** ISO 4217 currency code. */
  currency: string
  /** Decimal value, represented as text to preserve financial precision. */
  value: string
}

export type Amount =
  | { kind: 'money'; money: Money }
  | { kind: 'points'; programId: string; unit: string; value: string }

export type AccountKind =
  | 'bank'
  | 'brokerage'
  | 'payment-wallet'
  | 'credit-card'
  | 'transit-card'
  | 'points'
  | 'other'

export interface Account {
  id: string
  providerId: ProviderId
  kind: AccountKind
  name: string
  maskedNumber?: string
}

export interface Balance {
  accountId: string
  type: 'current' | 'available' | 'withdrawable' | 'buying-power' | 'collateral' | 'points'
  amount: Amount
  asOf: string
}

export interface AssetValuation {
  amount: Money
  asOf: string
  holdingsAmount?: Money
  cashAmount?: Money
}

export interface PortfolioValuationComponent {
  profileId: string
  providerId: string
  label: string
  originalAmount: Money
  convertedAmount: Money
  asOf: string
}

export interface PortfolioValuationError {
  profileId: string
  message: string
}

export interface PortfolioValuation {
  baseCurrency: string
  total: Money
  asOf: string
  completeness: 'complete' | 'partial'
  components: PortfolioValuationComponent[]
  errors: PortfolioValuationError[]
}

export interface PortfolioOverviewComponent {
  profile: ProfileDescriptor
  accounts: Account[]
  valuation?: AssetValuation
  balances?: Balance[]
  positions?: InvestmentPosition[]
  orders?: InvestmentOrder[]
}

export interface PortfolioOverviewError {
  profileId: string
  providerId: string
  operation: string
  message: string
}

export interface PortfolioOverview {
  components: PortfolioOverviewComponent[]
  errors: PortfolioOverviewError[]
  asOf: string
}

export type TransactionDirection = 'credit' | 'debit' | 'neutral'
export type TransactionStatus = 'pending' | 'posted' | 'reversed' | 'failed'

export interface TransactionBase<Kind extends string, Direction extends TransactionDirection> {
  id: string
  accountId: string
  /** Discriminant for a financial event, never a provider-specific label. */
  kind: Kind
  direction: Direction
  status: TransactionStatus
  /** Absolute amount. `null` preserves source rows without a monetary movement. */
  amount: Amount | null
  occurredAt: string
  description: string
  balanceAfter?: Amount
}

export interface DepositTransaction extends TransactionBase<'deposit', 'credit'> {}
export interface WithdrawalTransaction extends TransactionBase<'withdrawal', 'debit'> {}

export interface PaymentTransaction extends TransactionBase<'payment', 'debit'> {
  merchant?: string
}

export interface TransferTransaction extends TransactionBase<'transfer', 'credit' | 'debit'> {
  counterparty?: string
}

export interface RefundTransaction extends TransactionBase<'refund', 'credit'> {
  merchant?: string
}

export type TransitService = 'rail' | 'bus' | 'shopping' | 'other'

export interface TransitTransaction extends TransactionBase<'transit', 'debit'> {
  transit: {
    service: TransitService
    from?: string
    to?: string
  }
}

export interface ChargeTransaction extends TransactionBase<'charge', 'credit'> {
  charge: {
    method: 'cash' | 'card' | 'bank-transfer' | 'automatic' | 'other'
  }
}

export interface RewardTransaction extends TransactionBase<'reward', 'credit'> {
  reward?: { programId?: string }
}

export interface InvestmentTradeTransaction extends TransactionBase<
  'investment-trade',
  'credit' | 'debit'
> {
  investment: {
    instrumentId: string
    side: 'buy' | 'sell'
    quantity?: string
    unitPrice?: Money
  }
}

export interface FeeTransaction extends TransactionBase<'fee', 'debit'> {}
export interface OtherTransaction extends TransactionBase<'other', TransactionDirection> {}

/** A complete, provider-neutral financial history record. */
export type Transaction =
  | DepositTransaction
  | WithdrawalTransaction
  | PaymentTransaction
  | TransferTransaction
  | RefundTransaction
  | TransitTransaction
  | ChargeTransaction
  | RewardTransaction
  | InvestmentTradeTransaction
  | FeeTransaction
  | OtherTransaction

export interface TransactionObservationPolicy {
  accountKind: AccountKind
  institutionId: string
  timePrecision: 'instant' | 'minute' | 'day'
  identity:
    | { kind: 'stable-provider-id' }
    | {
        kind: 'ordered-snapshot'
        fingerprintVersion: string
        fingerprint(transaction: Transaction): string
      }
}

export interface PageRequest {
  cursor?: string
  limit?: number
}

export interface DateRangeRequest extends PageRequest {
  account?: string
  from?: string
  to?: string
}

export type HistoryKind = 'transaction' | 'valuation' | 'snapshot'

export interface HistoryListRequest extends DateRangeRequest {
  kinds?: HistoryKind[]
}

export interface AssetSnapshot {
  accountId: string
  capturedAt: string
  balances: Balance[]
  valuation?: AssetValuation
  positions?: InvestmentPosition[]
}

export type HistoryItem =
  | { kind: 'transaction'; occurredAt: string; profileId?: string; transaction: Transaction }
  | { kind: 'valuation'; occurredAt: string; profileId?: string; valuation: AssetValuation }
  | { kind: 'snapshot'; occurredAt: string; profileId?: string; snapshot: AssetSnapshot }

export interface HistoryListError {
  profileId: string
  providerId: string
  message: string
}

export interface HistoryListResult extends Page<HistoryItem> {
  errors: HistoryListError[]
}

export interface Page<Item> {
  items: Item[]
  nextCursor?: string
}

export interface TransferRecipient {
  id: string
  name: string
  maskedAccountNumber?: string
}

export type InvestmentPositionLotType = 'standard' | 'oddLot' | 'notApplicable'

export interface InvestmentPosition {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  venue?: string
  quantity: string
  availableQuantity?: string
  positionType: 'cash' | 'margin'
  /** Provider-defined lot classification. Omitted when the provider cannot determine it. */
  lotType?: InvestmentPositionLotType
  side?: 'long' | 'short'
  accountType?: string
  averagePrice?: Money
  currentPrice?: Money
  marketValue?: Money
  unrealizedProfitLoss?: Money
  unrealizedProfitLossRate?: string
  accountInformation?: string
  /** Legacy provider market identifier; prefer venue for new integrations. */
  market?: string
}

export interface InvestmentTrade {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  venue?: string
  type?: string
  quantity?: string
  price?: Money
  amount?: Money
  tradeDate?: string
  valueDate?: string
  accountType?: string
  settlementCurrency?: string
}

export interface InvestmentOrderRequest {
  account: string
  instrumentId: string
  /** Listing venue when it differs from the execution venue (for example odd-lot routes). */
  instrumentVenue?: string
  side: 'buy' | 'sell'
  /** Share/unit quantity. Exactly one of quantity and amount must be supplied. */
  quantity?: string
  /** Provider-supported notional order amount (for example PayPay Securities). */
  amount?: Money
  positionType?: 'cash' | 'margin'
  /** Provider-neutral account classification selected from operation availability rules. */
  accountType?: string
  strategy?:
    | { kind: 'single' }
    | {
        kind: 'stop'
        trigger: {
          condition: 'at-or-above' | 'at-or-below'
          price: Money
        }
      }
    | {
        kind: 'ifd'
        exit: {
          side: 'buy' | 'sell'
          priceType: 'market' | 'limit'
          limitPrice?: Money
        }
      }
    | {
        kind: 'oco'
        alternative: {
          priceType: 'market' | 'limit'
          limitPrice?: Money
        }
        trigger: {
          condition: 'at-or-above' | 'at-or-below'
          price: Money
        }
      }
  execution?: {
    priceType: 'market' | 'limit'
    limitPrice?: Money
    timing?: 'realtime' | 'opening'
    venue?: string
    timeInForce?: 'session' | 'day' | 'week' | 'date'
    expiresOn?: string
  }
  allowTransaction?: true
  /** Sell the complete addressed holding instead of a monetary amount. */
  sellAll?: boolean
  /** Position identifier returned by investments.positions.list when a sale addresses one holding. */
  positionId?: string
}

export type InvestmentOrderSizing =
  | {
      kind: 'quantity'
      /** Restricts this sizing rule to one order side. Omitted for a shared rule. */
      side?: 'buy' | 'sell'
      minimum: string
      increment: string
      maximum?: string
      /** Exchange board lot when the provider distinguishes whole and odd lots. */
      boardLot?: string
    }
  | {
      kind: 'amount'
      /** Restricts this sizing rule to one order side. Omitted for a shared rule. */
      side?: 'buy' | 'sell'
      currency: string
      minimum: string
      increment: string
      maximum?: string
    }

export interface InvestmentOrderRules {
  sizing: InvestmentOrderSizing[]
  priceTypes: Array<'market' | 'limit'>
  timings: Array<'realtime' | 'opening'>
  venues?: string[]
  timeInForce?: Array<'session' | 'day' | 'week' | 'date'>
  expirationDates?: string[]
  accountTypes?: string[]
  priceIncrements?: Array<{
    increment: Money
    upTo?: Money
  }>
  supportsCorrection?: boolean
  supportsCancellation?: boolean
  /** Provider-specific restrictions that cannot be represented structurally. */
  notices?: string[]
}

export interface InvestmentOrderPreview {
  estimatedAmount?: Money
  quantity?: string
  price?: Money
  exchangeRate?: string
  expiresAt?: string
  warnings: string[]
  confirmationToken?: string
  /** Expected physical changes if this preview is submitted successfully. */
  projectedAssetChanges?: FinancialAssetChange[]
}

export interface InvestmentOrderPlacement extends InvestmentOrderRequest {
  idempotencyKey?: string
  confirmationToken?: string
  allowTransaction: true
}

export interface InvestmentOrderChangeRequest {
  idempotencyKey?: string
  account: string
  orderId: string
  quantity?: string
  limitPrice?: Money
  confirmationToken?: string
  allowTransaction: true
}

export interface InvestmentOrderCancelRequest {
  idempotencyKey?: string
  account: string
  orderId: string
  confirmationToken?: string
  allowTransaction: true
}

/** Confirmation-only placement used by providers that retain the preview server-side. */
export interface InvestmentOrderCreateRequest {
  /** Required by the Mnie workspace order coordinator. */
  idempotencyKey?: string
  confirmationToken: string
  allowTransaction: true
}

export interface InvestmentOrderReceipt extends FinancialOperationEffectResult {
  id?: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  side: 'buy' | 'sell'
  amount: Money
  message?: string
}

export interface InvestmentInstrument {
  id: string
  name: string
  market: string
  code?: string
  imageUrl?: string
  price?: Money
}

export interface InvestmentOrder extends FinancialOperationEffectResult {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  venue?: string
  accountType?: string
  side: 'buy' | 'sell'
  status: 'open' | 'executed' | 'cancelled' | 'expired' | 'rejected' | 'unknown'
  quantity?: string
  unexecutedQuantity?: string
  executedQuantity?: string
  price?: Money
  amount?: Money
  orderedAt?: string
  expiresAt?: string
  statusText?: string
  cancelable?: boolean
  correctable?: boolean
  accountInformation?: string
}

export type InvestmentMethods = {
  'investments.positions.list': MethodDefinition<
    PageRequest & { account?: string; positionType?: 'cash' | 'margin' },
    Page<InvestmentPosition>
  >
  'investments.positions.get': MethodDefinition<
    {
      account?: string
      instrumentId: string
      venue: string
      positionType?: 'cash' | 'margin'
      accountType?: string
    },
    InvestmentPosition
  >
  'investments.orders.preview': MethodDefinition<InvestmentOrderRequest, InvestmentOrderPreview>
  'investments.orders.create': MethodDefinition<
    InvestmentOrderPlacement | InvestmentOrderCreateRequest,
    InvestmentOrder | InvestmentOrderReceipt
  >
  'investments.orders.replace.preview': MethodDefinition<
    InvestmentOrderChangeRequest,
    InvestmentOrderPreview
  >
  'investments.orders.replace': MethodDefinition<InvestmentOrderChangeRequest, InvestmentOrder>
  'investments.orders.cancel': MethodDefinition<InvestmentOrderCancelRequest, InvestmentOrder>
  'investments.instruments.search': MethodDefinition<
    { query?: string; market?: string },
    Page<InvestmentInstrument>
  >
  'investments.instruments.get': MethodDefinition<{ instrumentId: string }, InvestmentInstrument>
  'investments.orders.list': MethodDefinition<
    PageRequest & { account?: string; status?: InvestmentOrder['status'] },
    Page<InvestmentOrder>
  >
  /** Complete snapshot of open broker orders. `complete` must be true for isolation. */
  'investments.orders.open': MethodDefinition<
    { account?: string },
    { items: InvestmentOrder[]; complete?: boolean }
  >
  'investments.orders.get': MethodDefinition<
    {
      account?: string
      orderId: string
      instrumentId?: string
      venue: string
    },
    InvestmentOrder
  >
  'investments.trades.list': MethodDefinition<
    PageRequest & { account?: string; venue?: string },
    Page<InvestmentTrade>
  >
}

export interface PensionParticipant {
  name: string
}

export interface PensionHolding {
  operationType: string
  productName: string
  totalAsset: number
  profitLoss: number
  assetRatio: number
}

export interface PensionCurrentAssets {
  planName: string
  lastLogin: Date
  totalAsset: number
  totalContribution: number
  totalProfitLoss: number
  roi: number
  date: Date
  holdings: PensionHolding[]
}

export interface PensionContributionAllocation {
  operationType: string
  productName: string
  contributionRatio: number
}

export interface PensionContribution {
  planName: string
  lastLogin: Date
  contributionAmount: number
  contributionDate: Date
  date: Date
  allocations: PensionContributionAllocation[]
}

export interface PensionHistoricalAssetEntry {
  date: Date
  totalAsset: number
  totalContribution: number
  totalProfitLoss: number
}

export interface PensionHistoricalAssets {
  planName: string
  lastLogin: Date
  entries: PensionHistoricalAssetEntry[]
}

/** Provider-neutral operations for defined-contribution pension accounts. */
export type PensionMethods = {
  'pension.participant.get': MethodDefinition<Record<string, never>, PensionParticipant>
  'pension.assets.current.get': MethodDefinition<Record<string, never>, PensionCurrentAssets>
  'pension.contribution.get': MethodDefinition<Record<string, never>, PensionContribution>
  'pension.assets.history.list': MethodDefinition<Record<string, never>, PensionHistoricalAssets>
}

export interface MethodDefinition<Request, Response> {
  request: Request
  response: Response
}

export type MethodMap = Record<string, MethodDefinition<unknown, unknown>>

/** Operations shared by all financial providers when they advertise the matching capability. */
export type CommonMethods = {
  'accounts.list': MethodDefinition<PageRequest, Page<Account>>
  'balances.list': MethodDefinition<{ account?: string }, Balance[]>
  'assets.valuation.get': MethodDefinition<{ account?: string }, AssetValuation>
  'transactions.list': MethodDefinition<DateRangeRequest, Page<Transaction>>
  'history.list': MethodDefinition<HistoryListRequest, Page<HistoryItem>>
  'transfers.recipients.list': MethodDefinition<PageRequest, Page<TransferRecipient>>
}

export type ProviderMethods = CommonMethods & InvestmentMethods & PensionMethods

export type MethodName<Methods> = Extract<keyof Methods, string>
export type MethodRequest<Methods, Name extends MethodName<Methods>> =
  Methods[Name] extends MethodDefinition<infer Request, unknown> ? Request : never
export type MethodResponse<Methods, Name extends MethodName<Methods>> =
  Methods[Name] extends MethodDefinition<unknown, infer Response> ? Response : never

export type AvailabilityFailureReason =
  | 'CAPTCHA_REQUIRED'
  /** Legacy misspelling retained for wire compatibility. */
  | 'CAPTCHA_REQIRED'
  | '2FA_REQUIRED'
  | 'AUTHENTICATION_REQUIRED'
  | 'MARKET_CLOSED'
  | 'INSTRUMENT_UNSUPPORTED'
  | 'OPERATION_UNSUPPORTED'
  | 'PROVIDER_RESTRICTED'
  | 'UNKNOWN'
export type AvailabilityCheckResult =
  | { ok: true }
  | { ok: false; message: unknown; reason: AvailabilityFailureReason }

export interface MethodAvailabilityRequest {
  method: string
  params?: unknown
}

export type MethodAvailability =
  | {
      available: true
      /** Present for investment order operations when known by the provider. */
      orderRules?: InvestmentOrderRules
      /** Trusted transaction amount resolved by the provider, for example from a confirmation token. */
      transactionAmount?: Money
      notices?: string[]
    }
  | {
      available: false
      reason: AvailabilityFailureReason
      message: unknown
      retryAt?: string
    }

export interface ProviderAvailability {
  connection: AvailabilityCheckResult
  methods: Record<string, MethodAvailability>
  checkedAt: string
}

/**
 * The public contract of every provider. Provider-specific login is allowed,
 * but an authenticated provider exposes only this common invocation surface.
 */
export interface FinancialProvider<Methods = CommonMethods> {
  readonly descriptor: ProviderDescriptor
  readonly accountId: string
  /** Required before the server can safely offer trading through virtual accounts. */
  readonly accountIsolation?: {
    physicalCashIncludesReservations: true
    stableOrderReferences: true
    attributableSettlementEffects: true
    completeOpenOrderSnapshot: true
  }
  readonly transactionObservationPolicy?: TransactionObservationPolicy
  capabilities(): readonly Capability[]
  methods(): readonly MethodName<Methods>[]
  /**
   * Verifies that the authenticated profile can still make an authenticated request.
   * Returns the provider failure message instead of throwing when unavailable.
   */
  checkAvailability(): Promise<AvailabilityCheckResult>
  /**
   * Checks a method against provider-, account-, instrument-, and market-specific rules.
   * Providers may omit this method; callers then derive availability from methods().
   */
  checkMethodAvailability?(request: MethodAvailabilityRequest): Promise<MethodAvailability>
  invoke<Name extends MethodName<Methods>>(
    name: Name,
    request: MethodRequest<Methods, Name>,
  ): Promise<MethodResponse<Methods, Name>>
  exportSession(): unknown
  close(): void | Promise<void>
}
