import { assertApiKeyMethodAllowed } from '../security/trade-limits'
import {
  accountSelection,
  accountHistory,
  accountOverview,
  accountValuation,
  accountPositions,
  accountOrders,
} from '../account-read-model'
import type { EventsListRequest } from '@mnie/types'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import { listTransactionObservations } from '../observations'
import {
  confirmReconciliationProposal,
  deleteAccountLink,
  getEconomicEvent,
  listAccountLinks,
  listEconomicEvents,
  listReconciliationProposals,
  rejectReconciliationProposal,
  upsertAccountLink,
} from '../reconciliation'
import {
  getVirtualAccount,
  listVirtualAccountAssets,
  listVirtualAccounts,
} from '../virtual-accounts'
import { STATIC_METHODS } from './methods'

export const PORTFOLIO_METHODS = (STATIC_METHODS as readonly string[]).filter((method) =>
  method.startsWith('portfolio.'),
)

const isLedgerWrite = (method: string) =>
  method === 'portfolio.ledger.reconciliation.confirm' ||
  method === 'portfolio.ledger.reconciliation.reject' ||
  method === 'portfolio.ledger.account-links.upsert' ||
  method === 'portfolio.ledger.account-links.delete'

export const invokePortfolio = async (
  db: Db,
  providers: ProviderRegistry,
  method: string,
  input: Record<string, unknown>,
  access: { owner: boolean; apiKeyId?: string } = { owner: false },
) => {
  if (
    !access.owner &&
    access.apiKeyId &&
    [
      'portfolio.accounts.list',
      'portfolio.accounts.get',
      'portfolio.accounts.balances',
      'portfolio.accounts.positions',
      'portfolio.accounts.orders',
      'portfolio.accounts.history',
      'portfolio.history.list',
      'portfolio.overview.get',
      'portfolio.valuation.get',
    ].includes(method)
  ) {
    await accountSelection(db, access, input)
    await assertApiKeyMethodAllowed(db, access.apiKeyId, method)
  }
  if (method === 'portfolio.accounts.list')
    return { accounts: await listVirtualAccounts(db, access) }
  if (method === 'portfolio.accounts.get') {
    return { account: await getVirtualAccount(db, String(input.account ?? ''), access) }
  }
  if (method === 'portfolio.accounts.balances') {
    return {
      assets: await listVirtualAccountAssets(db, String(input.account ?? ''), access),
    }
  }

  if (method === 'portfolio.accounts.positions')
    return { items: await accountPositions(db, String(input.account ?? ''), access) }
  if (method === 'portfolio.accounts.orders')
    return { items: await accountOrders(db, String(input.account ?? ''), access) }
  if (method === 'portfolio.accounts.history') return accountHistory(db, access, input)
  if (method === 'portfolio.overview.get')
    return accountOverview(
      db,
      access,
      input,
      new Map(
        providers.definitions().map((definition) => [definition.id, definition.defaultColor]),
      ),
    )
  if (method === 'portfolio.valuation.get') return accountValuation(db, access, input)
  if (method === 'portfolio.history.list') return accountHistory(db, access, input)
  // Physical observations and reconciliation evidence are owner-only.
  if (!access.owner) throw new Error('owner session is required')

  if (method === 'portfolio.ledger.observations.list') {
    return listTransactionObservations(db)
  }

  if (method === 'portfolio.ledger.events.list')
    return listEconomicEvents(db, input as EventsListRequest)
  if (method === 'portfolio.ledger.events.get')
    return getEconomicEvent(db, String(input.eventId ?? ''))
  if (method === 'portfolio.ledger.reconciliation.proposals.list')
    return listReconciliationProposals(db, input)
  if (method === 'portfolio.ledger.reconciliation.confirm') {
    return confirmReconciliationProposal(db, String(input.proposalId ?? ''))
  }
  if (method === 'portfolio.ledger.reconciliation.reject') {
    await rejectReconciliationProposal(
      db,
      String(input.proposalId ?? ''),
      typeof input.reason === 'string' ? input.reason : undefined,
    )
    return undefined
  }
  if (method === 'portfolio.ledger.account-links.list') return listAccountLinks(db)
  if (method === 'portfolio.ledger.account-links.upsert')
    return upsertAccountLink(db, input as never)
  if (method === 'portfolio.ledger.account-links.delete') {
    await deleteAccountLink(db, String(input.id ?? ''))
    return undefined
  }

  throw new Error(`portfolio method not found: ${method}`)
}

export const assertPortfolioScope = (
  state: { apiKeyId?: string; scopes?: string[] },
  method: string,
) => {
  if (state.apiKeyId && !(state.scopes ?? []).includes('read')) {
    throw new Error('missing OAuth scope: read')
  }
  if (state.apiKeyId && isLedgerWrite(method) && !(state.scopes ?? []).includes('reconcile')) {
    throw new Error('missing OAuth scope: reconcile')
  }
}
