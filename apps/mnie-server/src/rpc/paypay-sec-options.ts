import type { ServerConfig } from '../config'
import type { StoredPayPaySecSecret } from '../providers/credentials'

export const payPaySecConnectionOptions = (
  config: ServerConfig,
  profileId: string,
  secret: StoredPayPaySecSecret,
) => {
  if (!config.payPaySecBaseUrl || !config.payPaySecPasskeyBffBaseUrl) {
    throw new Error('PAYPAY_SEC_BASE_URL and PAYPAY_SEC_PASSKEY_BFF_BASE_URL are required')
  }
  return {
    login: {
      baseURL: config.payPaySecBaseUrl,
      passkeyBffBaseURL: config.payPaySecPasskeyBffBaseUrl,
      passkeyCredential: secret.credential,
    },
    client: { accountId: profileId, deviceId: secret.deviceId },
  }
}
