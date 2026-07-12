import { createHash, createPrivateKey, sign } from 'node:crypto'
import type {
  PasskeyAssertionProvider,
  PlaintextStoredWebAuthnCredential,
  WebAuthnAssertion,
  WebAuthnAssertionRequest,
} from '../types'

const base64Url = (value: Buffer | Uint8Array | string) => Buffer.from(value).toString('base64url')

export const createStoredCredentialPasskeyProvider = (
  credential: PlaintextStoredWebAuthnCredential,
): PasskeyAssertionProvider => ({
  rpId: credential.rpId,
  origin: credential.origin,
  createAssertion: (request) => createStoredCredentialAssertion(credential, request),
})

const createStoredCredentialAssertion = (
  credential: PlaintextStoredWebAuthnCredential,
  request: WebAuthnAssertionRequest,
): WebAuthnAssertion => {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: request.challenge,
      origin: credential.origin,
      crossOrigin: false,
    }),
  )
  const signCount =
    credential.authenticator.signCount > 0 ? credential.authenticator.signCount + 1 : 0
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(request.rpId).digest(),
    Buffer.from([assertionFlags(credential)]),
    uint32be(signCount),
  ])
  const signedData = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataJSON).digest(),
  ])
  const key = createPrivateKey({
    key: credential.secretPlaintext.privateKey.jwk,
    format: 'jwk',
  })

  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    clientDataJSON: base64Url(clientDataJSON),
    authenticatorData: base64Url(authenticatorData),
    signature: base64Url(sign('sha256', signedData, key)),
    userHandle: credential.userHandle ?? '',
  }
}

const assertionFlags = (credential: PlaintextStoredWebAuthnCredential) => {
  let flags = 0x01
  if (credential.authenticator.userVerification !== 'discouraged') flags |= 0x04
  if (credential.authenticator.backupEligible) flags |= 0x08
  if (credential.authenticator.backupState) flags |= 0x10
  return flags
}

const uint32be = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}
