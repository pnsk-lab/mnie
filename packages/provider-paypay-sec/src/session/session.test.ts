import { generateKeyPairSync } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { describe, expect, test, vi } from 'vite-plus/test'
import {
  createStoredCredentialPasskeyProvider,
  loginWithPasskey,
  type PlaintextStoredWebAuthnCredential,
  type WebAuthnJwk,
} from '../index'

const WEB_ORIGIN = 'https://trade.example.test'
const BFF_ORIGIN = 'https://bff.example.test'
const PASSKEY_ORIGIN = 'https://passkey.example.test'
const RP_ID = 'example.test'
const CHALLENGE = Buffer.from('challenge').toString('base64url')

const exportJwk = (key: KeyObject): WebAuthnJwk => {
  const jwk = key.export({ format: 'jwk' })
  if (!jwk.kty) throw new Error('expected generated JWK to include kty')
  return jwk as WebAuthnJwk
}

const credential = (): PlaintextStoredWebAuthnCredential => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    version: 1,
    kind: 'webauthn-credential',
    provider: 'paypay-sec',
    rpId: RP_ID,
    origin: PASSKEY_ORIGIN,
    credentialId: Buffer.from('credential-id').toString('base64url'),
    userHandle: Buffer.from('user-handle').toString('base64url'),
    alg: -7,
    publicKey: { format: 'jwk', jwk: exportJwk(publicKey) },
    authenticator: {
      signCount: 0,
      discoverable: true,
      userVerification: 'required',
      backupEligible: true,
      backupState: true,
    },
    secretPlaintext: { privateKey: { format: 'jwk', jwk: exportJwk(privateKey) } },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  }
}

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

