import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ref } from 'vue'
import {
  createApiKey,
  createLoginOptions,
  createSetupOptions,
  deleteAccountProfile,
  getStatus,
  listApiKeys,
  listSbiPasskeys,
  listAccountProfiles,
  saveSbiPasskey,
  saveSmbcDirectProfile,
  updateApiKeySettings,
  verifyLogin,
  verifySetup,
  type ApiKey,
  type AccountProfile,
  type AuthStatus,
  type SbiPasskey,
} from '../../api'
import { defaultApiKeyPolicy } from './api-key-policy'

export const useAuthAdmin = () => {
  const status = ref<AuthStatus>({ configured: true, authenticated: false })
  const apiKeys = ref<ApiKey[]>([])
  const sbiPasskeys = ref<SbiPasskey[]>([])
  const profiles = ref<AccountProfile[]>([])
  const selectedProfileId = ref('')
  const setupPassword = ref('')
  const authBusy = ref(false)
  const apiKeyLabel = ref('Fine-grained API key')
  const newApiKeySettings = ref(defaultApiKeyPolicy())
  const newApiToken = ref('')
  const sbiLabel = ref('Main profile')
  const sbiCredentialJson = ref('')
  const tradePassword = ref('')
  const sbiDeviceId = ref('')
  const smbcLabel = ref('SMBC Direct')
  const smbcUser = ref('')
  const smbcPassword = ref('')
  const smbcAccountItemCode = ref('')

  const refresh = async (options?: { autoConnect?: boolean; connect?: () => void }) => {
    status.value = await getStatus()
    if (status.value.authenticated) {
      apiKeys.value = (await listApiKeys()).apiKeys.filter((key) => !key.revokedAt)
      sbiPasskeys.value = (await listSbiPasskeys()).passkeys
      profiles.value = (await listAccountProfiles()).profiles
      selectedProfileId.value ||= profiles.value[0]?.id ?? ''
      if (options?.autoConnect && selectedProfileId.value) options.connect?.()
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
    selectedProfileId.value = passkey.id
    sbiCredentialJson.value = ''
    tradePassword.value = ''
    sbiDeviceId.value = ''
    await refresh()
  }

  const removeSbiPasskey = async (id: string) => {
    await deleteAccountProfile(id)
    if (selectedProfileId.value === id) selectedProfileId.value = ''
    await refresh()
  }

  const addSmbcDirectProfile = async () => {
    const { profile } = await saveSmbcDirectProfile({
      label: smbcLabel.value,
      user: smbcUser.value,
      password: smbcPassword.value,
      accountItemCode: smbcAccountItemCode.value || undefined,
    })
    selectedProfileId.value = profile.id
    smbcPassword.value = ''
    await refresh()
  }

  return {
    status,
    apiKeys,
    sbiPasskeys,
    profiles,
    selectedProfileId,
    setupPassword,
    authBusy,
    apiKeyLabel,
    newApiKeySettings,
    newApiToken,
    sbiLabel,
    sbiCredentialJson,
    tradePassword,
    sbiDeviceId,
    smbcLabel,
    smbcUser,
    smbcPassword,
    smbcAccountItemCode,
    refresh,
    addApiKey,
    saveApiKeySettings,
    setupOwnerPasskey,
    loginWithPasskey,
    addSbiPasskey,
    addSmbcDirectProfile,
    removeSbiPasskey,
  }
}
