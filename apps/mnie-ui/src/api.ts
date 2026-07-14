export interface AuthStatus {
  configured: boolean
  authenticated: boolean
}

export interface ApiKey {
  id: string
  label: string
  maxTradesPerHour?: number | null
  maxTradesPer6Hours?: number | null
  maxTradesPerDay?: number | null
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
  | 'maxTradesPerHour'
  | 'maxTradesPer6Hours'
  | 'maxTradesPerDay'
  | 'maxOrderPriceJpy'
  | 'maxOrderAmountJpy'
  | 'allowedMethods'
  | 'scopes'
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
  bindings: Array<{ id: string; evidence: Array<{ kind: string }> }>
}

export interface FinancialAccount {
  id: string
  connectorTypeId: string
  providerAccountId: string
  kind: string
}

export type ProfileAvailability =
  | { ok: true; checkedAt?: string; operations?: Record<string, unknown> }
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
      operations?: Record<string, unknown>
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

interface RpcResponse {
  id?: number | null
  result?: unknown
  error?: { message?: string }
}

let adminSocket: WebSocket | undefined
let adminSocketReady: Promise<WebSocket> | undefined
let adminRpcId = 0
const adminPending = new Map<
  number,
  { resolve(value: unknown): void; reject(reason?: unknown): void }
>()

const connectAdminSocket = () => {
  if (adminSocket?.readyState === WebSocket.OPEN) return Promise.resolve(adminSocket)
  if (adminSocketReady) return adminSocketReady
  adminSocketReady = new Promise<WebSocket>((resolve, reject) => {
    const socket = createRpcSocket()
    socket.addEventListener('open', () => {
      adminSocket = socket
      adminSocketReady = undefined
      resolve(socket)
    })
    socket.addEventListener('message', (event) => {
      let response: RpcResponse
      try {
        response = JSON.parse(String(event.data)) as RpcResponse
      } catch {
        return
      }
      if (typeof response.id !== 'number') return
      const pending = adminPending.get(response.id)
      if (!pending) return
      adminPending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error.message || 'RPC request failed'))
      else pending.resolve(response.result)
    })
    socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')))
    socket.addEventListener('close', () => {
      if (adminSocket === socket) adminSocket = undefined
      adminSocketReady = undefined
      for (const pending of adminPending.values()) pending.reject(new Error('WebSocket closed'))
      adminPending.clear()
    })
  })
  return adminSocketReady
}

const rpcRequest = async <T>(method: string, params?: unknown): Promise<T> => {
  const socket = await connectAdminSocket()
  const id = ++adminRpcId
  const response = new Promise<T>((resolve, reject) => {
    adminPending.set(id, { resolve: (value) => resolve(value as T), reject })
  })
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  return response
}

const adminRequest = <T>(operation: string, input: Record<string, unknown> = {}) =>
  rpcRequest<T>('admin.invoke', { operation, input })

const workspaceRequest = <T>(operation: string, input: Record<string, unknown> = {}) =>
  rpcRequest<T>('workspace.invoke', { operation, input })

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
  adminRequest<{ apiKey: ApiKey }>('apiKeys.create', { label, settings })

export const listApiKeys = () => adminRequest<{ apiKeys: ApiKey[] }>('apiKeys.list')

export const updateApiKeySettings = (id: string, settings: ApiKeySettings) =>
  adminRequest<{ ok: true }>('apiKeys.update', { id, settings })

export const revokeApiKey = (id: string) => adminRequest<{ ok: true }>('apiKeys.revoke', { id })

export const listSbiPasskeys = async () => {
  const { profiles } = await listAccountProfiles()
  return {
    passkeys: profiles
      .filter((profile) => profile.provider === 'sbisec')
      .map(({ id, label, createdAt, updatedAt }) => ({ id, label, createdAt, updatedAt })),
  }
}

export const listAuthManagers = () =>
  adminRequest<{ authManagers: AuthManagerConfig[] }>('authManagers.list')

export const saveBitwardenAuthManager = (payload: { label: string; dataPath?: string }) =>
  adminRequest<{ authManager: AuthManagerConfig }>('authManagers.create', {
    kind: 'bitwarden',
    ...payload,
  })

export const deleteAuthManager = (id: string) =>
  adminRequest<{ ok: true }>('authManagers.delete', { id })

