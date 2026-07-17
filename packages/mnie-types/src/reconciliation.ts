import type { Amount, Page, PageRequest, Transaction } from './financial'
import type { FinancialAccount, TransactionObservation } from './observations'

export type EconomicEventKind =
  | 'transfer'
  | 'wallet-topup'
  | 'purchase'
  | 'card-settlement'
  | 'card-statement'
  | 'refund'
  | 'reversal'
  | 'fee'
  | 'reward'
  | 'unknown'

export interface EconomicEvent {
  id: string
  kind: EconomicEventKind
  state: 'proposed' | 'confirmed' | 'superseded'
  completeness: 'partial' | 'complete'
  occurredAt: { from: string; to: string }
  metadata?: {
    counterpartyId?: string
    rail?: string
    description?: string
    statementId?: string
  }
  createdAt: string
  updatedAt: string
}

export type LedgerAccountClass =
  | 'asset'
  | 'liability'
  | 'income'
  | 'expense'
  | 'equity'
  | 'external'

export interface LedgerAccount {
  id: string
  class: LedgerAccountClass
  financialAccountId?: string
  name: string
}

export interface Posting {
  id: string
  eventId: string
  ledgerAccountId: string
  side: 'debit' | 'credit'
  amount: Amount
  role?: 'source' | 'destination' | 'fee' | 'tax' | 'liability' | 'external'
}

export type MatchEvidence =
  | { kind: 'same-amount'; value: string; currency: string }
  | { kind: 'time-distance'; milliseconds: number }
  | { kind: 'account-link'; accountLinkId: string }
  | { kind: 'reference-id'; name: string; value: string }
  | { kind: 'counterparty'; name: string; confidence: number }
  | { kind: 'rail'; value: string }
  | { kind: 'competing-candidates'; count: number }
  | { kind: 'rule'; ruleId: string }

export interface ObservationBinding {
  id: string
  observationId: string
  eventId: string
  postingIds?: string[]
  state: 'proposed' | 'confirmed' | 'rejected'
  provenance: 'provider-reference' | 'deterministic-rule' | 'statistical-model' | 'user'
  confidence?: number
  matcherVersion?: string
  evidence: MatchEvidence[]
  createdAt: string
  updatedAt: string
}

export type EventRelationType =
  | 'settles'
  | 'aggregates'
  | 'refunds'
  | 'reverses'
  | 'fee-of'
  | 'supersedes'

export interface EventRelation {
  id: string
  fromEventId: string
  toEventId: string
  type: EventRelationType
  createdAt: string
}

export interface AccountLink {
  id: string
  sourceAccountId: string
  targetAccountId: string
  type: 'funds' | 'settles' | 'withdraws-from' | 'receives-from'
  instrument?: {
    kind: 'debit-card' | 'credit-card' | 'bank-account'
    network?: 'visa' | 'mastercard' | 'other'
    last4?: string
  }
  validFrom?: string
  validTo?: string
  source: 'user' | 'provider' | 'inferred'
  confirmed: boolean
}

export type AccountLinkInput = Omit<AccountLink, 'id'> & { id?: string }

export interface EconomicEventView {
  event: EconomicEvent
  postings: Posting[]
  bindings: Array<ObservationBinding & { observation?: TransactionObservation }>
  relations: EventRelation[]
}

export interface EventsListRequest extends PageRequest {
  accountId?: string
  from?: string
  to?: string
  states?: EconomicEvent['state'][]
}

export interface ReconciliationProposal {
  id: string
  candidateKey: string
  event: EconomicEvent
  observations: Transaction[]
  bindings: ObservationBinding[]
  score: number
  createdAt: string
}

export interface ReconciliationProposalRequest extends PageRequest {
  states?: Array<'proposed' | 'rejected' | 'confirmed'>
}

export interface ReconciliationDecision {
  id: string
  proposalId: string
  candidateKey: string
  decision: 'confirmed' | 'rejected'
  reason?: string
  decidedAt: string
}

/** Optional enrichment boundary; no provider is configured by default. */
export interface EnrichmentProvider {
  readonly version: string
  enrich(observations: TransactionObservation[]): Promise<
    Array<{
      observationId: string
      operation?: string
      counterparty?: { name: string; confidence: number }
      rail?: string
    }>
  >
}

export type ReconciliationOperations = {
  'transaction-observations.list': {
    request: Record<string, never>
    response: TransactionObservation[]
  }
  'financial-accounts.list': { request: Record<string, never>; response: FinancialAccount[] }
  'events.list': { request: EventsListRequest; response: Page<EconomicEventView> }
  'events.get': { request: { eventId: string }; response: EconomicEventView }
  'reconciliation.proposals.list': {
    request: ReconciliationProposalRequest
    response: Page<ReconciliationProposal>
  }
  'reconciliation.confirm': { request: { proposalId: string }; response: EconomicEventView }
  'reconciliation.reject': { request: { proposalId: string; reason?: string }; response: void }
  'account-links.list': { request: Record<string, never>; response: AccountLink[] }
  'account-links.upsert': { request: AccountLinkInput; response: AccountLink }
  'account-links.delete': { request: { id: string }; response: void }
}
