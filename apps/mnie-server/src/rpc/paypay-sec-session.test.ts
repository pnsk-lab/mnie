import { describe, expect, test } from 'vitest'
import type { ServerConfig } from '../config'
import type { StoredPayPaySecSecret } from '../providers/credentials'
import { payPaySecConnectionOptions } from './paypay-sec-options'

const credential = {
  version: 1,
  kind: 'webauthn-credential',
  provider: 'paypay-sec',
  rpId: 'passkey.example.com',
  origin: 'https://login.passkey.example.com',
  credentialId: 'credential-id',
  alg: -7,
  publicKey: { format: 'jwk', jwk: { kty: 'EC' } },
  authenticator: { signCount: 0, discoverable: true, userVerification: 'preferred' },
  secretPlaintext: { privateKey: { format: 'jwk', jwk: { kty: 'EC', d: 'secret' } } },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as StoredPayPaySecSecret['credential']

const config = {
  payPaySecBaseUrl: 'https://trade.example.com/',
  payPaySecPasskeyBffBaseUrl: 'https://bff.example.com/',
} as ServerConfig

describe('payPaySecConnectionOptions', () => {
  test('uses the profile and stored stable device identity', () => {
    const options = payPaySecConnectionOptions(config, 'profile-1', {
      credential,
      deviceId: 'stable-device',
    })
    expect(options.login.baseURL).toBe('https://trade.example.com/')
    expect(options.login.passkeyBffBaseURL).toBe('https://bff.example.com/')
    expect(options.client).toEqual({ accountId: 'profile-1', deviceId: 'stable-device' })
  })

  test('requires both service origins', () => {
    expect(() =>
      payPaySecConnectionOptions({} as ServerConfig, 'profile-1', {
        credential,
        deviceId: 'stable-device',
      }),
    ).toThrow('PAYPAY_SEC_BASE_URL')
  })
})