const successfulFetch = () => {
  const requests: Array<{ init: RequestInit; url: string }> = []
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    requests.push({ init, url })
    const headers = new Headers(init.headers)
    const requestNumber = requests.length
    if (requestNumber === 1) {
      expect(url).toBe(`${WEB_ORIGIN}/login/`)
      return new Response('<html>login</html>', {
        headers: { 'set-cookie': 'fuelrid=entry-session; Path=/; Secure' },
      })
    }
    if (requestNumber >= 2 && requestNumber <= 5) {
      expect(url.startsWith(`${BFF_ORIGIN}/api/passkey/`)).toBe(true)
      expect(headers.get('origin')).toBe(PASSKEY_ORIGIN)
      expect(headers.get('referer')).toBe(`${PASSKEY_ORIGIN}/`)
      expect(headers.get('app-id')).toBe('NATIVE_PC')
      expect(headers.get('device-id')).toBe('device-1')
      expect(headers.get('device-name')).toBe('test-node')
      expect(headers.get('time-zone')).toBe('Asia/Tokyo')
      expect(headers.get('cookie')).toContain('DEVICE_ID=device-1')
      expect(headers.get('cookie')).not.toContain('fuelrid=entry-session')
    }
    if (requestNumber === 2) {
      expect(url).toBe(`${BFF_ORIGIN}/api/passkey/prepare/v1?action=VERIFY`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({
        redirect_url: `${WEB_ORIGIN}/login/passkey/callback`,
      })
      return json({ temp_id: 'temporary-id' })
    }
    if (requestNumber === 3) {
      expect(url).toBe(`${BFF_ORIGIN}/api/passkey/options/v1?action=VERIFY`)
      expect(init.method).toBe('DELETE')
      return json({
        options: {
          mediation: 'required',
          publicKey: {
            rpId: RP_ID,
            challenge: CHALLENGE,
            userVerification: 'required',
            hints: ['client-device'],
          },
        },
      })
    }
    if (requestNumber === 4) {
      expect(url).toBe(`${BFF_ORIGIN}/api/passkey/credential/v1?action=VERIFY`)
      const body = JSON.parse(String(init.body))
      expect(body).toMatchObject({
        public_key_credential: {
          authenticatorAttachment: 'platform',
          clientExtensionResults: {},
          type: 'public-key',
        },
        temp_id: 'temporary-id',
      })
      expect(
        JSON.parse(
          Buffer.from(body.public_key_credential.response.clientDataJSON, 'base64url').toString(
            'utf8',
          ),
        ),
      ).toEqual({
        type: 'webauthn.get',
        challenge: CHALLENGE,
        origin: PASSKEY_ORIGIN,
        crossOrigin: false,
      })
      return json({})
    }
    if (requestNumber === 5) {
      expect(url).toBe(`${BFF_ORIGIN}/api/passkey/complete/v1?action=VERIFY`)
      return json(
        {},
        {
          headers: {
            'set-cookie':
              '__Secure-client-auth-state-test=temporary-auth; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        },
      )
    }
    if (requestNumber === 6) {
      expect(url).toBe(`${WEB_ORIGIN}/login/passkey/callback?passkey_status=success`)
      expect(headers.get('cookie')).toContain('fuelrid=entry-session')
      expect(headers.get('cookie')).toContain('__Secure-client-auth-state-test=temporary-auth')
      expect(headers.get('cookie')).toContain('DEVICE_ID=device-1')
      return redirect(`${WEB_ORIGIN}/login?passkey_status=success`, [
        'fuelrid=callback-session; Path=/; Secure',
        'CLIENT_SEQ_NO=client-sequence; Path=/; Secure',
      ])
    }
    if (requestNumber === 7) {
      expect(url).toBe(`${WEB_ORIGIN}/login?passkey_status=success`)
      expect(headers.get('cookie')).toContain('fuelrid=callback-session')
      expect(headers.get('cookie')).toContain('CLIENT_SEQ_NO=client-sequence')
      return redirect(`${WEB_ORIGIN}/trade/`, ['fuelrid=authenticated-session; Path=/; Secure'])
    }
    if (requestNumber === 8) {
      expect(url).toBe(`${WEB_ORIGIN}/trade/`)
      expect(headers.get('cookie')).toContain('fuelrid=authenticated-session')
      return new Response('<html>trade</html>')
    }
    throw new Error(`unexpected request: ${url}`)
  })
  return { fetch, requests }
}

const clientOptions = {
  accountId: 'account-1',
  deviceId: 'device-1',
  deviceName: 'test-node',
  timeZone: 'Asia/Tokyo',
} as const

describe('PayPay Securities passkey session', () => {
  test('logs in with a stored credential and exports only reusable session state', async () => {
    const { fetch, requests } = successfulFetch()
    const client = await loginWithPasskey(
      {
        baseURL: WEB_ORIGIN,
        passkeyBffBaseURL: BFF_ORIGIN,
        passkeyCredential: credential(),
      },
      { ...clientOptions, fetch },
    )
    expect(requests).toHaveLength(8)
    expect(client.accountId).toBe('account-1')
    expect(client.session.export()).toEqual({
      accountId: 'account-1',
      baseURL: WEB_ORIGIN,
      cookies: {
        CLIENT_SEQ_NO: 'client-sequence',
        DEVICE_ID: 'device-1',
        DEVICE_NAME: 'test-node',
        fuelrid: 'authenticated-session',
      },
    })
  })

  test('accepts a structurally compatible custom passkey provider', async () => {
    const value = credential()
    const stored = createStoredCredentialPasskeyProvider(value)
    const createAssertion = vi.fn(stored.createAssertion)
    const { fetch } = successfulFetch()
    await loginWithPasskey(
      {
        baseURL: WEB_ORIGIN,
        passkeyBffBaseURL: BFF_ORIGIN,
        passkeyProvider: { rpId: stored.rpId, origin: stored.origin, createAssertion },
      },
      { ...clientOptions, fetch },
    )
    expect(createAssertion).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: RP_ID })
  })

  test('rejects an RP ID that does not match the credential', async () => {
    const value = credential()
    const responses = [
      new Response('<html>login</html>'),
      json({ temp_id: 'temporary-id' }),
      json({ options: { publicKey: { rpId: 'other.test', challenge: CHALLENGE } } }),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    await expect(
      loginWithPasskey(
        {
          baseURL: WEB_ORIGIN,
          passkeyBffBaseURL: BFF_ORIGIN,
          passkeyCredential: value,
        },
        { ...clientOptions, fetch },
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_RP_ID_MISMATCH' })
  })

  test('maps BFF business errors without exposing credential material', async () => {
    const responses = [
      new Response('<html>login</html>'),
      json(
        { business_error_code: 'passkey_login_disabled.web-bff.paypay-sec.co.jp' },
        { status: 400 },
      ),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    const error = await loginWithPasskey(
      {
        baseURL: WEB_ORIGIN,
        passkeyBffBaseURL: BFF_ORIGIN,
        passkeyCredential: credential(),
      },
      { ...clientOptions, fetch },
    ).catch((cause: unknown) => cause)
    expect(error).toMatchObject({ code: 'PASSKEY_BFF_REJECTED' })
    expect(String(error)).not.toContain('credential-id')
  })

  test('rejects malformed BFF JSON and missing option fields', async () => {
    const malformed = vi.fn(async () =>
      malformed.mock.calls.length === 1
        ? new Response('<html>login</html>')
        : new Response('not json', { headers: { 'content-type': 'application/json' } }),
    )
    await expect(
      loginWithPasskey(
        {
          baseURL: WEB_ORIGIN,
          passkeyBffBaseURL: BFF_ORIGIN,
          passkeyCredential: credential(),
        },
        { ...clientOptions, fetch: malformed },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PASSKEY_RESPONSE' })

    const missing = [
      new Response('<html>login</html>'),
      json({ temp_id: 'temporary-id' }),
      json({ options: {} }),
    ]
    await expect(
      loginWithPasskey(
        {
          baseURL: WEB_ORIGIN,
          passkeyBffBaseURL: BFF_ORIGIN,
          passkeyCredential: credential(),
        },
        { ...clientOptions, fetch: vi.fn(async () => missing.shift()!) },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PASSKEY_RESPONSE' })
  })

  test('rejects a cross-origin callback redirect', async () => {
    const successful = successfulFetch()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (fetch.mock.calls.length === 6) return redirect('https://attacker.example/callback')
      return successful.fetch(input, init)
    })
    await expect(
      loginWithPasskey(
        {
          baseURL: WEB_ORIGIN,
          passkeyBffBaseURL: BFF_ORIGIN,
          passkeyCredential: credential(),
        },
        { ...clientOptions, fetch },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PASSKEY_CALLBACK' })
  })
})
