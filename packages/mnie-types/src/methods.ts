import type {
  AvailabilityFailureReason,
  Capability,
  FinancialProvider,
  HistoryListRequest,
  HistoryListResult,
  InvestmentOrder,
  InvestmentPosition,
  MethodDefinition,
  MethodMap,
  MethodName,
  MethodRequest,
  MethodResponse,
  Page,
  PortfolioOverview,
  PortfolioValuation,
  ProviderAvailability,
  ProviderCategory,
  ProviderMethods,
  PublicFinancialAccount,
  VirtualAccountAsset,
} from './financial'
import type { LedgerMethods } from './reconciliation'
import type { FinancialAccount } from './observations'

/**
 * Wire method selectors. `account` is always a virtual financial account id on
 * the wire; the server resolves it to the backing physical account before a
 * provider sees the request. `profile` is an account profile id and selects the
 * provider session directly.
 */
export type AccountScoped<Request> = Omit<Request, 'account'> & { account: string }
export type ProfileScoped<Request> = Request & { profile: string }

// ---------------------------------------------------------------------------
// Shared API payloads (previously defined ad hoc in apps/mnie-ui/src/api.ts)
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string
  label: string
  accountBindings?: Array<{ accountId: string; role: 'read' | 'trade' }>
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
  | 'accountBindings'
  | 'maxTradesPerHour'
  | 'maxTradesPer6Hours'
  | 'maxTradesPerDay'
  | 'maxOrderPriceJpy'
  | 'maxOrderAmountJpy'
  | 'allowedMethods'
  | 'scopes'
>

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

