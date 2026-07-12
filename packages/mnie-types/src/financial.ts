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

export interface PageRequest {
  cursor?: string
  limit?: number
}

export interface DateRangeRequest extends PageRequest {
  accountId?: string
  from?: string
  to?: string
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

export interface InvestmentPosition {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  quantity: string
  positionType: 'cash' | 'margin'
  side?: 'long' | 'short'
  marketValue?: Money
  unrealizedProfitLoss?: Money
}

export interface InvestmentOrderRequest {
  accountId: string
  instrumentId: string
  side: 'buy' | 'sell'
  quantity: string
  positionType?: 'cash' | 'margin'
  allowTransaction?: true
}

export interface InvestmentOrderPreview {
  estimatedAmount?: Money
  warnings: string[]
  confirmationToken?: string
}

export interface InvestmentOrder {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  side: 'buy' | 'sell'
  status: 'open' | 'executed' | 'cancelled' | 'expired' | 'rejected' | 'unknown'
  quantity?: string
  executedQuantity?: string
  price?: Money
  orderedAt?: string
}

export type InvestmentOperations = {
  'investments.positions.list': OperationDefinition<
    PageRequest & { accountId?: string; positionType?: 'cash' | 'margin' },
    Page<InvestmentPosition>
  >
  'investments.orders.preview': OperationDefinition<InvestmentOrderRequest, InvestmentOrderPreview>
  'investments.orders.list': OperationDefinition<
    PageRequest & { accountId?: string; status?: InvestmentOrder['status'] },
    Page<InvestmentOrder>
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
export type PensionOperations = {
  'pension.participant.get': OperationDefinition<Record<string, never>, PensionParticipant>
  'pension.assets.current.get': OperationDefinition<Record<string, never>, PensionCurrentAssets>
  'pension.contribution.get': OperationDefinition<Record<string, never>, PensionContribution>
  'pension.assets.history.list': OperationDefinition<Record<string, never>, PensionHistoricalAssets>
}

export interface OperationDefinition<Request, Response> {
  request: Request
  response: Response
}

export type OperationMap = Record<string, OperationDefinition<unknown, unknown>>

/** Operations shared by all financial providers when they advertise the matching capability. */
export type CommonOperations = {
  'accounts.list': OperationDefinition<PageRequest, Page<Account>>
  'balances.list': OperationDefinition<{ accountId?: string }, Balance[]>
  'assets.valuation.get': OperationDefinition<{ accountId?: string }, AssetValuation>
  'transactions.list': OperationDefinition<DateRangeRequest, Page<Transaction>>
  'transfers.recipients.list': OperationDefinition<PageRequest, Page<TransferRecipient>>
}

export type FinancialOperations = CommonOperations & InvestmentOperations & PensionOperations

export type WorkspaceOperations = {
  'profiles.list': OperationDefinition<{}, ProfileDescriptor[]>
  'portfolio.valuation.get': OperationDefinition<
    { baseCurrency: string; profileIds?: string[] },
    PortfolioValuation
  >
}

export type OperationName<Operations> = Extract<keyof Operations, string>
export type OperationRequest<Operations, Name extends OperationName<Operations>> =
  Operations[Name] extends OperationDefinition<infer Request, unknown> ? Request : never
export type OperationResponse<Operations, Name extends OperationName<Operations>> =
  Operations[Name] extends OperationDefinition<unknown, infer Response> ? Response : never

export type AvailabilityFailureReason = 'CAPTCHA_REQIRED' | '2FA_REQUIRED' | 'UNKNOWN'
export type AvailabilityCheckResult =
  | { ok: true }
  | { ok: false; message: unknown; reason: AvailabilityFailureReason }

/**
 * The public contract of every provider. Provider-specific login is allowed,
 * but an authenticated provider exposes only this common invocation surface.
 */
export interface FinancialProvider<Operations = CommonOperations> {
  readonly descriptor: ProviderDescriptor
  readonly accountId: string
  capabilities(): readonly Capability[]
  operations(): readonly OperationName<Operations>[]
  /**
   * Verifies that the authenticated profile can still make an authenticated request.
   * Returns the provider failure message instead of throwing when unavailable.
   */
  checkAvailability(): Promise<AvailabilityCheckResult>
  invoke<Name extends OperationName<Operations>>(
    name: Name,
    request: OperationRequest<Operations, Name>,
  ): Promise<OperationResponse<Operations, Name>>
  exportSession(): unknown
  close(): void | Promise<void>
}

export interface FinancialWorkspace<
  Operations = WorkspaceOperations,
  ProviderOperations = OperationMap,
> {
  operations(): readonly OperationName<Operations>[] | Promise<readonly OperationName<Operations>[]>
  profiles(): Promise<ProfileDescriptor[]>
  profile(profileId: string): FinancialProvider<ProviderOperations>
  invoke<Name extends OperationName<Operations>>(
    name: Name,
    request: OperationRequest<Operations, Name>,
  ): Promise<OperationResponse<Operations, Name>>
  close(): void | Promise<void>
}