export const fillFromAuthManager = (id: string, provider: string, masterPassword: string) =>
  adminRequest<{ credentials: FilledAuthCredential[] }>('authManagers.credentials.list', {
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
  adminRequest<{ profile: AccountProfile }>('profiles.create', {
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
  adminRequest<{ ok: true }>('profiles.delete', { id })

export const listAccountProfiles = () =>
  adminRequest<{ profiles: AccountProfile[] }>('profiles.list')

export const listProviderDefinitions = () =>
  adminRequest<{ providers: ProviderDefinition[] }>('providers.list')

export const listLatestAssetValuations = () =>
  adminRequest<{ valuations: AssetValuation[] }>('assets.valuations.latest')

export const getPortfolioOverview = () =>
  workspaceRequest<PortfolioOverview>('portfolio.overview.get')

export const listHistory = (
  input: {
    profileIds?: string[]
    from?: string
    to?: string
    kinds?: Array<'transaction' | 'valuation' | 'snapshot'>
    limit?: number
  } = {},
) => workspaceRequest<{ items: HistoryItem[]; errors: HistoryListError[] }>('history.list', input)

export const listReconciliationProposals = () =>
  workspaceRequest<{ items: ReconciliationProposal[] }>('reconciliation.proposals.list')

export const listFinancialAccounts = () =>
  workspaceRequest<FinancialAccount[]>('financial-accounts.list')

export const listAccountLinks = () => workspaceRequest<unknown[]>('account-links.list')

export const saveAccountLink = (input: Record<string, unknown>) =>
  workspaceRequest('account-links.upsert', input)

export const confirmReconciliationProposal = (proposalId: string) =>
  workspaceRequest('reconciliation.confirm', { proposalId })

export const rejectReconciliationProposal = (proposalId: string, reason?: string) =>
  workspaceRequest('reconciliation.reject', { proposalId, ...(reason ? { reason } : {}) })

export const checkAccountProfileAvailability = () =>
  adminRequest<{ availability: Record<string, ProfileAvailability> }>(
    'profiles.availability.cached',
  )

export const checkProfileAvailability = (profileId: string) =>
  adminRequest<{ availability: Record<string, ProfileAvailability> }>(
    'profiles.availability.cached',
    { profileId },
  )

export const checkProfileAvailabilityLive = (profileId: string) =>
  adminRequest<{ availability: Record<string, ProfileAvailability> }>(
    'profiles.availability.refresh',
    { profileId },
  )

export const listCronJobs = () => adminRequest<{ jobs: CronJob[] }>('jobs.list')

export const saveSmbcDirectProfile = (payload: {
  label: string
  user: string
  password: string
  accountItemCode?: string
}) =>
  adminRequest<{ profile: AccountProfile }>('profiles.create', {
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
  adminRequest<{ profile: AccountProfile }>('profiles.create', {
    providerId: 'paypay-bank',
    label: payload.label,
    credentials: payload,
  })

export const savePayPaySecProfile = (payload: {
  label: string
  credential: unknown
  tradePassword: string
}) =>
  adminRequest<{ profile: AccountProfile }>('profiles.create', {
    providerId: 'paypay-sec',
    label: payload.label,
    credentials: payload,
  })

export const deleteAccountProfile = (id: string) =>
  adminRequest<{ ok: true }>('profiles.delete', { id })

export const updateAccountProfile = (
  id: string,
  payload: { label: string; color: string; tradePassword?: string },
) => adminRequest<{ profile: AccountProfile }>('profiles.update', { id, ...payload })

export const createMobileSuicaCaptcha = (payload: {
  label: string
  user: string
  password: string
}) =>
  adminRequest<{ interactionId: string; imageDataUrl: string; suggestedAnswer: string }>(
    'profiles.mobileSuica.login.start',
    payload,
  ).then(({ interactionId, ...interaction }) => ({ id: interactionId, ...interaction }))

export const createMobileSuicaReauthCaptcha = (profileId: string) =>
  adminRequest<{ interactionId: string; imageDataUrl: string; suggestedAnswer: string }>(
    'profiles.mobileSuica.login.start',
    { profileId },
  ).then(({ interactionId, ...interaction }) => ({ id: interactionId, ...interaction }))

export const submitMobileSuicaCaptcha = (id: string, answer: string) =>
  adminRequest<{ profile: { id: string } }>('profiles.mobileSuica.login.complete', {
    interactionId: id,
    answer,
  })

export const createRpcSocket = () => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${location.host}/api/ws`)
}
