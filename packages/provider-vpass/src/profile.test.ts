import { afterEach, describe, expect, it, vi } from 'vitest'
import * as crypto from './crypto'
import { VpassClient } from './client'
import { DEFAULT_VPASS_OS_VERSION, buildVpassUserAgent } from './constants'
import { connect, resume } from './profile'

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
})
