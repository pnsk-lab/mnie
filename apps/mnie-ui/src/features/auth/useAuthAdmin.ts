import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ref, watch } from 'vue'
import {
  createApiKey,
  checkProfileAvailability,
  checkProfileAvailabilityLive,
  createLoginOptions,
  createSetupOptions,
  deleteAccountProfile,
  getStatus,
  listApiKeys,
  listSbiPasskeys,
  listAccountProfiles,
  listCronJobs,
  saveSbiPasskey,
  saveSmbcDirectProfile,
  savePayPayBankProfile,
  updateApiKeySettings,
  updateAccountProfileLabel,
  verifyLogin,
  verifySetup,
  type ApiKey,
  type AccountProfile,
  type AuthStatus,
  type CronJob,
  type ProfileAvailability,
  type SbiPasskey,
  type SbiPasskeySource,
} from '../../api'
import { defaultApiKeyPolicy } from './api-key-policy'

export const useAuthAdmin = () => {
  const status = ref<AuthStatus>({ configured: true, authenticated: false })
  const apiKeys = ref<ApiKey[]>([])
  const sbiPasskeys = ref<SbiPasskey[]>([])
  const profiles = ref<AccountProfile[]>([])
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
  const sbiPasskeySourceKind = ref<SbiPasskeySource['kind']>('bitwarden')
  const sbiCredentialJson = ref('')
  const sbiBitwardenDataPath = ref('')
  const sbiBitwardenMasterPassword = ref('')
  const sbiBitwardenRpId = ref('')
  const sbiBitwardenOrigin = ref('')
  const sbiBitwardenCredentialId = ref('')
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
      profiles.value = (await listAccountProfiles()).profiles
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

  const optionalText = (value: string) => value.trim() || undefined

  const sbiPasskeySource = (): SbiPasskeySource => {
    if (sbiPasskeySourceKind.value === 'json') {
      return { kind: 'json', credential: JSON.parse(sbiCredentialJson.value) }
    }

    return {
      kind: 'bitwarden',
      dataPath: optionalText(sbiBitwardenDataPath.value),
      masterPassword: sbiBitwardenMasterPassword.value,
      rpId: sbiBitwardenRpId.value.trim(),
      origin: optionalText(sbiBitwardenOrigin.value),
      credentialId: optionalText(sbiBitwardenCredentialId.value),
    }
  }

  const addSbiPasskey = async () => {
    const { passkey } = await saveSbiPasskey({
      label: sbiLabel.value,
      source: sbiPasskeySource(),
      tradePassword: tradePassword.value || undefined,
      deviceId: sbiDeviceId.value || undefined,
    })
    selectedProfileId.value = passkey.id
    sbiCredentialJson.value = ''
    sbiBitwardenDataPath.value = ''
    sbiBitwardenMasterPassword.value = ''
    sbiBitwardenRpId.value = ''
    sbiBitwardenOrigin.value = ''
    sbiBitwardenCredentialId.value = ''
    tradePassword.value = ''
    sbiDeviceId.value = ''
    await refresh()
  }

  const removeSbiPasskey = async (id: string) => {
    await deleteAccountProfile(id)
    if (selectedProfileId.value === id) selectedProfileId.value = ''
    await refresh()
  }

  const updateProfileLabel = async (id: string, label: string) => {
    await updateAccountProfileLabel(id, label)
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
    profiles,
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
    sbiPasskeySourceKind,
    sbiCredentialJson,
    sbiBitwardenDataPath,
    sbiBitwardenMasterPassword,
    sbiBitwardenRpId,
    sbiBitwardenOrigin,
    sbiBitwardenCredentialId,
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
    addSmbcDirectProfile,
    addPayPayBankProfile,
    removeSbiPasskey,
    updateProfileLabel,
  }
}
