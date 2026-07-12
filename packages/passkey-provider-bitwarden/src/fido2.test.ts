import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { expect, test } from 'vitest'
import { createBitwardenAssertion, parseBitwardenCredentialId } from './fido2'
import type { BitwardenPasskey } from './vault'

test('parses Bitwarden UUID credential IDs as raw bytes', () => {
  expect(parseBitwardenCredentialId('00000000-0000-4000-8000-000000000000')).toEqual(
    Buffer.from('00000000000040008000000000000000', 'hex'),
  )
})

test('parses b64 credential IDs as raw bytes', () => {
  expect(parseBitwardenCredentialId('b64.' + Buffer.from('raw-id').toString('base64url'))).toEqual(
    Buffer.from('raw-id'),
  )
})

test('creates a signed Bitwarden WebAuthn assertion', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' })
  const passkey: BitwardenPasskey = {
    cipherId: 'cipher1',
    cipherName: 'Example Login',
    credentialId: '00000000-0000-4000-8000-000000000000',
    rpId: 'example.com',
    userHandle: Buffer.from('alice').toString('base64url'),
    userName: 'alice',
    counter: 3,
    discoverable: true,
    keyValue: privateKeyDer.toString('base64url'),
  }

  const assertion = createBitwardenAssertion(
    passkey,
    {
      challenge: Buffer.from('challenge').toString('base64url'),
      rpId: 'example.com',
    },
    {
      origin: 'https://example.com',
      userVerification: true,
      counterBump: true,
    },
  )

  expect(assertion.id).toBe(
    Buffer.from('00000000000040008000000000000000', 'hex').toString('base64url'),
  )
  expect(assertion.rawId).toBe(assertion.id)
  expect(assertion.userHandle).toBe(Buffer.from('alice').toString('base64url'))

  const clientData = JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString('utf8'))
  expect(clientData).toEqual({
    type: 'webauthn.get',
    challenge: Buffer.from('challenge').toString('base64url'),
    origin: 'https://example.com',
  })

  const authenticatorData = Buffer.from(assertion.authenticatorData, 'base64url')
  expect(authenticatorData).toHaveLength(37)
  expect(authenticatorData[32]).toBe(0x1d)
  expect(authenticatorData.readUInt32BE(33)).toBe(4)

  const signedData = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(Buffer.from(assertion.clientDataJSON, 'base64url')).digest(),
  ])
  expect(
    verify('sha256', signedData, publicKey, Buffer.from(assertion.signature, 'base64url')),
  ).toBe(true)
})
