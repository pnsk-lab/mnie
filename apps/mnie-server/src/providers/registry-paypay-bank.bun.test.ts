import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as paypayBank from '@mnie/provider-paypay-bank'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import * as keyring from '../security/keyring'
import type { StoredPayPayBankSecret } from './credentials'
import { ProviderRegistry, type AccountProfile } from './registry'

afterEach(() => mock.restore())

describe('PayPay Bank expired-session recovery', () => {
  for (const method of ['availability', 'connect'] as const) {
    test(`${method} logs in again when the saved session reports UNKNOWN`, async () => {
      const session: paypayBank.PayPayBankSession = {
        baseURL: 'https://bank.example.test',
        branchNo: '001',
        accountNo: '1234567',
        password: 'password',
        cookies: {},
        sid: 'expired-session',
        uid: 'user',
      }
      const expired = await paypayBank.importSession(session)
      const renewed = await paypayBank.importSession({ ...session, sid: 'renewed-session' })
      spyOn(expired, 'getBalance').mockRejectedValue(new Error('session expired'))
      spyOn(renewed, 'getBalance').mockResolvedValue({
        currency: 'JPY',
        amount: 100,
        monthlyAverage: 100,
        interest: 0,
        interestPoints: 0,
      })
      expect(await paypayBank.createProvider(expired).checkAvailability()).toMatchObject({
        ok: false,
        reason: 'UNKNOWN',
      })

      let stored: StoredPayPayBankSecret = { ...session, session }
      spyOn(keyring, 'readSecret').mockImplementation(async <T>() => structuredClone(stored) as T)
      spyOn(keyring, 'saveSecret').mockImplementation(async (_account, value) => {
        stored = structuredClone(value as StoredPayPayBankSecret)
      })
      const resume = spyOn(paypayBank, 'importSession').mockResolvedValueOnce(expired)
      const login = spyOn(paypayBank, 'login').mockResolvedValueOnce(renewed)
      const profile = {
        id: 'paypay-bank-profile',
        provider: 'paypay-bank',
        keyringAccount: 'paypay-bank-secret',
      } as AccountProfile
      const registry = new ProviderRegistry(
        {} as Db,
        {
          payPayBankBaseUrl: session.baseURL,
        } as ServerConfig,
      )
      spyOn(registry, 'profile').mockResolvedValue(profile)

      if (method === 'availability') {
        expect((await registry.availability(profile)).connection.ok).toBe(true)
      } else {
        const result = await registry.connect(profile.id)
        expect(result.connection.status).toBe('connected')
        await result.open?.persist()
        await result.open?.release()
      }

      expect(resume).toHaveBeenCalledTimes(1)
      expect(login).toHaveBeenCalledTimes(1)
      expect(login).toHaveBeenCalledWith({
        branchNo: session.branchNo,
        accountNo: session.accountNo,
        password: session.password,
        baseURL: session.baseURL,
      })
      expect(stored.session).toMatchObject({ sid: 'renewed-session' })
    })
  }
})
