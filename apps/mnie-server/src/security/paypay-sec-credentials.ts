import type { PlaintextStoredWebAuthnCredential } from '@mnie/provider-paypay-sec'

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
