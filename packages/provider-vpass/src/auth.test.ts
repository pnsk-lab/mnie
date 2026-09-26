import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { buildAuthPlaintext, buildAuthRequest, deviceIdCheckDigit, idTypeFor } from './auth'
import { requestHash } from './client'

const publicKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString()

const context = {
  deviceId: '8e15abae-2918-4237-84f5-11c456415883',
  deviceToken: 'fcm-token',
  issuedAt: 1786103454,
}

describe('deviceIdCheckDigit', () => {
  it('drops the separator at index 8 and inserts a digit four from the end', () => {
    const value = deviceIdCheckDigit(context.deviceId)
    // One character removed, one inserted: the length is unchanged.
    expect(value).toHaveLength(context.deviceId.length)
    expect(value.slice(0, 12)).toBe('8e15abae2918')
    expect(value.at(-4)).toMatch(/\d/)
  })

  it('is stable for a given device id', () => {
    expect(deviceIdCheckDigit(context.deviceId)).toBe(deviceIdCheckDigit(context.deviceId))
  })

  it('produces a digit in range for many random uuids', () => {
    for (let index = 0; index < 200; index++) {
      const uuid = crypto.randomUUID()
      const value = deviceIdCheckDigit(uuid)
      expect(value).toHaveLength(uuid.length)
      expect(Number(value.at(-4))).toBeGreaterThanOrEqual(0)
      expect(Number(value.at(-4))).toBeLessThanOrEqual(9)
    }
  })
})

describe('buildAuthPlaintext', () => {
  it('emits eight pipe-separated fields for a credential login', () => {
    const fields = buildAuthPlaintext(
      { mode: 'credential', loginId: 'user', password: 'secret', idKind: 'vpass' },
      context,
    ).split('|')

    expect(fields).toHaveLength(8)
    expect(fields[0]).toBe('user')
    expect(fields[1]).toBe('secret')
    expect(fields[2]).toBe(deviceIdCheckDigit(context.deviceId))
    expect(fields[3]).toBe('fcm-token')
    expect(fields[4]).toBe('')
    expect(fields[5]).toBe('001')
    expect(fields[6]).toBe('1786103454')
    expect(fields[7]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sends the token in place of the id and leaves the password empty', () => {
    const fields = buildAuthPlaintext(
      { mode: 'token', token: 'saved-token', idKind: 'vpass' },
      context,
    ).split('|')

    expect(fields[0]).toBe('saved-token')
    expect(fields[1]).toBe('')
  })

  it('digests different inputs in each mode', () => {
    const credential = buildAuthPlaintext(
      { mode: 'credential', loginId: 'tok', password: '', idKind: 'vpass' },
      context,
    ).split('|')[7]
    const token = buildAuthPlaintext(
      { mode: 'token', token: 'tok', idKind: 'vpass' },
      context,
    ).split('|')[7]
    // Same identifier and empty password, yet the orderings differ, so a shared
    // digest here would mean one of the two branches is wrong.
    expect(credential).not.toBe(token)
  })

  it('uses seconds, not milliseconds', () => {
    const stamp = buildAuthPlaintext(
      { mode: 'token', token: 't', idKind: 'vpass' },
      { ...context, issuedAt: undefined },
    ).split('|')[6]
    expect(Number(stamp)).toBeLessThan(Date.now() / 100)
  })
})

describe('buildAuthRequest', () => {
  it('marks a credential login as first login and not auto login', () => {
    const body = buildAuthRequest(
      { mode: 'credential', loginId: 'u', password: 'p', idKind: 'vpass' },
      { ...context, publicKeyPem, includeIdType: true },
    )
    expect(body.is_first_login).toBe(1)
    expect(body.auto_login).toBe(0)
    expect(body.os_type).toBe(2)
    expect(body.id_type).toBe(2)
  })

  it('inverts both flags for a token login', () => {
    const body = buildAuthRequest(
      { mode: 'token', token: 't', idKind: 'fa' },
      { ...context, publicKeyPem, includeIdType: true },
    )
    expect(body.is_first_login).toBe(0)
    expect(body.auto_login).toBe(1)
    expect(body.id_type).toBe(1)
  })

  it('omits id_type for the Vauth endpoint', () => {
    const body = buildAuthRequest(
      { mode: 'token', token: 't', idKind: 'vpass' },
      { ...context, publicKeyPem },
    )
    expect(body.id_type).toBeUndefined()
  })
})

describe('idTypeFor', () => {
  it('inverts the stored preference, as the app does on the wire', () => {
    expect(idTypeFor('fa')).toBe(1)
    expect(idTypeFor('vpass')).toBe(2)
  })
})

describe('requestHash', () => {
  // Values lifted from captured member-site traffic.
  const cases: [string, number][] = [
    ['/memapi/jaxrs/multicard/get_multicard_data/v1', 2412908886],
    ['/memapi/jaxrs/spapp/top/v1', 2210597291],
    ['/memapi/jaxrs/web_meisai/web_meisai_top/v1', 1494552592],
  ]
  it.each(cases)('matches the captured hash for %s', (path: string, expected: number) => {
    expect(requestHash(path)).toBe(expected)
  })
})