export interface AccountProfile {
  id: string
  provider: string
  providerName: string
  category: ProviderCategory
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

export interface ManagedVirtualAccount extends PublicFinancialAccount {
  physicalAccountId: string
  profileId: string
  providerAccountId: string
  connectorTypeId: string
  physicalAccountKind: string
  policy: Record<string, unknown>
}

/** One flat entry of `admin.accounts.list`: physical accounts and virtual accounts share a list. */
export type AdminAccount =
  | ({ layer: 'physical' } & FinancialAccount)
  | ({ layer: 'virtual' } & ManagedVirtualAccount)

export interface CronJob {
  id: string
  label: string
  schedule: string
  running: boolean
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
}

export type ProfileAvailability =
  | { ok: true; checkedAt?: string; methods?: Record<string, unknown> }
  | {
      ok: false
      message: unknown
      reason: AvailabilityFailureReason
      checkedAt?: string
      methods?: Record<string, unknown>
    }

export interface ProfileConnection {
  status: 'connected' | 'interaction-required'
  providerId: string
  profileId: string
  interaction?: {
    id: string
    kind: 'qr' | 'captcha'
    url?: string
    qrUrl?: string
    imageDataUrl?: string
  }
}

export interface ProfileSyncResult {
  profileId: string
  results: Array<{ physicalAccountId: string; locked: boolean }>
}

export interface HistorySyncResult {
  profileId: string
  from: string
  to: string
  synced: number
  errors: Array<{ profileId: string; providerId: string; message: string }>
}

export interface AccountAccessEntry {
  apiKeyId: string
  label: string
  role: 'read' | 'trade'
  lastUsedAt?: string | null
  revokedAt?: string | null
}

export interface VirtualAssetTransferInput {
  fromAccountId: string
  toAccountId: string
  assetKey: string
  amount: string
  expectedFromVersion: number
  expectedToVersion: number
  reason: string
}

// ---------------------------------------------------------------------------
// rpc.*
// ---------------------------------------------------------------------------

export type RpcMethods = {
  'rpc.methods': MethodDefinition<Record<string, never>, string[]>
}

// ---------------------------------------------------------------------------
// admin.* — owner-only management surface used by mnie ui
// ---------------------------------------------------------------------------

export type AdminMethods = {
  'admin.providers.list': MethodDefinition<
    Record<string, never>,
    { providers: ProviderDefinition[] }
  >

  'admin.apiKeys.list': MethodDefinition<Record<string, never>, { apiKeys: ApiKey[] }>
  'admin.apiKeys.create': MethodDefinition<
    { label: string; settings?: ApiKeySettings },
    { apiKey: ApiKey }
  >
  'admin.apiKeys.update': MethodDefinition<{ id: string; settings: ApiKeySettings }, { ok: true }>
  'admin.apiKeys.revoke': MethodDefinition<{ id: string }, { ok: true }>
  'admin.apiKeys.bind': MethodDefinition<
    { apiKeyId: string; accountId: string; role: 'read' | 'trade' },
    { ok: true }
  >

  'admin.authManagers.list': MethodDefinition<
    Record<string, never>,
    { authManagers: AuthManagerConfig[] }
  >
  'admin.authManagers.create': MethodDefinition<
    { kind: 'bitwarden'; label: string; dataPath?: string },
    { authManager: AuthManagerConfig }
  >
  'admin.authManagers.delete': MethodDefinition<{ id: string }, { ok: true }>
  'admin.authManagers.credentials.list': MethodDefinition<
    { id: string; providerId: string; masterPassword: string },
    { credentials: FilledAuthCredential[] }
  >

  'admin.profiles.list': MethodDefinition<Record<string, never>, { profiles: AccountProfile[] }>
  'admin.profiles.create': MethodDefinition<
    { providerId: string; label: string; credentials?: Record<string, unknown> },
    { profile: AccountProfile }
  >
  'admin.profiles.update': MethodDefinition<
    { id: string; label: string; color: string; tradePassword?: string },
    { profile: AccountProfile }
  >
  'admin.profiles.delete': MethodDefinition<{ id: string }, { ok: true }>
  'admin.profiles.availability.cached': MethodDefinition<
    { profileId?: string },
    { availability: Record<string, ProfileAvailability> }
  >
  'admin.profiles.availability.refresh': MethodDefinition<
    { profileId?: string },
    { availability: Record<string, ProfileAvailability> }
  >
  'admin.profiles.connect': MethodDefinition<{ profileId: string }, ProfileConnection>
  'admin.profiles.connection.complete': MethodDefinition<
    { profileId: string; interactionId: string },
    ProfileConnection
  >
  'admin.profiles.sync': MethodDefinition<{ profileId: string }, ProfileSyncResult>
  'admin.profiles.mobileSuica.login.start': MethodDefinition<
    { label: string; user: string; password: string },
    { interactionId: string; imageDataUrl: string; suggestedAnswer: string }
  >
  'admin.profiles.mobileSuica.login.complete': MethodDefinition<
    { interactionId: string; answer: string },
    { profile: AccountProfile }
  >

  /** Flat physical + virtual account view; supersedes `financial-accounts.list`. */
  'admin.accounts.list': MethodDefinition<Record<string, never>, { accounts: AdminAccount[] }>
  'admin.accounts.discover': MethodDefinition<Record<string, never>, { discovered: number }>
  'admin.accounts.create': MethodDefinition<
    {
      physicalAccountId: string
      label: string
      allocations?: Array<{
        fromAccountId: string
        assetKey: string
        amount: string
        expectedFromVersion: number
        reason: string
      }>
      color?: string
      icon?: string
      policy?: Record<string, unknown>
    },
    { account: PublicFinancialAccount }
  >
  'admin.accounts.update': MethodDefinition<
    {
      accountId: string
      expectedVersion: number
      label?: string
      policy?: Record<string, unknown>
    },
    { ok: true }
  >
  'admin.accounts.freeze': MethodDefinition<
    { accountId: string; expectedVersion: number },
    { ok: true }
  >
  'admin.accounts.unfreeze': MethodDefinition<
    { accountId: string; expectedVersion: number },
    { ok: true }
  >
  'admin.accounts.close': MethodDefinition<
    { accountId: string; expectedVersion: number },
    { ok: true }
  >
  'admin.accounts.activity': MethodDefinition<{ accountId: string }, unknown>
  'admin.accounts.initialize': MethodDefinition<
    { physicalAccountId: string },
    { unallocated: PublicFinancialAccount }
  >
  'admin.accounts.initializations.list': MethodDefinition<
    Record<string, never>,
    { physicalAccountIds: string[] }
  >
  'admin.accounts.defaults.ensure': MethodDefinition<
    Record<string, never>,
    { created: number; synced: number; errors: Array<{ profileId: string; message: string }> }
  >
  'admin.accounts.migrate': MethodDefinition<{ physicalAccountId: string }, unknown>
  'admin.accounts.assets.transfer': MethodDefinition<VirtualAssetTransferInput, { id: string }>
  'admin.accounts.assets.transferBatch': MethodDefinition<
    { transfers: VirtualAssetTransferInput[] },
    { transfers: Array<{ id: string }> }
  >
  'admin.accounts.reconciliation.approve': MethodDefinition<
    { physicalAccountId: string },
    { ok: true }
  >
  'admin.accounts.reconciliation.inspect': MethodDefinition<{ physicalAccountId: string }, unknown>
  'admin.accounts.orders.reconcile': MethodDefinition<
    { orderId: string; providerOrderId: string },
    unknown
  >

  'admin.accountAccess.list': MethodDefinition<
    { accountId: string },
    { items: AccountAccessEntry[] }
  >
  'admin.accountAccess.revoke': MethodDefinition<
    { apiKeyId: string; accountId: string },
    { ok: true }
  >

  'admin.history.sync': MethodDefinition<
    { profileId: string; from: string; to: string },
    HistorySyncResult
  >
  'admin.history.sync.since-last': MethodDefinition<{ profileId: string }, HistorySyncResult>
  'admin.assets.valuations.latest': MethodDefinition<
    Record<string, never>,
    { valuations: unknown[] }
  >
  'admin.jobs.list': MethodDefinition<Record<string, never>, { jobs: CronJob[] }>
}

// ---------------------------------------------------------------------------
// portfolio.* — the server's aggregated read model over all visible accounts
// ---------------------------------------------------------------------------

export type PortfolioMethods = {
  /** Virtual accounts visible to the caller: every account for the owner, bound accounts for an API key. */
  'portfolio.accounts.list': MethodDefinition<
    Record<string, never>,
    { accounts: PublicFinancialAccount[] }
  >
  'portfolio.accounts.get': MethodDefinition<
    { account: string },
    { account: PublicFinancialAccount }
  >
  'portfolio.accounts.balances': MethodDefinition<
    { account: string },
    { assets: VirtualAccountAsset[] }
  >
  'portfolio.accounts.positions': MethodDefinition<{ account: string }, Page<InvestmentPosition>>
  'portfolio.accounts.orders': MethodDefinition<{ account: string }, Page<InvestmentOrder>>
  'portfolio.accounts.history': MethodDefinition<
    AccountScoped<HistoryListRequest>,
    HistoryListResult
  >
  'portfolio.overview.get': MethodDefinition<
    { account?: string; accounts?: string[] },
    PortfolioOverview
  >
  'portfolio.valuation.get': MethodDefinition<
    { baseCurrency: string; profiles?: string[]; accounts?: string[] },
    PortfolioValuation
  >
  'portfolio.history.list': MethodDefinition<
    Omit<HistoryListRequest, 'account'> & { profiles?: string[]; accounts?: string[] },
    HistoryListResult
  >
} & {
  [Name in keyof LedgerMethods as `portfolio.${Name}`]: LedgerMethods[Name]
}

// ---------------------------------------------------------------------------
// account.* — virtual-account scope; every request carries `account`
// ---------------------------------------------------------------------------

export type AccountMetaMethods = {
  'account.operations': MethodDefinition<{ account: string }, string[]>
  'account.capabilities': MethodDefinition<{ account: string }, Capability[]>
  'account.availability': MethodDefinition<
    { account: string; method?: string; params?: Record<string, unknown> },
    ProviderAvailability
  >
}

/**
 * Every provider method is also reachable under `account.*`. The server serves
 * shadowed reads (balances, positions, orders, history, transactions) from the
 * virtual-account read model, runs order writes through the order coordinator,
 * and proxies everything else to the provider with `account` translated to the
 * provider's native account id.
 */
export type AccountMethods = AccountMetaMethods & {
  [Name in keyof ProviderMethods as `account.${Name}`]: MethodDefinition<
    AccountScoped<MethodRequest<ProviderMethods, Name>>,
    MethodResponse<ProviderMethods, Name>
  >
}

// ---------------------------------------------------------------------------
// profile.* — provider-session scope; every request carries `profile`
// ---------------------------------------------------------------------------

export type ProfileMetaMethods = {
  'profile.operations': MethodDefinition<{ profile: string }, string[]>
  'profile.capabilities': MethodDefinition<{ profile: string }, Capability[]>
  'profile.availability': MethodDefinition<
    { profile: string; method?: string; params?: Record<string, unknown> },
    ProviderAvailability
  >
}

/** Provider methods that mutate financial state and must go through `account.*` instead. */
export type ProviderWriteMethods =
  | 'investments.orders.create'
  | 'investments.orders.replace'
  | 'investments.orders.cancel'

export type ProfileProviderReadMethods = Exclude<keyof ProviderMethods, ProviderWriteMethods>

/**
 * Every read provider method is reachable under `profile.*` as a raw passthrough:
 * no virtual-account layer runs in between. `account` inside the request is a
 * provider-native account id (not a virtual account).
 */
export type ProfileMethods = ProfileMetaMethods & {
  [Name in ProfileProviderReadMethods as `profile.${Name}`]: MethodDefinition<
    ProfileScoped<MethodRequest<ProviderMethods, Name>>,
    MethodResponse<ProviderMethods, Name>
  >
}

// ---------------------------------------------------------------------------
// The full wire surface
// ---------------------------------------------------------------------------

export type MnieMethods = RpcMethods &
  AdminMethods &
  PortfolioMethods &
  AccountMethods &
  ProfileMethods

/** A Mnie client exposing the flat wire method surface. */
export interface MnieClient {
  /** Wire method names callable with the caller's permissions. */
  methods(): Promise<readonly string[]>
  call<Name extends MethodName<MnieMethods>>(
    method: Name,
    params: MethodRequest<MnieMethods, Name>,
  ): Promise<MethodResponse<MnieMethods, Name>>
  /** Escape hatch for provider-native methods absent from the typed map. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  /** Virtual accounts visible to the caller (`portfolio.accounts.list`). */
  accounts(): Promise<PublicFinancialAccount[]>
  /** Provider-shaped proxy whose invoke() calls `account.<method>`. */
  account(accountId: string): FinancialProvider<MethodMap>
  /** Provider-shaped proxy whose invoke() calls `profile.<method>`. */
  profile(profileId: string): FinancialProvider<MethodMap>
  /** Starts or resumes provider authentication (owner only). */
  connectProfile(profileId: string): Promise<ProfileConnection>
  /** Completes an interactive provider authentication challenge (owner only). */
  completeProfileConnection(profileId: string, interactionId: string): Promise<ProfileConnection>
  /** Snapshots and reconciles every physical account behind a profile (owner only). */
  syncProfile(profileId: string): Promise<ProfileSyncResult>
  close(): void | Promise<void>
}
