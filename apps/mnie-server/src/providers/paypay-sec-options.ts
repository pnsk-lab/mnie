import type { PlaintextStoredWebAuthnCredential } from '@mnie/provider-paypay-sec'
import type { ServerConfig } from '../config'
import type { StoredPayPaySecSecret } from './credentials'

export const normalizePayPaySecCredential = (
  value: unknown,
  configuredOrigin?: string,
): PlaintextStoredWebAuthnCredential => {
  if (!value || typeof value !== 'object') {
    throw new Error('credential is not a portable WebAuthn credential')
  }
  const credential = value as Partial<PlaintextStoredWebAuthnCredential>
  if (
    credential.kind !== 'webauthn-credential' ||
    !credential.rpId ||
    !credential.origin ||
    !credential.credentialId ||
    !credential.secretPlaintext?.privateKey?.jwk
  ) {
    throw new Error('credential is not a portable WebAuthn credential')
  }
  if (configuredOrigin && new URL(credential.origin).origin !== new URL(configuredOrigin).origin) {
    throw new Error('credential origin does not match PAYPAY_SEC_PASSKEY_ORIGIN')
  }
  return { ...credential, provider: 'paypay-sec' } as PlaintextStoredWebAuthnCredential
}

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
