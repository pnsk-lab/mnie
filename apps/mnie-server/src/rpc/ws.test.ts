import { describe, expect, test, vi } from 'vitest'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import type { Db } from '../db'
import type { AdminRpcService } from './admin'
import type { ProviderRegistry } from '../providers/registry'
import { handleRpc, type RpcSocketState } from './handler'

const profile = {
  id: 'profile-1',
  provider: 'test-provider',
  label: 'Test profile',
  color: '#000000',
  keyringAccount: 'unused',
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const state = (owner = false): RpcSocketState => ({ owner })

const registryWith = (provider: FinancialProvider<OperationMap>) =>
  ({
    open: vi.fn(async () => ({
      profile,
      provider,
      persist: async () => {},
      release: async () => {},
    })),
  }) as unknown as ProviderRegistry

const unusedDb = {} as Db
const unusedAdmin = {} as AdminRpcService

describe('WebSocket RPC dispatch', () => {
  test('invokes an available profile operation', async () => {
    const invoke = vi.fn(async () => ({ items: [] }))
    const provider = {
      operations: () => ['accounts.list'],
      checkOperationAvailability: vi.fn(async () => ({ available: true as const })),
      invoke,
    } as unknown as FinancialProvider<OperationMap>

    const response = await handleRpc(unusedDb, registryWith(provider), unusedAdmin, state(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'profile.invoke',
      params: { profileId: profile.id, operation: 'accounts.list', input: {} },
    })

    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { items: [] } })
    expect(provider.checkOperationAvailability).toHaveBeenCalledWith({
      operation: 'accounts.list',
      input: {},
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  test('rejects a profile operation denied by provider availability', async () => {
    const invoke = vi.fn()
    const provider = {
      operations: () => ['investments.orders.create'],
      checkOperationAvailability: vi.fn(async () => ({
        available: false as const,
        reason: 'INSTRUMENT_UNSUPPORTED' as const,
        message: 'odd-lot trading is unavailable for this instrument',
      })),
      invoke,
    } as unknown as FinancialProvider<OperationMap>

    await expect(
      handleRpc(unusedDb, registryWith(provider), unusedAdmin, state(), {
        jsonrpc: '2.0',
        id: 2,
        method: 'profile.invoke',
        params: {
          profileId: profile.id,
          operation: 'investments.orders.create',
          input: { allowTransaction: true },
        },
      }),
    ).rejects.toThrow('odd-lot trading is unavailable for this instrument')
    expect(invoke).not.toHaveBeenCalled()
  })

  test('invokes admin operations for an owner session', async () => {
    const admin = {
      invoke: vi.fn(async () => ({ providers: [] })),
    } as unknown as AdminRpcService
    const response = await handleRpc(unusedDb, {} as ProviderRegistry, admin, state(true), {
      jsonrpc: '2.0',
      id: 3,
      method: 'admin.invoke',
      params: { operation: 'providers.list', input: {} },
    })

    expect(response).toEqual({ jsonrpc: '2.0', id: 3, result: { providers: [] } })
    expect(admin.invoke).toHaveBeenCalledWith('providers.list', {})
  })

  test('keeps the provider opened by profile.connect without opening it again', async () => {
    const open = {
      profile,
      provider: {} as FinancialProvider<OperationMap>,
      persist: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    }
    const providers = {
      connect: vi.fn(async () => ({
        connection: {
          status: 'connected' as const,
          profileId: profile.id,
          providerId: profile.provider,
        },
        open,
      })),
      open: vi.fn(),
    } as unknown as ProviderRegistry
    const socket = state()

    const response = await handleRpc(unusedDb, providers, unusedAdmin, socket, {
      jsonrpc: '2.0',
      id: 4,
      method: 'profile.connect',
      params: { profileId: profile.id },
    })

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: {
        status: 'connected',
        profileId: profile.id,
        providerId: profile.provider,
      },
    })
    expect(providers.open).not.toHaveBeenCalled()
    expect(socket.open).toBe(open)
  })
})
