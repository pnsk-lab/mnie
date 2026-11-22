import { beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { Hono } from 'hono'
import type { AppBindings, AuthContext } from '../context'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import type { AdminRpcService } from './admin'
import type { RpcSocketState } from './handler'
import type { JsonRpcRequest } from './protocol'
import { createRestRpcRoutes } from './rest'

const { handleRpc } = vi.hoisted(() => ({
  handleRpc: vi.fn(
    async (
      _db: Db,
      _providers: ProviderRegistry,
      _admin: AdminRpcService,
      _state: RpcSocketState,
      _request: JsonRpcRequest,
    ) => ({ jsonrpc: '2.0' as const, id: _request.id ?? null, result: { ok: true } }),
  ),
}))
vi.mock('./handler', () => ({
  STATIC_METHODS: ['rpc.methods', 'admin.providers.list', 'portfolio.accounts.list'],
  handleRpc,
  closeOpenProvider: vi.fn(async () => {}),
  usesSessionState: (method: string) =>
    method.startsWith('account.') ||
    method.startsWith('profile.') ||
    [
      'admin.profiles.connect',
      'admin.profiles.connection.complete',
      'admin.profiles.sync',
    ].includes(method),
}))

const config = { origin: 'http://localhost', corsOrigin: 'http://localhost' } as ServerConfig
const db = {} as Db
const providers = {} as ProviderRegistry
const admin = {} as AdminRpcService

const apiKey: AuthContext = {
  type: 'apiKey',
  authenticated: true,
  apiKeyId: 'key-1',
  scopes: ['read'],
}

const createApp = (auth: () => AuthContext, serverConfig: ServerConfig = config) => {
  const app = new Hono<AppBindings>()
  app.use('*', async (c, next) => {
    c.set('config', serverConfig)
    c.set('auth', auth())
    await next()
  })
  app.route('/api/rpc', createRestRpcRoutes(db, providers, admin))
  return app
}

const post = (
  app: ReturnType<typeof createApp>,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
) => app.request(`/api/rpc/${method}`, { method: 'POST', body, headers })

const rpcBody = (method: string, params?: unknown, id: string | number | null = 1) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params })

const rpcErrorBody = (body: unknown) => body as { error: { code: number } }

