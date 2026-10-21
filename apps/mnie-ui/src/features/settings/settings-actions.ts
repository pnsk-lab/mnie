import type { AccountProfile, ApiKey } from '../../api'
export interface SettingsActionArgs {
  addApiKey: []
  refresh: []
  saveApiKeySettings: [key: ApiKey]
  revokeApiKey: [id: string]
  addSbiPasskey: []
  addAuthManager: []
  removeAuthManager: [id: string]
  fillProviderCredentials: [provider?: AccountProfile['provider']]
  addSmbcDirectProfile: []
  addPayPayBankProfile: []
  addPayPaySecProfile: []
  addStarbucksProfile: []
  finishSmbc2fa: []
  forceProfileAvailability: [profileId: string]
  connect: []
  removeSbiPasskey: [id: string]
  updateProfile: [id: string, label: string, color: string, tradePassword?: string]
}
export type SettingsActions = {
  [K in keyof SettingsActionArgs]: (...args: SettingsActionArgs[K]) => unknown | Promise<unknown>
}
