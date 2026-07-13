import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ref, watch } from 'vue'
import {
  createApiKey,
  checkProfileAvailability,
  checkProfileAvailabilityLive,
  createLoginOptions,
  createSetupOptions,
  deleteAccountProfile,
  deleteAuthManager,
  fillFromAuthManager,
  getStatus,
  listApiKeys,
  listAuthManagers,
  listSbiPasskeys,
  listAccountProfiles,
  listCronJobs,
  listProviderDefinitions,
  saveSbiPasskey,
  saveBitwardenAuthManager,
  saveSmbcDirectProfile,
  savePayPayBankProfile,
  updateApiKeySettings,
  updateAccountProfile,
  verifyLogin,
  verifySetup,
  type ApiKey,
  type AccountProfile,
  type AuthManagerConfig,
  type AuthStatus,
  type CronJob,
  type ProfileAvailability,
  type ProviderDefinition,
  type SbiPasskey,
} from '../../api'
import { defaultApiKeyPolicy } from './api-key-policy'

export const useAuthAdmin = () => {
  const status = ref<AuthStatus>({ configured: true, authenticated: false })
  const apiKeys = ref<ApiKey[]>([])
  const sbiPasskeys = ref<SbiPasskey[]>([])
  const authManagers = ref<AuthManagerConfig[]>([])
  const profiles = ref<AccountProfile[]>([])
  const providerDefinitions = ref<ProviderDefinition[]>([])
  const profileAvailability = ref<Record<string, ProfileAvailability>>({})
  const profileAvailabilityCheckedAt = ref<Record<string, number>>({})
  const profileAvailabilityLoading = ref<Record<string, boolean>>({})
  const availabilityRefreshMs = 10 * 60 * 1000
  const cronJobs = ref<CronJob[]>([])
  const selectedProfileId = ref('')
  const setupPassword = ref('')
  const authBusy = ref(false)
  const apiKeyLabel = ref('Fine-grained API key')
  const newApiKeySettings = ref(defaultApiKeyPolicy())
  const newApiToken = ref('')
  const sbiLabel = ref('Main profile')
  const authManagerLabel = ref('Bitwarden')
  const authManagerDataPath = ref('')
  const authManagerMasterPassword = ref('')
  const selectedAuthManagerId = ref('')
  const sbiCredentialJson = ref('')
  const tradePassword = ref('')
  const sbiDeviceId = ref('')
  const smbcLabel = ref('SMBC Direct')
  const smbcUser = ref('')
  const smbcPassword = ref('')
  const smbcAccountItemCode = ref('')
  const payPayBankLabel = ref('PayPay銀行')
  const payPayBankBranchNo = ref('')
  const payPayBankAccountNo = ref('')
  const payPayBankPassword = ref('')

  watch(payPayBankBranchNo, (value) => {
    const match = /^(\d{3})-(\d{1,7})$/.exec(value)
    if (!match) return

    payPayBankBranchNo.value = match[1]!
    payPayBankAccountNo.value = match[2]!
  })

  const refresh = async (options?: { autoConnect?: boolean; connect?: () => void }) => {
    status.value = await getStatus()
    if (status.value.authenticated) {
      apiKeys.value = (await listApiKeys()).apiKeys.filter((key) => !key.revokedAt)
      sbiPasskeys.value = (await listSbiPasskeys()).passkeys
      authManagers.value = (await listAuthManagers()).authManagers
      selectedAuthManagerId.value ||= authManagers.value[0]?.id ?? ''
      profiles.value = (await listAccountProfiles()).profiles
      providerDefinitions.value = (await listProviderDefinitions()).providers
      for (const profile of profiles.value) {
        if (
          Date.now() - (profileAvailabilityCheckedAt.value[profile.id] ?? 0) <
          availabilityRefreshMs
        )
          continue
        profileAvailabilityLoading.value[profile.id] = true
        try {
          const result = await checkProfileAvailability(profile.id)
          const value = result.availability[profile.id]
          if (value) {
            profileAvailability.value[profile.id] = value
            profileAvailabilityCheckedAt.value[profile.id] = value.checkedAt
              ? Date.parse(value.checkedAt)
              : Date.now()
          }
        } catch (cause) {
          profileAvailability.value[profile.id] = {
            ok: false,
            message: cause instanceof Error ? cause.message : String(cause),
            reason: 'UNKNOWN',
          }
          profileAvailabilityCheckedAt.value[profile.id] = Date.now()
        } finally {
          profileAvailabilityLoading.value[profile.id] = false
        }
      }
      cronJobs.value = (await listCronJobs()).jobs
      selectedProfileId.value ||= profiles.value[0]?.id ?? ''
      if (options?.autoConnect && selectedProfileId.value) options.connect?.()
    }
  }

  const forceProfileAvailability = async (profileId: string) => {
    profileAvailabilityLoading.value[profileId] = true
    try {
      const result = await checkProfileAvailabilityLive(profileId)
      const availability = result.availability[profileId]
      if (!availability) throw new Error('Profile availability result was not returned')
      profileAvailability.value[profileId] = availability
      profileAvailabilityCheckedAt.value[profileId] = Date.now()
    } finally {
      profileAvailabilityLoading.value[profileId] = false
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
    if (!sbiCredentialJson.value.trim()) throw new Error('パスキー JSON を入力してください')
    let credential: unknown
    try {
      credential = JSON.parse(sbiCredentialJson.value)
    } catch {
      throw new Error('パスキー JSON の形式が不正です')
    }
    const { passkey } = await saveSbiPasskey({
      label: sbiLabel.value,
      source: {
        kind: 'json',
        credential,
      },
      tradePassword: tradePassword.value || undefined,
      deviceId: sbiDeviceId.value || undefined,
    })
    selectedProfileId.value = passkey.id
    sbiCredentialJson.value = ''
    tradePassword.value = ''
    sbiDeviceId.value = ''
    await refresh()
  }

  const addAuthManager = async () => {
    const { authManager } = await saveBitwardenAuthManager({
      label: authManagerLabel.value,
      dataPath: authManagerDataPath.value.trim() || undefined,
    })
    selectedAuthManagerId.value = authManager.id
    await refresh()
  }

  const removeAuthManager = async (id: string) => {
    await deleteAuthManager(id)
    if (selectedAuthManagerId.value === id) selectedAuthManagerId.value = ''
    await refresh()
  }

  const fillProviderCredentials = async () => {
    if (!selectedAuthManagerId.value) throw new Error('Auth Manager が設定されていません')
    if (!authManagerMasterPassword.value) throw new Error('Master Password を入力してください')
    const credentials = await fillFromAuthManager(
      selectedAuthManagerId.value,
      'sbisec',
      authManagerMasterPassword.value,
    )
      .then((result) => result.credentials)
      .finally(() => {
        authManagerMasterPassword.value = ''
      })
    if (credentials.length !== 1) {
      throw new Error(`認証情報を1件に特定できませんでした（${credentials.length}件）`)
    }
    const credential = credentials[0]!
    if (credential.passkeys.length !== 1) {
      throw new Error(`パスキーを1件に特定できませんでした（${credential.passkeys.length}件）`)
    }
    const portableCredential = credential.passkeys[0]!.portableCredential
    if (!portableCredential) throw new Error('パスキーをエクスポートできませんでした')
    sbiCredentialJson.value = JSON.stringify(portableCredential, null, 2)
  }

  const removeSbiPasskey = async (id: string) => {
    await deleteAccountProfile(id)
    if (selectedProfileId.value === id) selectedProfileId.value = ''
    await refresh()
  }

  const updateProfile = async (id: string, label: string, color: string) => {
    await updateAccountProfile(id, { label, color })
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

  const addPayPayBankProfile = async () => {
    const { profile } = await savePayPayBankProfile({
      label: payPayBankLabel.value,
      branchNo: payPayBankBranchNo.value,
      accountNo: payPayBankAccountNo.value,
      password: payPayBankPassword.value,
    })
    selectedProfileId.value = profile.id
    payPayBankPassword.value = ''
    await refresh()
  }

  return {
    status,
    apiKeys,
    sbiPasskeys,
    authManagers,
    profiles,
    providerDefinitions,
    profileAvailability,
    profileAvailabilityCheckedAt,
    profileAvailabilityLoading,
    cronJobs,
    selectedProfileId,
    setupPassword,
    authBusy,
    apiKeyLabel,
    newApiKeySettings,
    newApiToken,
    sbiLabel,
    authManagerLabel,
    authManagerDataPath,
    authManagerMasterPassword,
    selectedAuthManagerId,
    sbiCredentialJson,
    tradePassword,
    sbiDeviceId,
    smbcLabel,
    smbcUser,
    smbcPassword,
    smbcAccountItemCode,
    payPayBankLabel,
    payPayBankBranchNo,
    payPayBankAccountNo,
    payPayBankPassword,
    refresh,
    forceProfileAvailability,
    addApiKey,
    saveApiKeySettings,
    setupOwnerPasskey,
    loginWithPasskey,
    addSbiPasskey,
    addAuthManager,
    removeAuthManager,
    fillProviderCredentials,
    addSmbcDirectProfile,
    addPayPayBankProfile,
    removeSbiPasskey,
    updateProfile,
  }
}