describe('REST RPC transport', () => {
  beforeEach(() => {
    handleRpc.mockClear()
  })

  test('rejects unauthenticated and cross-origin requests', async () => {
    const app = createApp(() => ({ type: 'none', authenticated: false }))
    expect(
      (await post(app, 'portfolio.accounts.list', rpcBody('portfolio.accounts.list'))).status,
    ).toBe(401)
    const authed = createApp(() => apiKey)
    const wrongOrigin = await post(
      authed,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list'),
      {
        Origin: 'https://untrusted.invalid',
      },
    )
    expect(wrongOrigin.status).toBe(403)
    const allowed = await post(
      authed,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list'),
      {
        Origin: 'http://localhost',
      },
    )
    expect(allowed.status).toBe(200)
  })

  test('accepts same-origin requests regardless of the configured origin', async () => {
    const authed = createApp(() => apiKey)
    const devUi = await post(
      authed,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list'),
      {
        Origin: 'http://localhost:5173',
        'Sec-Fetch-Site': 'same-origin',
      },
    )
    expect(devUi.status).toBe(200)
    const sameHost = createApp(() => apiKey, {
      origin: 'https://example.com',
      corsOrigin: 'https://example.com',
    } as ServerConfig)
    const ownHost = await post(
      sameHost,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list'),
      {
        Origin: 'http://localhost',
      },
    )
    expect(ownHost.status).toBe(200)
  })

  test('rejects same-site and cross-site fetch metadata even for allowed origins', async () => {
    const authed = createApp(() => apiKey)
    for (const site of ['same-site', 'cross-site']) {
      const response = await post(
        authed,
        'portfolio.accounts.list',
        rpcBody('portfolio.accounts.list'),
        {
          Origin: 'http://localhost',
          'Sec-Fetch-Site': site,
        },
      )
      expect(response.status).toBe(403)
    }
  })

  test('rejects unknown methods with a JSON-RPC error and 404', async () => {
    const app = createApp(() => apiKey)
    const response = await post(app, 'not.a.method', rpcBody('not.a.method'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32601, message: 'method not found' },
    })
    expect(handleRpc).not.toHaveBeenCalled()
  })

  test('rejects malformed and non-JSON-RPC bodies', async () => {
    const app = createApp(() => apiKey)
    for (const body of ['{', '']) {
      const response = await post(app, 'portfolio.accounts.list', body)
      expect(response.status).toBe(400)
      expect(rpcErrorBody(await response.json()).error.code).toBe(-32700)
    }
    const invalid = [
      '[1,2]',
      '5',
      'null',
      '"x"',
      '{}',
      '{"jsonrpc":"2.0","id":1}',
      '{"jsonrpc":"1.0","id":1,"method":"portfolio.accounts.list"}',
      '{"jsonrpc":"2.0","id":1,"method":"rpc.methods"}',
    ]
    for (const body of invalid) {
      const response = await post(app, 'portfolio.accounts.list', body)
      expect(response.status).toBe(400)
      expect(rpcErrorBody(await response.json()).error.code).toBe(-32600)
    }
    for (const params of [[1, 2], null, 5, 'x']) {
      const response = await post(
        app,
        'portfolio.accounts.list',
        rpcBody('portfolio.accounts.list', params),
      )
      expect(response.status).toBe(400)
      expect(rpcErrorBody(await response.json()).error.code).toBe(-32602)
    }
    expect(handleRpc).not.toHaveBeenCalled()
  })

  test('dispatches the request through handleRpc and echoes the id', async () => {
    const app = createApp(() => apiKey)
    const response = await post(
      app,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list', {}, 'req-9'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'req-9', result: { ok: true } })
    expect(handleRpc).toHaveBeenCalledWith(
      db,
      providers,
      admin,
      expect.objectContaining({ owner: false, apiKeyId: 'key-1', scopes: ['read'] }),
      { id: 'req-9', method: 'portfolio.accounts.list', params: {} },
    )
    const notification = await post(
      app,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list', {}, null),
    )
    expect(notification.status).toBe(200)
    expect(handleRpc).toHaveBeenLastCalledWith(db, providers, admin, expect.anything(), {
      id: null,
      method: 'portfolio.accounts.list',
      params: {},
    })
  })

  test('serializes session-state calls per principal and refreshes scopes', async () => {
    let auth = apiKey
    const app = createApp(() => auth)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const states: RpcSocketState[] = []
    handleRpc.mockImplementation(async (_db, _providers, _admin, state) => {
      states.push(state)
      await gate
      return { jsonrpc: '2.0' as const, id: null, result: { ok: true } }
    })
    const first = post(app, 'account.balances.list', rpcBody('account.balances.list'))
    for (let i = 0; i < 100 && states.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(states).toHaveLength(1)
    const second = post(app, 'account.balances.list', rpcBody('account.balances.list'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(states).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(states).toHaveLength(2)
    expect(states[0]).toBe(states[1])
    auth = { ...apiKey, scopes: ['read', 'trade'] }
    await post(app, 'portfolio.accounts.list', rpcBody('portfolio.accounts.list'))
    expect(states[0]?.scopes).toEqual(['read', 'trade'])
  })

  test('runs state-free calls without waiting for the principal queue', async () => {
    const app = createApp(() => apiKey)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const states: RpcSocketState[] = []
    handleRpc.mockImplementation(async (_db, _providers, _admin, state, request) => {
      states.push(state)
      if (request.method === 'account.balances.list') await gate
      return { jsonrpc: '2.0' as const, id: request.id ?? null, result: { ok: true } }
    })
    const first = post(app, 'account.balances.list', rpcBody('account.balances.list'))
    for (let i = 0; i < 100 && states.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(states).toHaveLength(1)
    const second = await post(
      app,
      'portfolio.accounts.list',
      rpcBody('portfolio.accounts.list', {}, 'req-2'),
    )
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ jsonrpc: '2.0', id: 'req-2', result: { ok: true } })
    expect(states).toHaveLength(2)
    expect(states[0]).toBe(states[1])
    release()
    await first
  })
})
