import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { expect, test } from 'vite-plus/test'
import { createStoredCredentialPasskeyProvider } from './passkey'
import type { PlaintextStoredWebAuthnCredential, WebAuthnJwk } from '../types'

const b64 = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url')

const exportJwk = (key: KeyObject): WebAuthnJwk => {
  const jwk = key.export({ format: 'jwk' })
  if (!jwk.kty) throw new Error('expected generated JWK to include kty')
  return jwk as WebAuthnJwk
}

const makeCredential = (): PlaintextStoredWebAuthnCredential => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    version: 1,
    kind: 'webauthn-credential',
    provider: 'paypay-sec',
    rpId: 'example.test',
    origin: 'https://passkey.example.test',
    credentialId: b64(Buffer.from('credential-id')),
    userHandle: b64(Buffer.from('user-handle')),
    alg: -7,
    publicKey: { format: 'jwk', jwk: exportJwk(publicKey) },
    authenticator: {
      signCount: 0,
      discoverable: true,
      userVerification: 'required',
      backupEligible: true,
      backupState: true,
    },
    secretPlaintext: {
      privateKey: { format: 'jwk', jwk: exportJwk(privateKey) },
    },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  }
}

test('stored credential provider creates a verifiable WebAuthn assertion', async () => {
  const credential = makeCredential()
  const provider = createStoredCredentialPasskeyProvider(credential)
  const challenge = b64(Buffer.from('challenge'))
  const assertion = await provider.createAssertion({ challenge, rpId: credential.rpId })

  expect(assertion).toMatchObject({
    id: credential.credentialId,
    rawId: credential.credentialId,
    userHandle: credential.userHandle,
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
  })
  expect(JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString('utf8'))).toEqual({
    type: 'webauthn.get',
    challenge,
    origin: credential.origin,
    crossOrigin: false,
  })

  const authenticatorData = Buffer.from(assertion.authenticatorData, 'base64url')
  expect(authenticatorData.subarray(0, 32)).toEqual(
    createHash('sha256').update(credential.rpId).digest(),
  )
  expect(authenticatorData[32]).toBe(0x1d)
  const signedData = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(Buffer.from(assertion.clientDataJSON, 'base64url')).digest(),
  ])
  expect(
    verify(
      'sha256',
      signedData,
      createPublicKey(
        createPrivateKey({ key: credential.secretPlaintext.privateKey.jwk, format: 'jwk' }),
      ),
      Buffer.from(assertion.signature, 'base64url'),
    ),
  ).toBe(true)
})

test('stored credential provider rejects a different RP ID', async () => {
  const provider = createStoredCredentialPasskeyProvider(makeCredential())
  expect(() =>
    provider.createAssertion({ challenge: b64(Buffer.from('challenge')), rpId: 'other.test' }),
  ).toThrow(expect.objectContaining({ code: 'PASSKEY_RP_ID_MISMATCH' }))
})
