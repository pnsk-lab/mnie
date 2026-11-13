import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as vpass from '@mnie/provider-vpass'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { accountProfiles } from '../db/schema'
import { listHistory } from '../history'
import * as keyring from '../security/keyring'
import type { StoredVpassSecret } from './credentials'
import { ProviderRegistry, type AccountProfile } from './registry'

const connectVpass = vpass.connect

const session: vpass.VpassSession = {
  apiBaseURL: 'https://app.example.test',
  webBaseURL: 'https://member.example.test',
  appVersion: '5.13.0',
  endpoint: 'Fauth',
  push: false,
  deviceId: '8e15abae-2918-4237-84f5-11c456415883',
  deviceToken: '',
  cardCompanyCode: '001',
  idKind: 'vpass',
  globalId: 'GID1',
  cardCode: 'AUTH_CARD_CODE',
  token: 'token-0',
  cookies: {},
}

const connectedProfile = (token: string, loginFlg = true, rows: Record<string, string>[] = []) => {
  const client = new vpass.VpassClient({
    ...session,
    fetch: async (url) =>
      Response.json({
        header: { resultCode: '0', loginFlg },
        body: {
          content: url.pathname.includes('multicard')
            ? {
                MulticardInformationResponseServiceBean: {
                  cardInfo: [
                    { globalId: 'GID1', cardIdentifyKey: 'CARD1', cardCompanyCode: '001' },
                  ],
                },
              }
            : {
                CustomizedMeisaiAnsDisplayServiceBean: {
                  seikyuYM: '202601',
                  total: rows.length,
                  pageSize: 100,
                  seikyuYMList: [{ value: '202601' }],
                  meisaiList: rows,
                },
              },
        },
      }),
  })
  return new vpass.VpassProfile(client, { ...session, token })
}

const setup = () => {
  let stored: StoredVpassSecret = {
    loginId: 'login-id',
    password: 'password',
    session: structuredClone(session),
  }
  const read = spyOn(keyring, 'readSecret').mockImplementation(
    async <T>() => structuredClone(stored) as T,
  )
  const save = spyOn(keyring, 'saveSecret').mockImplementation(async (_account, value) => {
    stored = structuredClone(value as StoredVpassSecret)
  })
  const resume = spyOn(vpass, 'resume')
  const connect = spyOn(vpass, 'connect')
  const profile = {
    id: 'vpass-profile',
    provider: 'vpass',
    keyringAccount: 'vpass-secret',
  } as AccountProfile
  const db = createDb(':memory:')
  const registry = new ProviderRegistry(db, {
    vpassApiBaseUrl: session.apiBaseURL,
    vpassWebBaseUrl: session.webBaseURL,
    vpassAppVersion: session.appVersion,
  } as ServerConfig)
  spyOn(registry, 'profile').mockResolvedValue(profile)
  return { db, registry, profile, read, save, resume, connect, stored: () => stored }
}

afterEach(() => mock.restore())

describe('VPass history', () => {
  test('formats range bounds as Tokyo calendar dates, including across New Year', () => {
    const { registry, profile } = setup()
    expect(
      registry.historyListInput(
        profile,
        new Date('2025-12-31T23:00:00+09:00'),
        new Date('2026-01-01T08:00:00+09:00'),
      ),
    ).toEqual({ from: '2025-12-31', to: '2026-01-01', kinds: ['transaction'] })
  })

  test('returns a same-day transaction for a query ending before 09:00 JST', async () => {
    const { db, registry, profile, resume } = setup()
    await db.insert(accountProfiles).values({
      ...profile,
      label: 'VPass',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    resume.mockResolvedValueOnce(
      connectedProfile('token-1', true, [
        { riyouDate: '26/01/01', kmName: 'Previous day', riyouKin: '100' },
        { riyouDate: '26/01/02', kmName: 'Same day', riyouKin: '500' },
        { riyouDate: '26/01/03', kmName: 'Next day', riyouKin: '200' },
      ]),
    )

    const result = await listHistory(db, registry, {
      from: '2026-01-02T00:00:00+09:00',
      to: '2026-01-02T08:00:00+09:00',
      kinds: ['transaction'],
    })

    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      kind: 'transaction',
      occurredAt: '2026-01-01T15:00:00.000Z',
      transaction: { occurredAt: '2026-01-02T00:00:00+09:00', description: 'Same day' },
    })
  })
})

