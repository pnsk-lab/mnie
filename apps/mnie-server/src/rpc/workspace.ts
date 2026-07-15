import type { EventsListRequest, HistoryListRequest } from '@mnie/types'
import { fetchAssetValuation } from '../assets'
import type { Db } from '../db'
import { listHistory } from '../history'
import { listTransactionObservations } from '../observations'
import { loadPortfolioOverview, type OverviewProfile } from '../portfolio-overview'
import type { ProviderRegistry } from '../providers/registry'
import {
  confirmReconciliationProposal,
  deleteAccountLink,
  getEconomicEvent,
  listAccountLinks,
  listFinancialAccounts,
  listEconomicEvents,
  listReconciliationProposals,
  rejectReconciliationProposal,
  upsertAccountLink,
} from '../reconciliation'

export const WORKSPACE_OPERATIONS = [
  'profiles.list',
  'portfolio.valuation.get',
  'portfolio.overview.get',
  'history.list',
  'transaction-observations.list',
  'financial-accounts.list',
  'events.list',
  'events.get',
  'reconciliation.proposals.list',
  'reconciliation.confirm',
  'reconciliation.reject',
  'account-links.list',
  'account-links.upsert',
  'account-links.delete',
] as const

export const invokeWorkspace = async (
  db: Db,
  providers: ProviderRegistry,
  operation: string,
  input: Record<string, unknown>,
) => {
  if (operation === 'profiles.list') {
    return (await providers.profiles()).map((profile) => providers.descriptor(profile))
  }

  if (operation === 'portfolio.overview.get') {
    const profiles = await providers.profiles()
    return loadPortfolioOverview(
      profiles.map(
        (profile): OverviewProfile => ({
          descriptor: providers.descriptor(profile),
          use: (action) => providers.use(profile, ({ provider }) => action(provider)),
        }),
      ),
    )
  }

  if (operation === 'history.list') {
    return listHistory(db, providers, input as HistoryListRequest & { profileIds?: string[] })
  }

  if (operation === 'transaction-observations.list') return listTransactionObservations(db)

  if (operation === 'events.list') return listEconomicEvents(db, input as EventsListRequest)
  if (operation === 'financial-accounts.list') return listFinancialAccounts(db)
  if (operation === 'events.get') return getEconomicEvent(db, String(input.eventId ?? ''))
  if (operation === 'reconciliation.proposals.list') return listReconciliationProposals(db, input)
  if (operation === 'reconciliation.confirm') {
    return confirmReconciliationProposal(db, String(input.proposalId ?? ''))
  }
  if (operation === 'reconciliation.reject') {
    await rejectReconciliationProposal(
      db,
      String(input.proposalId ?? ''),
      typeof input.reason === 'string' ? input.reason : undefined,
    )
    return undefined
  }
  if (operation === 'account-links.list') return listAccountLinks(db)
  if (operation === 'account-links.upsert') return upsertAccountLink(db, input as never)
  if (operation === 'account-links.delete') {
    await deleteAccountLink(db, String(input.id ?? ''))
    return undefined
  }

  if (operation === 'portfolio.valuation.get') {
    const baseCurrency = String(input.baseCurrency ?? 'JPY')
    const requested = Array.isArray(input.profileIds)
      ? new Set(input.profileIds.map(String))
      : undefined
    const profiles = (await providers.profiles()).filter(
      (profile) => !requested || requested.has(profile.id),
    )
    const settled = await Promise.allSettled(
      profiles.map(async (profile) => ({
        profile,
        valuation: await fetchAssetValuation(providers, profile),
      })),
    )
    const components = settled.flatMap((item) =>
      item.status === 'fulfilled'
        ? [
            {
              profileId: item.value.profile.id,
              providerId: item.value.profile.provider,
              label: item.value.profile.label,
              originalAmount: {
                currency: item.value.valuation.currency,
                value: String(item.value.valuation.value),
              },
              convertedAmount: {
                currency: item.value.valuation.currency,
                value: String(item.value.valuation.value),
              },
              asOf: new Date().toISOString(),
            },
          ]
        : [],
    )
    if (components.some((component) => component.originalAmount.currency !== baseCurrency)) {
      throw new Error('portfolio valuation requires an explicit currency conversion provider')
    }
    const errors = settled.flatMap((item, index) =>
      item.status === 'rejected'
        ? [
            {
              profileId: profiles[index]!.id,
              message: item.reason instanceof Error ? item.reason.message : String(item.reason),
            },
          ]
        : [],
    )
    return {
      baseCurrency,
      total: {
        currency: baseCurrency,
        value: String(
          components.reduce((sum, item) => sum + Number(item.convertedAmount.value), 0),
        ),
      },
      asOf: new Date().toISOString(),
      completeness: errors.length ? 'partial' : 'complete',
      components,
      errors,
    }
  }

  throw new Error(`workspace operation not found: ${operation}`)
}
