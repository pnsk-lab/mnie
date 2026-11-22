import { describe, expect, test } from 'vite-plus/test'
import type { FinancialProvider, MethodMap } from '@mnie/types'
import {
  invokeAvailableMethod,
  methodAvailability,
  ProviderMethodUnavailableError,
} from './operations'

const provider = (
  availability: Awaited<ReturnType<typeof methodAvailability>>,
): FinancialProvider<MethodMap> => ({
  descriptor: { id: 'test-broker', name: 'Test Broker' },
  accountId: 'account',
  capabilities: () => ['investments:trade'],
  methods: () => ['investments.orders.create'],
  checkAvailability: async () => ({ ok: true }),
  checkMethodAvailability: async () => availability,
  invoke: async (_method, input) => input,
  exportSession: () => ({}),
  close: () => {},
})

describe('provider method availability gate', () => {
  test('passes provider-specific amount order rules through availability', async () => {
    const available = {
      available: true as const,
      orderRules: {
        sizing: [{ kind: 'amount' as const, currency: 'JPY', minimum: '100', increment: '100' }],
        priceTypes: ['market' as const],
        timings: ['realtime' as const],
      },
    }
    expect(
      await methodAvailability(provider(available), {
        method: 'investments.orders.create',
        params: { amount: { currency: 'JPY', value: '1000' } },
      }),
    ).toEqual(available)
  })

  test('rejects an order when the provider reports an instrument restriction', async () => {
    const unavailable = {
      available: false as const,
      reason: 'INSTRUMENT_UNSUPPORTED' as const,
      message: 'odd-lot realtime trading is unavailable for this instrument',
    }
    await expect(
      invokeAvailableMethod(provider(unavailable), 'investments.orders.create', {
        instrumentId: '1234',
      }),
    ).rejects.toBeInstanceOf(ProviderMethodUnavailableError)
  })

  test('does not invoke methods the provider did not advertise', async () => {
    const result = await methodAvailability(provider({ available: true }), {
      method: 'investments.orders.cancel',
    })
    expect(result).toMatchObject({ available: false, reason: 'OPERATION_UNSUPPORTED' })
  })

  test('serializes provider errors in availability responses', async () => {
    const unavailable = {
      available: false as const,
      reason: 'PROVIDER_RESTRICTED' as const,
      message: new Error('market is closed'),
    }
    await expect(
      methodAvailability(provider(unavailable), {
        method: 'investments.orders.create',
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'PROVIDER_RESTRICTED',
      message: 'market is closed',
    })
  })
})
