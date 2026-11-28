export interface AuthStatus {
  configured: boolean
  authenticated: boolean
}

export interface ApiKey {
  id: string
  label: string
  accountBindings?: Array<{
    accountId: string
    role: 'read' | 'trade'
    allowedMethods?: string[] | null
  }>
  maxOrderPriceJpy?: number | null
  maxOrderAmountJpy?: number | null
  allowedMethods?: string[] | null
  scopes?: string[] | null
  createdAt: string
  lastUsedAt?: string | null
  revokedAt?: string | null
  token?: string
}

export type ApiKeySettings = Pick<
  ApiKey,
  'accountBindings' | 'maxOrderPriceJpy' | 'maxOrderAmountJpy' | 'allowedMethods' | 'scopes'
>

export interface SbiPasskey {
  id: string
  label: string
  createdAt: string
  updatedAt: string
}

export interface AuthManagerConfig {
  id: string
  kind: 'bitwarden'
  label: string
  createdAt: string
  updatedAt: string
}

export interface FilledAuthCredential {
  id: string
  name: string
  username?: string
  password?: string
  passkeys: Array<{
    credentialId: string
    rpId: string
    userName?: string
    portableCredential?: unknown
  }>
}

export type SbiPasskeySource =
  | { kind: 'json'; credential: unknown }
  | {
      kind: 'bitwarden'
      masterPassword: string
      rpId: string
      dataPath?: string
      origin?: string
      credentialId?: string
    }

export interface AccountProfile {
  id: string
  provider: string
  providerName: string
  category: 'brokerage' | 'bank' | 'transit' | 'pension' | 'other'
  defaultColor: string
  label: string
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface ProviderDefinition {
  id: string
  name: string
  kind: string
  authentication: string
  defaultColor?: string
  credentialFields: Array<{
    name: string
    kind: string
    required: boolean
    secret: boolean
  }>
}

export interface PortfolioOverviewPosition {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  venue?: string
  quantity: string
  positionType: 'cash' | 'margin'
  marketValue?: { currency: string; value: string }
  unrealizedProfitLoss?: { currency: string; value: string }
  accountType?: string
}

export interface PortfolioOverviewOrder {
  id: string
  accountId: string
  instrumentId: string
  instrumentName?: string
  side: 'buy' | 'sell'
  status: 'open' | 'executed' | 'cancelled' | 'expired' | 'rejected' | 'unknown'
  quantity?: string
  price?: { currency: string; value: string }
  orderedAt?: string
}

export interface PortfolioOverview {
  components: Array<{
    profile: {
      id: string
      provider: { id: string; name: string }
      label: string
      category: AccountProfile['category']
      defaultColor: string
    }
    accounts: Array<{ id: string; providerId: string; kind: string; name: string }>
    valuation?: {
      amount: { currency: string; value: string }
      holdingsAmount?: { currency: string; value: string }
      cashAmount?: { currency: string; value: string }
      asOf: string
    }
    balances?: unknown[]
    positions?: PortfolioOverviewPosition[]
    orders?: PortfolioOverviewOrder[]
  }>
  errors: Array<{ profileId: string; providerId: string; operation: string; message: string }>
  asOf: string
}

export interface AssetValuation {
  profileId: string
  provider: AccountProfile['provider']
  value: number
  holdingsValue?: number | null
  cashValue?: number | null
  currency: string
  capturedAt: string
}

export interface HistoryItem {
  kind: 'transaction' | 'valuation' | 'snapshot'
  profileId?: string
  occurredAt: string
  transaction?: MobileSuicaTransaction & { accountId: string }
  snapshot?: {
    accountId: string
    capturedAt: string
    balances: unknown[]
    positions?: unknown[]
    valuation?: {
      amount: { currency: string; value: string }
      asOf: string
      holdingsAmount?: { currency: string; value: string }
      cashAmount?: { currency: string; value: string }
    }
  }
}

export interface HistoryListError {
  profileId: string
  providerId: string
  message: string
  reason?: 'INTERACTION_REQUIRED'
}

export interface ReconciliationProposal {
  id: string
  score: number
  event: {
    id: string
    kind: string
    state: string
    completeness: string
    occurredAt: { from: string; to: string }
    metadata?: { rail?: string; description?: string }
  }
  observations: Array<{
    id: string
    description: string
    direction: 'credit' | 'debit' | 'neutral'
    amount: { kind: 'money'; money: { currency: string; value: string } } | null
    occurredAt: string
  }>
  bindings: Array<{
    id: string
    observationId: string
    evidence: Array<{ kind: string; count?: number }>
  }>
}

export interface FinancialAccount {
  id: string
  connectorTypeId: string
  providerAccountId: string
  kind: string
}

export interface PublicFinancialAccount {
  id: string
  implementation: 'virtual-brokerage' | 'passthrough-readonly'
  category: 'brokerage' | 'bank' | 'transit' | 'pension' | 'other'
  provider?: string
  label: string
  kind: 'standard' | 'system'
  status: 'active' | 'frozen' | 'reconciliation_required' | 'closed'
  capabilities: string[]
  permissions: { read: boolean; trade: boolean; manage: boolean }
  color?: string
  icon?: string
  version: number
}

export interface ManagedVirtualAccount extends PublicFinancialAccount {
  physicalAccountId: string
  profileId: string
  providerAccountId: string
  connectorTypeId: string
  physicalAccountKind: string
  policy: Record<string, unknown>
}

export interface VirtualAccountAsset {
  accountId: string
  assetKey: string
  assetKind: 'cash' | 'security'
  available: string
  reserved: string
  pending: string
  version: number
  updatedAt: string
}

export interface TransactionObservation {
  id: string
  accountId: string
  source: { connectorTypeId: string; providerAccountId: string }
  transaction: {
    id: string
    kind: string
    direction: 'credit' | 'debit' | 'neutral'
    status: 'pending' | 'posted' | 'reversed' | 'failed'
    amount:
      | { kind: 'money'; money: { currency: string; value: string } }
      | { kind: 'points'; unit: string; value: string }
      | null
    description: string
  }
  timestamps: { occurredAt: string; precision: 'instant' | 'minute' | 'day' }
}

export type ProfileAvailability =
  | { ok: true; checkedAt?: string; methods?: Record<string, unknown> }
  | {
      ok: false
      message: unknown
      reason:
        | 'CAPTCHA_REQUIRED'
        | 'CAPTCHA_REQIRED'
        | '2FA_REQUIRED'
        | 'AUTHENTICATION_REQUIRED'
        | 'MARKET_CLOSED'
        | 'INSTRUMENT_UNSUPPORTED'
        | 'OPERATION_UNSUPPORTED'
        | 'PROVIDER_RESTRICTED'
        | 'UNKNOWN'
      checkedAt?: string
      methods?: Record<string, unknown>
    }

export interface CronJob {
  id: string
  label: string
  schedule: string
  running: boolean
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
}

export interface MobileSuicaTransaction {
  id: string
  type: string
  direction: 'credit' | 'debit' | 'neutral'
  occurredAt: string
  description: string
  amount?: { kind: 'money'; money: { currency: string; value: string } }
  balanceAfter?: { kind: 'money'; money: { currency: string; value: string } }
}

const httpRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })
  if (!response.ok) throw new Error((await response.text()) || response.statusText)
  return response.json() as Promise<T>
}

