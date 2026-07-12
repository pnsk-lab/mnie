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
  provider: 'sbisec' | 'smbc-direct' | 'mobilesuica' | 'paypay-bank'
  label: string
  createdAt: string
  updatedAt: string
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

export type ProfileAvailability =
  | { ok: true; checkedAt?: string }
  | {
      ok: false
      message: unknown
      reason: 'CAPTCHA_REQIRED' | '2FA_REQUIRED' | 'UNKNOWN'
      checkedAt?: string
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
  occurredAt: string
  description: string
  amount?: { kind: 'money'; money: { currency: string; value: string } }
  balanceAfter?: { kind: 'money'; money: { currency: string; value: string } }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
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

export const getStatus = () => request<AuthStatus>('/auth/status')

export const createSetupOptions = (password: string) =>
  request<{ options: unknown; challengeId: string }>('/auth/setup/options', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

export const verifySetup = (challengeId: string, response: unknown) =>
  request<{ ok: true }>('/auth/setup/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  })

export const createLoginOptions = () =>
  request<{ options: unknown; challengeId: string }>('/auth/login/options', {
    method: 'POST',
  })

export const verifyLogin = (challengeId: string, response: unknown) =>
  request<{ ok: true }>('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  })

export const createApiKey = (label: string, settings?: ApiKeySettings) =>
  request<{ apiKey: ApiKey }>('/admin/api-keys', {
    method: 'POST',
    body: JSON.stringify({ label, settings }),
  })

export const listApiKeys = () => request<{ apiKeys: ApiKey[] }>('/admin/api-keys')

export const updateApiKeySettings = (id: string, settings: ApiKeySettings) =>
  request<{ ok: true }>(`/admin/api-keys/${id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })

export const revokeApiKey = (id: string) =>
  request<{ ok: true }>(`/admin/api-keys/${id}`, { method: 'DELETE' })

export const listSbiPasskeys = () => request<{ passkeys: SbiPasskey[] }>('/admin/sbi-passkeys')

export const saveSbiPasskey = (payload: {
  label: string
  source: SbiPasskeySource
  tradePassword?: string
  deviceId?: string
}) =>
  request<{ passkey: SbiPasskey }>('/admin/sbi-passkeys', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const deleteSbiPasskey = (id: string) =>
  request<{ ok: true }>(`/admin/sbi-passkeys/${id}`, { method: 'DELETE' })

export const listAccountProfiles = () => request<{ profiles: AccountProfile[] }>('/admin/profiles')

export const listLatestAssetValuations = () =>
  request<{ valuations: AssetValuation[] }>('/admin/asset-valuations/latest')

export const checkAccountProfileAvailability = () =>
  request<{ availability: Record<string, ProfileAvailability> }>('/admin/profiles/availability', {
    method: 'POST',
  })

export const checkProfileAvailability = (profileId: string) =>
  request<{ availability: Record<string, ProfileAvailability> }>('/admin/profiles/availability', {
    method: 'POST',
    body: JSON.stringify({ profileId }),
  })

export const checkProfileAvailabilityLive = (profileId: string) =>
  request<{ availability: Record<string, ProfileAvailability> }>(
    '/admin/profiles/availability/live',
    {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    },
  )

export const listCronJobs = () => request<{ jobs: CronJob[] }>('/admin/cron-jobs')

export const saveSmbcDirectProfile = (payload: {
  label: string
  user: string
  password: string
  accountItemCode?: string
}) =>
  request<{ profile: AccountProfile }>('/admin/profiles/smbc-direct', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const savePayPayBankProfile = (payload: {
  label: string
  branchNo: string
  accountNo: string
  password: string
}) =>
  request<{ profile: AccountProfile }>('/admin/profiles/paypay-bank', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const deleteAccountProfile = (id: string) =>
  request<{ ok: true }>(`/admin/profiles/${id}`, { method: 'DELETE' })

export const updateAccountProfileLabel = (id: string, label: string) =>
  request<{ profile: AccountProfile }>(`/admin/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label }),
  })

export const createMobileSuicaCaptcha = (payload: {
  label: string
  user: string
  password: string
}) =>
  request<{ id: string; imageDataUrl: string }>('/admin/mobilesuica/captcha', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const createMobileSuicaReauthCaptcha = (profileId: string) =>
  request<{ id: string; imageDataUrl: string }>(`/admin/mobilesuica/reauth/${profileId}/captcha`, {
    method: 'POST',
  })

export const submitMobileSuicaCaptcha = (id: string, answer: string) =>
  request<{ profile: { id: string } }>(`/admin/mobilesuica/captcha/${id}`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  })

export const createRpcSocket = () => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${location.host}/api/ws`)
}
