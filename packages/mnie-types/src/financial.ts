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

export interface ProviderDescriptor {
  id: ProviderId
  name: string
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

export interface OperationDefinition<Request, Response> {
  request: Request
  response: Response
}

export type OperationMap = Record<string, OperationDefinition<unknown, unknown>>

/** Operations shared by all financial providers when they advertise the matching capability. */
export type CommonOperations = {
  'accounts.list': OperationDefinition<PageRequest, Page<Account>>
  'balances.list': OperationDefinition<{ accountId?: string }, Balance[]>
  'transactions.list': OperationDefinition<DateRangeRequest, Page<Transaction>>
  'transfers.recipients.list': OperationDefinition<PageRequest, Page<TransferRecipient>>
}

export type FinancialOperations = CommonOperations & InvestmentOperations

export type OperationName<Operations> = Extract<keyof Operations, string>
export type OperationRequest<Operations, Name extends OperationName<Operations>> =
  Operations[Name] extends OperationDefinition<infer Request, unknown> ? Request : never
export type OperationResponse<Operations, Name extends OperationName<Operations>> =
  Operations[Name] extends OperationDefinition<unknown, infer Response> ? Response : never

export type AvailabilityCheckResult = { ok: true } | { ok: false; message: unknown }

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