describe('VPass registry session persistence', () => {
  for (const method of ['availability', 'connect'] as const) {
    for (const type of [
      'vpass_login_token_expired',
      'fa_login_token_expired',
      'login_token_not_exist',
    ]) {
      test(`${method} recovers from Fauth ${type} using stored credentials`, async () => {
        const { registry, profile, resume, connect, stored } = setup()
        const fetch = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          Response.json({ status: 400, type, data: {} }),
        )
        connect
          .mockImplementationOnce(connectVpass)
          .mockResolvedValueOnce(connectedProfile('token-1'))

        if (method === 'availability') {
          expect((await registry.availability(profile)).connection.ok).toBe(true)
        } else {
          const result = await registry.connect(profile.id)
          expect(result.connection.status).toBe('connected')
          await result.open?.release()
        }

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String(fetch.mock.calls[0]?.[0])).toBe('https://app.example.test/api/v3/Fauth')
        expect(resume).toHaveBeenCalledTimes(1)
        expect(connect).toHaveBeenCalledTimes(2)
        expect(connect.mock.calls[0]?.[0]).toMatchObject({ token: 'token-0' })
        expect(connect.mock.calls[1]?.[0]).toMatchObject({
          loginId: 'login-id',
          password: 'password',
        })
        expect(stored().session?.token).toBe('token-1')
      })
    }

    for (const failure of [
      new TypeError('network unavailable'),
      new vpass.VpassError('member API returned HTML', { httpStatus: 200 }),
      new vpass.VpassError('member API failed', { httpStatus: 502 }),
    ]) {
      test(`${method} preserves ${failure.message} without password login`, async () => {
        const { registry, profile, resume, connect, stored } = setup()
        const connected = connectedProfile('token-1')
        spyOn(connected, 'continueSession').mockRejectedValue(failure)
        resume.mockResolvedValue(connected)
        connect.mockRejectedValue(new Error('unexpected password login'))

        if (method === 'availability') {
          expect((await registry.availability(profile)).connection).toMatchObject({
            ok: false,
            reason: 'UNKNOWN',
            message: 'VPass availability check failed',
          })
        } else {
          await expect(registry.connect(profile.id)).rejects.toThrow(
            'VPass availability check failed',
          )
        }
        expect(connect).not.toHaveBeenCalled()
        expect(resume).toHaveBeenCalledTimes(1)
        expect(stored().session?.token).toBe('token-1')
      })
    }

    test(`${method} retries a member session authentication rejection with the password`, async () => {
      const { registry, profile, resume, connect } = setup()
      const connected = connectedProfile('token-1')
      spyOn(connected, 'continueSession').mockRejectedValue(
        new vpass.VpassAuthError('session expired'),
      )
      resume.mockResolvedValueOnce(connected)
      connect.mockResolvedValueOnce(connectedProfile('token-2'))

      if (method === 'availability') {
        expect((await registry.availability(profile)).connection.ok).toBe(true)
      } else {
        const result = await registry.connect(profile.id)
        expect(result.connection.status).toBe('connected')
        await result.open?.release()
      }
      expect(connect).toHaveBeenCalledTimes(1)
    })

    test(`${method} retries an initial card lookup authentication rejection after saving the rotated token`, async () => {
      const { registry, profile, resume, connect, stored } = setup()
      resume.mockResolvedValueOnce(connectedProfile('token-1', false))
      connect.mockImplementationOnce(async () => {
        expect(stored().session?.token).toBe('token-1')
        return connectedProfile('token-2')
      })

      if (method === 'availability') {
        expect((await registry.availability(profile)).connection.ok).toBe(true)
      } else {
        const result = await registry.connect(profile.id)
        expect(result.connection.status).toBe('connected')
        await result.open?.release()
      }
      expect(connect).toHaveBeenCalledTimes(1)
      expect(connect.mock.calls[0]?.[0]).toMatchObject({
        loginId: 'login-id',
        password: 'password',
      })
      expect(resume).toHaveBeenCalledTimes(1)
      expect(stored().session?.token).toBe('token-2')
    })
  }

  test('an older open provider cannot overwrite a token saved by a newer login', async () => {
    const { registry, profile, resume, stored } = setup()
    const olderProfile = connectedProfile('token-1')
    const newerProfile = connectedProfile('token-2')
    resume.mockResolvedValueOnce(olderProfile).mockResolvedValueOnce(newerProfile)

    const older = await registry.open(profile)
    expect(stored().session?.token).toBe('token-1')
    const newer = await registry.open(profile)
    expect(stored().session?.token).toBe('token-2')

    olderProfile.client.jar.import({ cookie: 'older-cookie' })
    await older.persist()
    expect(stored().session?.token).toBe('token-2')
    expect(stored().session?.cookies).toEqual({})

    newerProfile.client.jar.import({ cookie: 'newer-cookie' })
    await newer.persist()
    expect(stored().session?.token).toBe('token-2')
    expect(stored().session?.cookies).toEqual({ cookie: 'newer-cookie' })
  })

  test('serializes concurrent logins before reading and rotating the saved token', async () => {
    const { registry, profile, resume, stored } = setup()
    let sequence = 0
    const resumedTokens: (string | undefined)[] = []
    resume.mockImplementation(async (saved) => {
      resumedTokens.push(saved.token)
      await Promise.resolve()
      return connectedProfile(`token-${++sequence}`)
    })

    await Promise.all([registry.open(profile), registry.open(profile)])

    expect(resumedTokens).toEqual(['token-0', 'token-1'])
    expect(stored().session?.token).toBe('token-2')
  })

  test('saves the rotated token even when resolving the authenticated card fails', async () => {
    const { registry, profile, resume, connect, stored } = setup()
    const connected = connectedProfile('token-1')
    spyOn(connected, 'cards').mockRejectedValueOnce(new vpass.VpassError('card lookup failed'))
    resume.mockResolvedValueOnce(connected)

    await expect(registry.open(profile)).rejects.toThrow('card lookup failed')
    expect(connect).not.toHaveBeenCalled()
    expect(stored().session?.token).toBe('token-1')
  })

  test('keeps the rotated token when password recovery after the initial card lookup fails', async () => {
    const { registry, profile, resume, connect, stored } = setup()
    const failure = new vpass.VpassAuthError('password rejected')
    resume.mockResolvedValueOnce(connectedProfile('token-1', false))
    connect.mockRejectedValueOnce(failure)

    await expect(registry.open(profile)).rejects.toBe(failure)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(stored().session?.token).toBe('token-1')
  })

  test('does not retry initial card lookup authentication after a forced password login', async () => {
    const { registry, profile, resume, connect, stored } = setup()
    connect.mockResolvedValueOnce(connectedProfile('token-1', false))

    await expect(registry.open(profile, { forceLogin: true })).rejects.toBeInstanceOf(
      vpass.VpassAuthError,
    )
    expect(connect).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
    expect(stored().session?.token).toBe('token-1')
  })

  test('surfaces a resume transport failure without trying the password', async () => {
    const { registry, profile, resume, connect, save, stored } = setup()
    const failure = new vpass.VpassError('Fauth returned a non-JSON response', { httpStatus: 502 })
    resume.mockRejectedValueOnce(failure)

    await expect(registry.open(profile)).rejects.toBe(failure)
    expect(connect).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(stored().session?.token).toBe('token-0')
  })

  test('retries with the password only after an explicit token rejection', async () => {
    const { registry, profile, resume, connect, stored } = setup()
    resume.mockRejectedValueOnce(new vpass.VpassAuthError('token rejected'))
    connect.mockResolvedValueOnce(connectedProfile('token-1'))

    await registry.open(profile)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ loginId: 'login-id', password: 'password' })
    expect(stored().session?.token).toBe('token-1')
  })
})
