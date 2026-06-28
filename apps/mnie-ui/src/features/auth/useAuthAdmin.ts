import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ref } from 'vue'
import {
  createApiKey,
  createLoginOptions,
  createSetupOptions,
  deleteSbiPasskey,
  getStatus,
  listApiKeys,
  listSbiPasskeys,
  saveSbiPasskey,
  updateApiKeySettings,
  verifyLogin,
  verifySetup,
  type ApiKey,
  type AuthStatus,
  type SbiPasskey,
} from '../../api'
import { defaultApiKeyPolicy } from './api-key-policy'

export const useAuthAdmin = () => {
  const status = ref<AuthStatus>({ configured: true, authenticated: false })
  const apiKeys = ref<ApiKey[]>([])
  const sbiPasskeys = ref<SbiPasskey[]>([])
  const selectedPasskeyId = ref('')
  const setupPassword = ref('')
  const authBusy = ref(false)
  const apiKeyLabel = ref('Fine-grained API key')
  const newApiKeySettings = ref(defaultApiKeyPolicy())
  const newApiToken = ref('')
  const sbiLabel = ref('Main profile')
  const sbiCredentialJson = ref('')
  const tradePassword = ref('')
  const sbiDeviceId = ref('')

  const refresh = async (options?: { autoConnect?: boolean; connect?: () => void }) => {
    status.value = await getStatus()
    if (status.value.authenticated) {
      apiKeys.value = (await listApiKeys()).apiKeys.filter((key) => !key.revokedAt)
      sbiPasskeys.value = (await listSbiPasskeys()).passkeys
      selectedPasskeyId.value ||= sbiPasskeys.value[0]?.id ?? ''
      if (options?.autoConnect && selectedPasskeyId.value) options.connect?.()
    }
  }

  const addApiKey = async () => {
    const { apiKey } = await createApiKey(apiKeyLabel.value, newApiKeySettings.value)
    newApiToken.value = apiKey.token ?? ''
    await refresh()
  }

  const saveApiKeySettings = async (key: ApiKey) => {
    await updateApiKeySettings(key.id, {
      maxTradesPerHour: key.maxTradesPerHour,
      maxTradesPer6Hours: key.maxTradesPer6Hours,
      maxTradesPerDay: key.maxTradesPerDay,
      maxOrderPriceJpy: key.maxOrderPriceJpy,
      maxOrderAmountJpy: key.maxOrderAmountJpy,
      allowedMethods: key.allowedMethods,
    })
    await refresh()
  }

  const setupOwnerPasskey = async () => {
    authBusy.value = true
    try {
      const { options, challengeId } = await createSetupOptions(setupPassword.value)
      const response = await startRegistration({ optionsJSON: options as never })
      await verifySetup(challengeId, response)
      setupPassword.value = ''
      await refresh()
    } finally {
      authBusy.value = false
    }
  }

  const loginWithPasskey = async () => {
    authBusy.value = true
    try {
      const { options, challengeId } = await createLoginOptions()
      const response = await startAuthentication({ optionsJSON: options as never })
      await verifyLogin(challengeId, response)
      await refresh()
    } finally {
      authBusy.value = false
    }
  }

  const addSbiPasskey = async () => {
    const { passkey } = await saveSbiPasskey({
      label: sbiLabel.value,
      credential: JSON.parse(sbiCredentialJson.value),
      tradePassword: tradePassword.value || undefined,
      deviceId: sbiDeviceId.value || undefined,
    })
    selectedPasskeyId.value = passkey.id
    sbiCredentialJson.value = ''
    tradePassword.value = ''
    sbiDeviceId.value = ''
    await refresh()
  }

  const removeSbiPasskey = async (id: string) => {
    await deleteSbiPasskey(id)
    if (selectedPasskeyId.value === id) selectedPasskeyId.value = ''
    await refresh()
  }

  return {
    status,
    apiKeys,
    sbiPasskeys,
    selectedPasskeyId,
    setupPassword,
    authBusy,
    apiKeyLabel,
    newApiKeySettings,
    newApiToken,
    sbiLabel,
    sbiCredentialJson,
    tradePassword,
    sbiDeviceId,
    refresh,
    addApiKey,
    saveApiKeySettings,
    setupOwnerPasskey,
    loginWithPasskey,
    addSbiPasskey,
    removeSbiPasskey,
  }
}
