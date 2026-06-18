import { ref } from 'vue'
import type { ApiKeySettings } from '../../api'
import { defaultApiKeyPolicy } from '../auth/api-key-policy'

export type OAuthApprovalState = {
  active: boolean
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  scope: string
  state: string
  resource: string
}

export const useOAuthApproval = () => {
  const oauthApproval = ref<OAuthApprovalState>({
    active: false,
    clientId: '',
    clientName: 'MCP client',
    redirectUri: '',
    codeChallenge: '',
    scope: '',
    state: '',
    resource: '',
  })
  const oauthSettings = ref<ApiKeySettings>(defaultApiKeyPolicy())

  const loadOAuthApproval = async () => {
    const url = new URL(location.href)
    if (url.pathname !== '/oauth/authorize') return
    oauthApproval.value = {
      active: true,
      clientId: url.searchParams.get('client_id') ?? '',
      clientName: url.searchParams.get('client_id') ?? 'MCP client',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
      codeChallenge: url.searchParams.get('code_challenge') ?? '',
      scope: url.searchParams.get('scope') ?? '',
      state: url.searchParams.get('state') ?? '',
      resource: url.searchParams.get('resource') ?? '',
    }
    if (!oauthApproval.value.clientId) return

    const response = await fetch(`/api/oauth/client/${oauthApproval.value.clientId}`, {
      credentials: 'include',
    })
    if (!response.ok) return
    const { client } = (await response.json()) as { client?: { client_name?: string } }
    oauthApproval.value.clientName = client?.client_name ?? oauthApproval.value.clientName
  }

  const approveOAuth = async () => {
    const response = await fetch('/api/oauth/approve', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: oauthApproval.value.clientId,
        redirectUri: oauthApproval.value.redirectUri,
        codeChallenge: oauthApproval.value.codeChallenge,
        scope: oauthApproval.value.scope,
        state: oauthApproval.value.state,
        resource: oauthApproval.value.resource || undefined,
        settings: oauthSettings.value,
      }),
    })
    if (!response.ok) throw new Error(await response.text())
    const { redirectTo } = (await response.json()) as { redirectTo: string }
    location.href = redirectTo
  }

  return {
    oauthApproval,
    oauthSettings,
    loadOAuthApproval,
    approveOAuth,
  }
}
