import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  FinancialWorkspace,
  OperationName,
  OperationRequest,
  OperationResponse,
  Page,
  ProfileDescriptor,
  PortfolioValuation,
  Transaction,
  WorkspaceOperations,
} from '@mnie/types'

/** Calls an operation supported by the selected provider. */
export const invoke = <Operations, Name extends OperationName<Operations>>(
  provider: FinancialProvider<Operations>,
  name: Name,
  request: OperationRequest<Operations, Name>,
): Promise<OperationResponse<Operations, Name>> => provider.invoke(name, request)

export const listAccounts = (provider: FinancialProvider<CommonOperations>, request = {}) =>
  provider.invoke('accounts.list', request) as Promise<Page<Account>>

export const listBalances = (
  provider: FinancialProvider<CommonOperations>,
  request: { accountId?: string } = {},
) => provider.invoke('balances.list', request) as Promise<Balance[]>

export const listTransactions = (
  provider: FinancialProvider<CommonOperations>,
  request: OperationRequest<CommonOperations, 'transactions.list'>,
) => provider.invoke('transactions.list', request) as Promise<Page<Transaction>>

export const listTransferRecipients = (
  provider: FinancialProvider<CommonOperations>,
  request = {},
) => provider.invoke('transfers.recipients.list', request)

export const exportSession = (provider: FinancialProvider) => provider.exportSession()

export interface LocalWorkspaceProfile {
  profile: ProfileDescriptor
  provider: FinancialProvider<CommonOperations>
}

export const createLocalWorkspace = (
  entries: LocalWorkspaceProfile[],
): FinancialWorkspace<WorkspaceOperations, CommonOperations> => {
  const providers = new Map(entries.map((entry) => [entry.profile.id, entry]))
  if (providers.size !== entries.length) throw new Error('profile IDs must be unique')
  return {
    operations: () => ['profiles.list', 'portfolio.valuation.get'],
    profiles: async () => entries.map((entry) => entry.profile),
    profile: (profileId) => {
      const entry = providers.get(profileId)
      if (!entry) throw new Error(`profile not found: ${profileId}`)
      return entry.provider
    },
    invoke: async (name, request) => {
      if (name === 'profiles.list') return entries.map((entry) => entry.profile) as never
      if (name !== 'portfolio.valuation.get')
        throw new Error(`unsupported workspace operation: ${name}`)
      const input = request as { baseCurrency: string; profileIds?: string[] }
      const selected = input.profileIds
        ? input.profileIds.map(
            (id) =>
              providers.get(id) ??
              (() => {
                throw new Error(`profile not found: ${id}`)
              })(),
          )
        : entries
      const settled = await Promise.allSettled(
        selected.map(async ({ profile, provider }) => ({
          profile,
          valuation: await provider.invoke('assets.valuation.get', {}),
        })),
      )
      const components = settled.flatMap((item) => {
        if (item.status === 'rejected') return []
        const { profile, valuation } = item.value
        if (valuation.amount.currency !== input.baseCurrency) {
          throw new Error(`currency conversion is required for ${valuation.amount.currency}`)
        }
        return [
          {
            profileId: profile.id,
            providerId: profile.provider.id,
            label: profile.label,
            originalAmount: valuation.amount,
            convertedAmount: valuation.amount,
            asOf: valuation.asOf,
          },
        ]
      })
      const errors = settled.flatMap((item, index) =>
        item.status === 'rejected'
          ? [
              {
                profileId: selected[index]!.profile.id,
                message: item.reason instanceof Error ? item.reason.message : String(item.reason),
              },
            ]
          : [],
      )
      const total = components.reduce((sum, item) => sum + Number(item.convertedAmount.value), 0)
      return {
        baseCurrency: input.baseCurrency,
        total: { currency: input.baseCurrency, value: String(total) },
        asOf: new Date().toISOString(),
        completeness: errors.length ? 'partial' : 'complete',
        components,
        errors,
      } satisfies PortfolioValuation as never
    },
    close: async () => {
      await Promise.all(entries.map(({ provider }) => provider.close()))
    },
  }
}

export type * from '@mnie/types'
