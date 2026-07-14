import { describe, expect, test } from 'vite-plus/test'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import {
  invokeAvailableOperation,
  operationAvailability,
  ProviderOperationUnavailableError,
} from './operations'

const provider = (
  availability: Awaited<ReturnType<typeof operationAvailability>>,
): FinancialProvider<OperationMap> => ({
  descriptor: { id: 'test-broker', name: 'Test Broker' },
  accountId: 'account',
  capabilities: () => ['investments:trade'],
  operations: () => ['investments.orders.create'],
  checkAvailability: async () => ({ ok: true }),
  checkOperationAvailability: async () => availability,
  invoke: async (_operation, input) => input,
  exportSession: () => ({}),
  close: () => {},
})

describe('provider operation availability gate', () => {
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
      await operationAvailability(provider(available), {
        operation: 'investments.orders.create',
        input: { amount: { currency: 'JPY', value: '1000' } },
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
      invokeAvailableOperation(provider(unavailable), 'investments.orders.create', {
        instrumentId: '1234',
      }),
    ).rejects.toBeInstanceOf(ProviderOperationUnavailableError)
  })

  test('does not invoke operations the provider did not advertise', async () => {
    const result = await operationAvailability(provider({ available: true }), {
      operation: 'investments.orders.cancel',
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
      operationAvailability(provider(unavailable), {
        operation: 'investments.orders.create',
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'PROVIDER_RESTRICTED',
      message: 'market is closed',
    })
  })
})
