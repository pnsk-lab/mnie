import { describe, expect, test } from 'vitest'
import { normalizePayPaySecCredential } from './paypay-sec-credentials'

const credential = {
  version: 1,
  kind: 'webauthn-credential',
  provider: 'sbi-sec',
  rpId: 'passkey.example.com',
  origin: 'https://login.passkey.example.com',
  credentialId: 'credential-id',
  alg: -7,
  publicKey: { format: 'jwk', jwk: { kty: 'EC' } },
  authenticator: {
    signCount: 0,
    discoverable: true,
    userVerification: 'preferred',
  },
  secretPlaintext: { privateKey: { format: 'jwk', jwk: { kty: 'EC', d: 'secret' } } },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('normalizePayPaySecCredential', () => {
  test('validates the configured origin and normalizes the provider tag', () => {
    expect(
      normalizePayPaySecCredential(credential, 'https://login.passkey.example.com').provider,
    ).toBe('paypay-sec')
  })

  test('rejects an incomplete credential or a different origin', () => {
    expect(() => normalizePayPaySecCredential({ kind: 'webauthn-credential' })).toThrow(
      'portable WebAuthn credential',
    )
    expect(() => normalizePayPaySecCredential(credential, 'https://different.example.com')).toThrow(
      'PAYPAY_SEC_PASSKEY_ORIGIN',
    )
  })
})
