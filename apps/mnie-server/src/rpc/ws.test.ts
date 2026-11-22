import { describe, expect, test, vi } from 'vite-plus/test'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import type { AdminRpcService } from './admin'
import { handleRpc, closeOpenProvider, tradeLimitParams, type RpcSocketState } from './handler'

const { dispatch, profileDispatch, close } = vi.hoisted(() => ({
  dispatch: vi.fn(async () => ({ items: [] })),
  profileDispatch: vi.fn(async () => ({ items: [] })),
  close: vi.fn(async () => {}),
}))
vi.mock('../financial-account-service', () => ({
  FinancialAccountService: class {
    dispatch = dispatch
    close = close
  },
}))
vi.mock('../profile-service', () => ({
  ProfileRpcService: class {
    dispatch = profileDispatch
    close = close
  },
}))
vi.mock('./portfolio', () => ({
  PORTFOLIO_METHODS: ['portfolio.accounts.list'],
  invokePortfolio: vi.fn(),
  assertPortfolioScope: vi.fn(),
}))
const db = {} as Db
const providers = {} as ProviderRegistry
const admin = { invoke: vi.fn(async () => ({ ok: true })) } as unknown as AdminRpcService

describe('WebSocket RPC boundaries', () => {
  test('routes account methods through the account service and keeps one service per socket', async () => {
    const state: RpcSocketState = { owner: true }
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'account.balances.list',
      params: { account: 'acct-1' },
    }
    expect(await handleRpc(db, providers, admin, state, request)).toMatchObject({
      result: { items: [] },
    })
    const service = state.service
    await handleRpc(db, providers, admin, state, request)
    expect(state.service).toBe(service)
    expect(dispatch).toHaveBeenCalledWith(request.method, request.params, state)
    await closeOpenProvider(state)
    expect(close).toHaveBeenCalled()
    expect(state.service).toBeUndefined()
  })
  test('routes profile methods through the profile service', async () => {
    const state: RpcSocketState = { owner: true }
    const request = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'profile.balances.list',
      params: { profile: 'prof-1' },
    }
    expect(await handleRpc(db, providers, admin, state, request)).toMatchObject({
      result: { items: [] },
    })
    expect(profileDispatch).toHaveBeenCalledWith(request.method, request.params, state)
    await closeOpenProvider(state)
    expect(state.profileService).toBeUndefined()
  })
  test('routes admin methods through admin.invoke with the prefix stripped', async () => {
    const state: RpcSocketState = { owner: true }
    await handleRpc(db, providers, admin, state, {
      jsonrpc: '2.0' as const,
      id: 3,
      method: 'admin.providers.list',
      params: {},
    })
    expect(admin.invoke).toHaveBeenCalledWith('providers.list', {})
  })
  test('rejects owner methods for API keys before dispatch', async () => {
    await expect(
      handleRpc(
        db,
        providers,
        admin,
        { owner: false, apiKeyId: 'key', scopes: ['read'] },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'admin.accounts.create',
          params: {},
        },
      ),
    ).rejects.toThrow('owner session is required')
  })
  test('rejects account reads without read scope', async () => {
    await expect(
      handleRpc(
        db,
        providers,
        admin,
        { owner: false, apiKeyId: 'key', scopes: ['trade'] },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'account.balances.list',
          params: { account: 'acct' },
        },
      ),
    ).rejects.toThrow('missing OAuth scope: read')
  })
  test('returns method not found for unknown methods', async () => {
    expect(
      await handleRpc(
        db,
        providers,
        admin,
        { owner: true },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'nope.unknown',
          params: {},
        },
      ),
    ).toMatchObject({ error: { code: -32601 } })
  })
  test('uses the provider confirmation amount instead of a caller supplied amount', () => {
    expect(
      tradeLimitParams(
        { amount: { currency: 'JPY', value: '1' } },
        { currency: 'JPY', value: '1000' },
      ),
    ).toEqual({ amount: { currency: 'JPY', value: '1000' } })
  })
})
