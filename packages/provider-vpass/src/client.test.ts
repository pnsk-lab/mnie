import { describe, expect, it } from 'vitest'
import { VpassAuthError, VpassClient, VpassError, normalizeOrigin, type FetchLike } from './client'
import { DEFAULT_VPASS_OS_VERSION, buildVpassUserAgent } from './constants'

const client = (fetch: FetchLike) =>
  new VpassClient({
    apiBaseURL: 'https://app.example.test',
    webBaseURL: 'https://member.example.test',
    appVersion: '5.13.0',
    osVersion: '16',
    userAgent:
      'com.smbc_card.vpass.android_v5.13.0 Mozilla/5.0 (Linux; Android 16; Test) AppleWebKit/537.36',
    fetch,
  })

const envelope = (status = 200, type = 'success', data: unknown = {}) => ({
  status,
  type,
  description: 'server-controlled-description',
  description_sub: 'server-controlled-detail',
  data,
})

describe('VpassClient app transport', () => {
  it('uses the provider request profile when OS and User-Agent are omitted', async () => {
    let headers = new Headers()
    const fetch: FetchLike = async (_url, init) => {
      headers = new Headers(init.headers)
      return new Response(JSON.stringify(envelope()), { status: 200 })
    }
    const defaultClient = new VpassClient({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '9.8.7',
      fetch,
    })

    await defaultClient.callApp('Fauth', {})

    expect(headers.get('X-App-Version')).toBe('9.8.7')
    expect(headers.get('X-OS-Version')).toBe(DEFAULT_VPASS_OS_VERSION)
    expect(headers.get('User-Agent')).toBe(buildVpassUserAgent('9.8.7'))
  })

  it('sends Fauth to the configured origin with explicit Android app headers', async () => {
    let request: { url: URL; init: RequestInit } | undefined
    const fetch: FetchLike = async (url, init) => {
      request = { url, init }
      return new Response(JSON.stringify(envelope()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await client(fetch).callApp('Fauth', {
      auth: 'encrypted',
      is_first_login: 1,
      push: 0,
      auto_login: 0,
      os_type: 2,
      id_type: 2,
    })

    expect(request?.url.href).toBe('https://app.example.test/api/v3/Fauth')
    const headers = new Headers(request?.init.headers)
    expect(headers.get('X-App-Version')).toBe('5.13.0')
    expect(headers.get('X-OS-Version')).toBe('16')
    expect(headers.get('Cache-Control')).toBe('no-cache')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('User-Agent')).toContain('com.smbc_card.vpass.android_v5.13.0 Mozilla/5.0')
    expect(headers.has('X-VappSessionTime')).toBe(false)
    expect(JSON.parse(String(request?.init.body))).toEqual({
      auth: 'encrypted',
      is_first_login: 1,
      push: 0,
      auto_login: 0,
      os_type: 2,
      id_type: 2,
    })
  })

  it('does not add app headers to member calls', async () => {
    let headers = new Headers()
    const fetch: FetchLike = async (_url, init) => {
      headers = new Headers(init.headers)
      return new Response(
        JSON.stringify({ header: { resultCode: '0', loginFlg: true }, body: { content: {} } }),
        { status: 200 },
      )
    }
    await client(fetch).callMember('spapp/top/v1')
    expect(headers.has('X-App-Version')).toBe(false)
    expect(headers.has('X-OS-Version')).toBe(false)
    expect(headers.has('Cache-Control')).toBe(false)
  })
})

describe('VpassClient error metadata', () => {
  it('separates HTTP status, provider status, and provider type', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(envelope(410, 'login_token_expired')), { status: 400 })
    const error = await client(fetch)
      .callApp('Fauth', {})
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(VpassError)
    expect(error).toMatchObject({
      httpStatus: 400,
      providerStatus: 410,
      providerType: 'login_token_expired',
    })
    expect(String(error)).not.toContain('server-controlled')
  })

  it('rejects an HTTP failure even when the envelope claims success', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(envelope(200, 'success')), { status: 400 })
    await expect(client(fetch).callApp('Fauth', {})).rejects.toMatchObject({
      httpStatus: 400,
      providerStatus: 200,
    })
  })

  it('rejects a provider failure on HTTP 200', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(envelope(400, 'login_invalid')), { status: 200 })
    await expect(client(fetch).callApp('Fauth', {})).rejects.toMatchObject({
      httpStatus: 200,
      providerStatus: 400,
      providerType: 'login_invalid',
    })
  })

  it('does not retain a non-JSON response body', async () => {
    const fetch: FetchLike = async () =>
      new Response('secret-cookie secret-password server-body', { status: 502 })
    const error = await client(fetch)
      .callApp('Fauth', {})
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(VpassError)
    expect(error.httpStatus).toBe(502)
    expect(JSON.stringify(error)).not.toContain('secret-')
    expect(String(error)).not.toContain('server-body')
  })

  it('preserves metadata when authentication wraps an app error', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(envelope(400, 'login_invalid')), { status: 400 })
    const error = await client(fetch)
      .authenticate(
        { mode: 'token', token: 'secret-token', idKind: 'vpass' },
        {
          deviceId: '8e15abae-2918-4237-84f5-11c456415883',
          deviceToken: '',
          issuedAt: 1786103454,
        },
      )
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(VpassAuthError)
    expect(error).toMatchObject({
      httpStatus: 400,
      providerStatus: 400,
      providerType: 'login_invalid',
    })
  })

  it('drops unsafe provider type text', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(envelope(400, 'secret-token\nother')), { status: 400 })
    await expect(client(fetch).callApp('Fauth', {})).rejects.toMatchObject({
      providerType: undefined,
    })
  })
})

describe('normalizeOrigin', () => {
  it('rejects embedded credentials', () => {
    expect(() => normalizeOrigin('https://user:secret@example.test', 'apiBaseURL')).toThrow(
      /credentials/,
    )
  })
})
