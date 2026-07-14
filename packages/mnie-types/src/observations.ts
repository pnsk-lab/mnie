import type { AccountKind, Transaction } from './financial'

/** Fidelity of a provider-supplied transaction timestamp. */
export type TimePrecision = 'instant' | 'minute' | 'day'

export type ObservationOperation =
  | 'wallet-topup'
  | 'purchase'
  | 'bank-transfer'
  | 'card-settlement'
  | 'cash-withdrawal'
  | 'unknown'

/**
 * A provider observation is one account's view of a transaction.  It is not
 * an assertion that another account observed the same economic event.
 */
export interface TransactionObservation {
  /** Mnie-owned, persistent observation identity. */
  id: string
  profileId: string
  accountId: string
  source: {
    connectorTypeId: string
    institutionId: string
    providerAccountId: string
    /** Present only when the provider supplies a stable upstream identifier. */
    providerTransactionId?: string
    /** Stable content fingerprint used to align snapshots without an upstream ID. */
    fingerprint: string
    revision: number
    firstSeenAt: string
    lastSeenAt: string
  }
  transaction: Transaction
  timestamps: {
    occurredAt: string
    precision: TimePrecision
    authorizedAt?: string
    postedAt?: string
    valueDate?: string
  }
  hints?: {
    operation?: ObservationOperation
    counterparty?: { id?: string; name: string; confidence?: number }
    rail?: 'visa' | 'mastercard' | 'bank-transfer' | 'cash' | 'other'
    instrument?: {
      kind: 'debit-card' | 'credit-card' | 'prepaid-card' | 'bank-account'
      last4?: string
    }
    references?: Record<string, string>
  }
}

/** Provider-independent account record used by future reconciliation. */
export interface FinancialAccount {
  id: string
  profileId: string
  connectorTypeId: string
  institutionId: string
  providerAccountId: string
  kind: AccountKind
  createdAt: string
  updatedAt: string
}
