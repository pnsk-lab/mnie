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
  credential: unknown
  tradePassword?: string
  deviceId?: string
}) =>
  request<{ passkey: SbiPasskey }>('/admin/sbi-passkeys', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const deleteSbiPasskey = (id: string) =>
  request<{ ok: true }>(`/admin/sbi-passkeys/${id}`, { method: 'DELETE' })

export const createRpcSocket = () => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${location.host}/api/ws`)
}