let rpcRequestId = 0

export const rpcRequest = async <T>(
  method: string,
  params?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> => {
  const response = await fetch(`/api/rpc/${method}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcRequestId,
      method,
      params: params ?? {},
    }),
  })
  const payload = (await response.json().catch(() => undefined)) as
    | {
        result?: unknown
        error?: { code?: number; message?: string; data?: { providerCode?: string } }
      }
    | undefined
  if (!response.ok)
    throw new Error(payload?.error?.message || response.statusText || 'RPC request failed')
  if (payload?.error) {
    const error = new Error(payload.error.message || 'RPC request failed') as Error & {
      providerCode?: string
    }
    error.providerCode = payload.error.data?.providerCode
    throw error
  }
  if (!payload || !('result' in payload)) throw new Error('サーバーからの応答が不正です')
  return payload.result as T
}

export const getStatus = () => httpRequest<AuthStatus>('/auth/status')

export const createSetupOptions = (password: string) =>
  httpRequest<{ options: unknown; challengeId: string }>('/auth/setup/options', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

export const verifySetup = (challengeId: string, response: unknown) =>
  httpRequest<{ ok: true }>('/auth/setup/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  })

export const createLoginOptions = () =>
  httpRequest<{ options: unknown; challengeId: string }>('/auth/login/options', {
    method: 'POST',
  })

export const verifyLogin = (challengeId: string, response: unknown) =>
  httpRequest<{ ok: true }>('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  })

export const createApiKey = (label: string, settings?: ApiKeySettings) =>
  rpcRequest<{ apiKey: ApiKey }>('admin.apiKeys.create', { label, settings })

export const listApiKeys = () => rpcRequest<{ apiKeys: ApiKey[] }>('admin.apiKeys.list')

export const updateApiKeySettings = (id: string, settings: ApiKeySettings) =>
  rpcRequest<{ ok: true }>('admin.apiKeys.update', { id, settings })

export const revokeApiKey = (id: string) => rpcRequest<{ ok: true }>('admin.apiKeys.revoke', { id })

export const listSbiPasskeys = async () => {
  const { profiles } = await listAccountProfiles()
  return {
    passkeys: profiles
      .filter((profile) => profile.provider === 'sbisec')
      .map(({ id, label, createdAt, updatedAt }) => ({ id, label, createdAt, updatedAt })),
  }
}

export const listAuthManagers = () =>
  rpcRequest<{ authManagers: AuthManagerConfig[] }>('admin.authManagers.list')

export const saveBitwardenAuthManager = (payload: { label: string; dataPath?: string }) =>
  rpcRequest<{ authManager: AuthManagerConfig }>('admin.authManagers.create', {
    kind: 'bitwarden',
    ...payload,
  })

export const deleteAuthManager = (id: string) =>
  rpcRequest<{ ok: true }>('admin.authManagers.delete', { id })

export const fillFromAuthManager = (id: string, provider: string, masterPassword: string) =>
  rpcRequest<{ credentials: FilledAuthCredential[] }>('admin.authManagers.credentials.list', {
    id,
    providerId: provider,
    masterPassword,
  })

export const saveSbiPasskey = (payload: {
  label: string
  source: SbiPasskeySource
  tradePassword?: string
  deviceId?: string
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'sbisec',
    label: payload.label,
    credentials: {
      source: payload.source,
      tradePassword: payload.tradePassword,
      deviceId: payload.deviceId,
    },
  }).then(({ profile }) => ({
    passkey: {
      id: profile.id,
      label: profile.label,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
  }))

export const deleteSbiPasskey = (id: string) =>
  rpcRequest<{ ok: true }>('admin.profiles.delete', { id })

export const listAccountProfiles = () =>
  rpcRequest<{ profiles: AccountProfile[] }>('admin.profiles.list')

export const syncAllAccountHistory = (profileId: string) =>
  rpcRequest<{
    profileId: string
    from: string
    to: string
    synced: number
    errors: HistoryListError[]
  }>('admin.history.sync', {
    profileId,
    from: new Date(0).toISOString(),
    to: new Date().toISOString(),
  })

export const syncAccountHistorySinceLast = (profileId: string) =>
  rpcRequest<{
    profileId: string
    from: string
    to: string
    synced: number
    errors: HistoryListError[]
  }>('admin.history.sync.since-last', { profileId })

export const listProviderDefinitions = () =>
  rpcRequest<{ providers: ProviderDefinition[] }>('admin.providers.list')

export const listLatestAssetValuations = async (account?: string) => {
  const overview = await getPortfolioOverview(account)
  return {
    valuations: overview.components.flatMap((component) =>
      component.valuation
        ? [
            {
              profileId: component.profile.id,
              provider: component.profile.provider.id,
              value: Number(component.valuation.amount.value),
              holdingsValue: Number(component.valuation.holdingsAmount?.value ?? 0),
              cashValue: Number(component.valuation.cashAmount?.value ?? 0),
              currency: component.valuation.amount.currency,
              capturedAt: component.valuation.asOf,
            },
          ]
        : [],
    ),
  }
}

export const getPortfolioOverview = (account?: string) =>
  rpcRequest<PortfolioOverview>('portfolio.overview.get', account ? { account } : {})

export const listHistory = (
  input: {
    profiles?: string[]
    account?: string
    accounts?: string[]
    from?: string
    to?: string
    kinds?: Array<'transaction' | 'valuation' | 'snapshot'>
    limit?: number
  } = {},
) =>
  rpcRequest<{ items: HistoryItem[]; errors: HistoryListError[] }>('portfolio.history.list', input)

export const listReconciliationProposals = (
  states: Array<'proposed' | 'rejected' | 'confirmed'> = ['proposed'],
) =>
  rpcRequest<{ items: ReconciliationProposal[] }>(
    'portfolio.ledger.reconciliation.proposals.list',
    { states },
  )

export type AdminAccount =
  | ({ layer: 'physical' } & FinancialAccount)
  | ({ layer: 'virtual' } & ManagedVirtualAccount)

export const listAdminAccounts = () =>
  rpcRequest<{ accounts: AdminAccount[] }>('admin.accounts.list')

export const listFinancialAccounts = async () => {
  const { accounts } = await listAdminAccounts()
  return accounts.filter(
    (account): account is { layer: 'physical' } & FinancialAccount => account.layer === 'physical',
  )
}

export const discoverFinancialAccounts = () =>
  rpcRequest<{ discovered: number }>('admin.accounts.discover')

export const listVirtualAccounts = () =>
  rpcRequest<{ accounts: PublicFinancialAccount[] }>('portfolio.accounts.list')

export const listVirtualAccountAssets = (account: string) =>
  rpcRequest<{ assets: VirtualAccountAsset[] }>('portfolio.accounts.balances', { account })

export const initializeVirtualAccounts = (physicalAccountId: string) =>
  rpcRequest<{ unallocated: PublicFinancialAccount }>('admin.accounts.initialize', {
    physicalAccountId,
  })

export const listVirtualAccountInitializations = () =>
  rpcRequest<{ physicalAccountIds: string[] }>('admin.accounts.initializations.list')

export const createVirtualAccount = (input: {
  physicalAccountId: string
  label: string
  allocations?: Array<{
    fromAccountId: string
    assetKey: string
    amount: string
    expectedFromVersion: number
    reason: string
  }>
}) => rpcRequest<{ account: PublicFinancialAccount }>('admin.accounts.create', input)

export const ensureDefaultVirtualAccounts = () =>
  rpcRequest<{
    created: number
    synced: number
    errors: Array<{ profileId: string; message: string }>
  }>('admin.accounts.defaults.ensure')

export const listManagedVirtualAccounts = async () => {
  const { accounts } = await listAdminAccounts()
  return {
    accounts: accounts.filter(
      (account): account is { layer: 'virtual' } & ManagedVirtualAccount =>
        account.layer === 'virtual',
    ),
  }
}

export const transferVirtualAsset = (input: {
  fromAccountId: string
  toAccountId: string
  assetKey: string
  amount: string
  expectedFromVersion: number
  expectedToVersion: number
  reason: string
}) => rpcRequest<{ id: string }>('admin.accounts.assets.transfer', input)

export const approveVirtualAccountReconciliation = (physicalAccountId: string) =>
  rpcRequest<{ ok: true }>('admin.accounts.reconciliation.approve', { physicalAccountId })

export const listTransactionObservations = () =>
  rpcRequest<TransactionObservation[]>('portfolio.ledger.observations.list')

export const listAccountLinks = () => rpcRequest<unknown[]>('portfolio.ledger.account-links.list')

export const saveAccountLink = (input: Record<string, unknown>) =>
  rpcRequest('portfolio.ledger.account-links.upsert', input)

export const confirmReconciliationProposal = (proposalId: string) =>
  rpcRequest('portfolio.ledger.reconciliation.confirm', { proposalId })

export const rejectReconciliationProposal = (proposalId: string, reason?: string) =>
  rpcRequest('portfolio.ledger.reconciliation.reject', {
    proposalId,
    ...(reason ? { reason } : {}),
  })

export const checkAccountProfileAvailability = () =>
  rpcRequest<{ availability: Record<string, ProfileAvailability> }>(
    'admin.profiles.availability.cached',
  )

export const checkProfileAvailability = (profileId: string) =>
  rpcRequest<{ availability: Record<string, ProfileAvailability> }>(
    'admin.profiles.availability.cached',
    { profileId },
  )

export const checkProfileAvailabilityLive = (profileId: string) =>
  rpcRequest<{ availability: Record<string, ProfileAvailability> }>(
    'admin.profiles.availability.refresh',
    { profileId },
  )

export const listCronJobs = () => rpcRequest<{ jobs: CronJob[] }>('admin.jobs.list')

export const saveSmbcDirectProfile = (payload: {
  label: string
  user: string
  password: string
  accountItemCode?: string
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'smbc-direct',
    label: payload.label,
    credentials: payload,
  })

export const savePayPayBankProfile = (payload: {
  label: string
  branchNo: string
  accountNo: string
  password: string
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'paypay-bank',
    label: payload.label,
    credentials: payload,
  })

export const saveVpassProfile = (payload: {
  label: string
  loginId: string
  password: string
  idKind?: 'vpass' | 'fa'
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'vpass',
    label: payload.label,
    credentials: {
      loginId: payload.loginId,
      password: payload.password,
      idKind: payload.idKind ?? 'vpass',
    },
  })

export const saveStarbucksProfile = (payload: {
  label: string
  username: string
  password: string
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'starbucks-jp',
    label: payload.label,
    credentials: {
      username: payload.username,
      password: payload.password,
    },
  })

export const savePayPaySecProfile = (payload: {
  label: string
  credential: unknown
  tradePassword: string
}) =>
  rpcRequest<{ profile: AccountProfile }>('admin.profiles.create', {
    providerId: 'paypay-sec',
    label: payload.label,
    credentials: payload,
  })

export const deleteAccountProfile = (id: string) =>
  rpcRequest<{ ok: true }>('admin.profiles.delete', { id })

export const updateAccountProfile = (
  id: string,
  payload: { label: string; color: string; tradePassword?: string },
) => rpcRequest<{ profile: AccountProfile }>('admin.profiles.update', { id, ...payload })

export const createMobileSuicaCaptcha = (payload: {
  label: string
  user: string
  password: string
}) =>
  rpcRequest<{ interactionId: string; imageDataUrl: string; suggestedAnswer: string }>(
    'admin.profiles.mobileSuica.login.start',
    payload,
  ).then(({ interactionId, ...interaction }) => ({ id: interactionId, ...interaction }))

export const createMobileSuicaReauthCaptcha = (profileId: string) =>
  rpcRequest<{ interactionId: string; imageDataUrl: string; suggestedAnswer: string }>(
    'admin.profiles.mobileSuica.login.start',
    { profileId },
  ).then(({ interactionId, ...interaction }) => ({ id: interactionId, ...interaction }))

export const submitMobileSuicaCaptcha = (id: string, answer: string) =>
  rpcRequest<{ profile: { id: string } }>('admin.profiles.mobileSuica.login.complete', {
    interactionId: id,
    answer,
  })

export const updateVirtualAccount = (
  accountId: string,
  expectedVersion: number,
  input: { label?: string; policy?: Record<string, unknown> },
) => rpcRequest('admin.accounts.update', { accountId, expectedVersion, ...input })
export const setVirtualAccountState = (
  accountId: string,
  expectedVersion: number,
  action: 'freeze' | 'unfreeze' | 'close',
) => rpcRequest(`admin.accounts.${action}`, { accountId, expectedVersion })
export const getAccountAccess = (accountId: string) =>
  rpcRequest<{
    items: Array<{
      apiKeyId: string
      label: string
      role: 'read' | 'trade'
      revokedAt?: string | null
    }>
  }>('admin.accountAccess.list', { accountId })
export const revokeAccountAccess = (accountId: string, apiKeyId: string) =>
  rpcRequest('admin.accountAccess.revoke', { accountId, apiKeyId })
export const getAccountActivity = (accountId: string) =>
  rpcRequest<{ items: Array<{ id: string; event: string; createdAt: string }> }>(
    'admin.accounts.activity',
    { accountId },
  )
export const bindAccountAccess = (accountId: string, apiKeyId: string, role: 'read' | 'trade') =>
  rpcRequest('admin.apiKeys.bind', { accountId, apiKeyId, role })

export const migrateVirtualAccounts = (physicalAccountId: string) =>
  rpcRequest<{ accountId: string }>('admin.accounts.migrate', { physicalAccountId })

export const transferVirtualAssets = (
  transfers: Array<Parameters<typeof transferVirtualAsset>[0]>,
) => rpcRequest('admin.accounts.assets.transferBatch', { transfers })

export interface AccountReconciliation {
  snapshotError: boolean
  syncErrors?: Array<{
    stage: string
    scope: string
    reason: string
    code?: string
    venues?: string[]
    updatedAt: string
  }>
  externalOrders: Array<{ id: string; state: 'open' | 'needs_review' }>

  assets: Array<{ assetKey: string; allocated: string; actual: string; unallocated: string }>
  orders: Array<{ id: string; accountId: string; status: string; instrumentId?: string }>
  events: Array<{ id: string; createdAt: string; detail: { assetKey?: string; delta?: string } }>
}
export const inspectAccountReconciliation = (physicalAccountId: string) =>
  rpcRequest<AccountReconciliation>('admin.accounts.reconciliation.inspect', {
    physicalAccountId,
  })
export const reconcileOrderReference = (orderId: string, providerOrderId: string) =>
  rpcRequest('admin.accounts.orders.reconcile', { orderId, providerOrderId })
