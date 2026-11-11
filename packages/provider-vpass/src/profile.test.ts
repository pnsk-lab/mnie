import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as crypto from './crypto'
import { VpassAuthError, VpassClient, VpassError } from './client'
import { DEFAULT_VPASS_OS_VERSION, buildVpassUserAgent } from './constants'
import { connect, resume, type VpassSession } from './profile'

const responseFields = [
  'rotated-token',
  'global-id',
  'external-id',
  'card-code',
  '',
  '',
  '',
  '001',
  '1786103454',
  'digest',
].join('|')

describe('VPass request identity', () => {
  afterEach(() => vi.restoreAllMocks())

  it('generates and persists the provider defaults on first connect', async () => {
    vi.spyOn(VpassClient.prototype, 'authenticate').mockResolvedValue({ login_token: 'encrypted' })
    vi.spyOn(crypto, 'decryptPayload').mockReturnValue(responseFields)

    const profile = await connect({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '5.13.0',
      loginId: 'login-id',
      password: 'password',
    })

    expect(profile.session.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(profile.session.osVersion).toBe(DEFAULT_VPASS_OS_VERSION)
    expect(profile.session.userAgent).toBe(buildVpassUserAgent('5.13.0'))
    expect(profile.session.apiVersion).toBe('v3')
  })

  it('preserves the API endpoint version across exported sessions and supports explicit overrides', async () => {
    vi.spyOn(crypto, 'decryptPayload').mockReturnValue(responseFields)
    const paths: string[] = []
    const fetch = async (url: URL) => {
      paths.push(url.pathname)
      return Response.json({ status: 200, type: 'success', data: { login_token: 'encrypted' } })
    }

    const first = await connect({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '5.13.0',
      apiVersion: 'v4',
      loginId: 'login-id',
      password: 'password',
      fetch,
    })
    const saved: VpassSession = JSON.parse(JSON.stringify(first.session))
    const resumed = await resume(saved, { fetch })
    const overridden = await resume(resumed.session, { apiVersion: 'v5', fetch })
    await resume(overridden.session, { fetch })

    expect(paths).toEqual(['/api/v4/Fauth', '/api/v4/Fauth', '/api/v5/Fauth', '/api/v5/Fauth'])
    expect(saved.apiVersion).toBe('v4')
    expect(resumed.session.apiVersion).toBe('v4')
    expect(overridden.session.apiVersion).toBe('v5')
  })

  it('uses the default API version for legacy sessions that do not store it', async () => {
    vi.spyOn(crypto, 'decryptPayload').mockReturnValue(responseFields)
    const paths: string[] = []
    const fetch = async (url: URL) => {
      paths.push(url.pathname)
      return Response.json({ status: 200, type: 'success', data: { login_token: 'encrypted' } })
    }
    const first = await connect({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '5.13.0',
      loginId: 'login-id',
      password: 'password',
      fetch,
    })
    const legacy = { ...first.session }
    delete legacy.apiVersion

    const resumed = await resume(legacy, { fetch })

    expect(paths).toEqual(['/api/v3/Fauth', '/api/v3/Fauth'])
    expect(resumed.session.apiVersion).toBe('v3')
  })

  it('reuses the saved device and effective request profile on resume', async () => {
    const authenticate = vi
      .spyOn(VpassClient.prototype, 'authenticate')
      .mockResolvedValue({ login_token: 'encrypted' })
    vi.spyOn(crypto, 'decryptPayload').mockReturnValue(responseFields)

    const first = await connect({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '5.13.0',
      loginId: 'login-id',
      password: 'password',
    })
    const resumed = await resume(first.session)

    expect(resumed.session.deviceId).toBe(first.session.deviceId)
    expect(resumed.session.osVersion).toBe(first.session.osVersion)
    expect(resumed.session.userAgent).toBe(first.session.userAgent)
    expect(authenticate.mock.calls[1]?.[1]).toMatchObject({ deviceId: first.session.deviceId })
  })

  it('rebuilds the default User-Agent when appVersion is overridden on resume', async () => {
    vi.spyOn(VpassClient.prototype, 'authenticate').mockResolvedValue({ login_token: 'encrypted' })
    vi.spyOn(crypto, 'decryptPayload').mockReturnValue(responseFields)

    const first = await connect({
      apiBaseURL: 'https://app.example.test',
      webBaseURL: 'https://member.example.test',
      appVersion: '5.13.0',
      loginId: 'login-id',
      password: 'password',
    })
    const resumed = await resume(first.session, { appVersion: '5.14.0' })

    expect(resumed.session.appVersion).toBe('5.14.0')
    expect(resumed.session.userAgent).toBe(buildVpassUserAgent('5.14.0'))
    expect(resumed.session.deviceId).toBe(first.session.deviceId)
  })

  it.each([{}, { login_token: 'encrypted' }])(
    'keeps malformed auth responses distinct from credential rejection',
    async (data) => {
      vi.spyOn(VpassClient.prototype, 'authenticate').mockResolvedValue(data)
      vi.spyOn(crypto, 'decryptPayload').mockReturnValue('too|few|fields')

      const error = await connect({
        apiBaseURL: 'https://app.example.test',
        webBaseURL: 'https://member.example.test',
        appVersion: '5.13.0',
        loginId: 'login-id',
        password: 'password',
      }).catch((cause) => cause)

      expect(error).toBeInstanceOf(VpassError)
      expect(error).not.toBeInstanceOf(VpassAuthError)
    },
  )
})
