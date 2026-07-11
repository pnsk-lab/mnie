import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  OperationName,
  OperationRequest,
  OperationResponse,
  Page,
  Transaction,
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

export type * from '@mnie/types'
