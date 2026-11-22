import { afterEach, expect, test, vi } from 'vite-plus/test'
import { connectMnie } from './index'

afterEach(() => {
  vi.unstubAllGlobals()
})

class OpeningWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  send(raw: string) {
    const request = JSON.parse(raw) as { id: string; method: string }
    if (request.method !== 'rpc.methods') {
      throw new Error(`unexpected method: ${request.method}`)
    }
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: [
              'rpc.methods',
              'portfolio.accounts.list',
              'portfolio.valuation.get',
              'portfolio.history.list',
            ],
          }),
        }),
      ),
    )
  }
}

test('remote client advertises rpc.methods', async () => {
  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    WebSocket: OpeningWebSocket as unknown as typeof WebSocket,
  })

  expect(await client.methods()).toEqual([
    'rpc.methods',
    'portfolio.accounts.list',
    'portfolio.valuation.get',
    'portfolio.history.list',
  ])
  client.close()
})

class InteractiveWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  send(raw: string) {
    const request = JSON.parse(raw) as {
      id: string
      method: string
      params?: { profileId?: string; interactionId?: string }
    }
    const result =
      request.method === 'rpc.methods'
        ? ['rpc.methods']
        : request.method === 'admin.profiles.connect'
          ? {
              status: 'interaction-required',
              profileId: request.params?.profileId,
              providerId: 'smbc-direct',
              interaction: { id: 'interaction-1', kind: 'qr', qrUrl: 'https://example.com/qr' },
            }
          : request.method === 'admin.profiles.connection.complete'
            ? {
                status: 'connected',
                profileId: request.params?.profileId,
                providerId: 'smbc-direct',
              }
            : undefined
    if (!result) throw new Error(`unexpected method: ${request.method}`)
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        }),
      ),
    )
  }
}

test('remote client completes interactive profile authentication over WebSocket', async () => {
  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    WebSocket: InteractiveWebSocket as unknown as typeof WebSocket,
  })

  const pending = await client.connectProfile('profile-1')
  expect(pending.status).toBe('interaction-required')
  expect(pending.interaction?.kind).toBe('qr')
  await expect(
    client.completeProfileConnection('profile-1', pending.interaction!.id),
  ).resolves.toMatchObject({ status: 'connected', profileId: 'profile-1' })
  client.close()
})

const rpcJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const rpcResult = (result: unknown) => rpcJsonResponse({ jsonrpc: '2.0', id: null, result })

test('rest transport POSTs JSON-RPC calls to /api/rpc', async () => {
  const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
    rpcResult(['rpc.methods', 'portfolio.accounts.list']),
  )
  vi.stubGlobal('fetch', fetchMock)

  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    transport: 'rest',
  })

  expect(await client.methods()).toEqual(['rpc.methods', 'portfolio.accounts.list'])
  const [input, init] = fetchMock.mock.calls.at(-1)!
  expect(String(input)).toBe('https://example.com/api/rpc/rpc.methods')
  expect(init?.method).toBe('POST')
  expect(init?.headers).toMatchObject({
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
  })
  expect(JSON.parse(String(init?.body))).toEqual({
    jsonrpc: '2.0',
    id: '2',
    method: 'rpc.methods',
    params: {},
  })
  client.close()
})

test('account proxy invokes account.<method> with the account selector', async () => {
  const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/rpc/rpc.methods')) return rpcResult(['rpc.methods'])
    if (url.endsWith('/api/rpc/account.operations')) return rpcResult(['account.balances.list'])
    if (url.endsWith('/api/rpc/account.capabilities')) return rpcResult(['balances:read'])
    if (url.endsWith('/api/rpc/account.availability')) {
      return rpcResult({
        connection: { ok: true },
        methods: { 'account.balances.list': { available: true } },
        checkedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    if (url.endsWith('/api/rpc/account.balances.list')) {
      return rpcResult([{ account: 'acct-1' }])
    }
    throw new Error(`unexpected url: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    transport: 'rest',
  })

  const account = client.account('acct-1')
  expect(await account.methods()).toEqual(['balances.list'])
  expect(await account.capabilities()).toEqual(['balances:read'])
  expect(await account.checkAvailability()).toEqual({ ok: true })
  expect(
    await account.checkMethodAvailability!({
      method: 'balances.list',
      params: {},
    }),
  ).toEqual({ available: true })

  const invokeResult = await account.invoke('balances.list', {})
  expect(invokeResult).toEqual([{ account: 'acct-1' }])
  const [input, init] = fetchMock.mock.calls.at(-1)!
  expect(String(input)).toBe('https://example.com/api/rpc/account.balances.list')
  expect(JSON.parse(String(init?.body))).toEqual({
    jsonrpc: '2.0',
    id: expect.any(String),
    method: 'account.balances.list',
    params: { account: 'acct-1' },
  })
  expect(() => account.exportSession()).toThrow('remote sessions cannot be exported')
  client.close()
})

test('rest transport sends call params as a JSON-RPC request body', async () => {
  const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/rpc/rpc.methods')) return rpcResult(['rpc.methods'])
    if (url.endsWith('/api/rpc/admin.profiles.connect')) {
      return rpcResult({ status: 'connected', profileId: 'profile-1', providerId: 'smbc-direct' })
    }
    if (url.endsWith('/api/rpc/portfolio.accounts.get')) {
      return rpcResult({ account: { id: 'acct-1' } })
    }
    throw new Error(`unexpected url: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    transport: 'rest',
  })

  const connection = await client.connectProfile('profile-1')
  expect(connection.status).toBe('connected')
  let [input, init] = fetchMock.mock.calls.at(-1)!
  expect(String(input)).toBe('https://example.com/api/rpc/admin.profiles.connect')
  expect(JSON.parse(String(init?.body))).toEqual({
    jsonrpc: '2.0',
    id: '2',
    method: 'admin.profiles.connect',
    params: { profileId: 'profile-1' },
  })

  await client.call('portfolio.accounts.get', { account: 'acct-1' })
  ;[input, init] = fetchMock.mock.calls.at(-1)!
  expect(String(input)).toBe('https://example.com/api/rpc/portfolio.accounts.get')
  expect(JSON.parse(String(init?.body))).toEqual({
    jsonrpc: '2.0',
    id: '3',
    method: 'portfolio.accounts.get',
    params: { account: 'acct-1' },
  })
  client.close()
})

test('rest transport rejects calls with MnieRpcError for error envelopes', async () => {
  let calls = 0
  const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => {
    calls += 1
    return calls === 1
      ? rpcResult(['rpc.methods'])
      : rpcJsonResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32602, message: 'invalid params' },
        })
  })
  vi.stubGlobal('fetch', fetchMock)

  const client = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    transport: 'rest',
  })

  await expect(client.call('portfolio.accounts.list', {})).rejects.toMatchObject({
    name: 'MnieRpcError',
    code: -32602,
    message: 'invalid params',
  })
  client.close()
})

test('rest transport surfaces transport-level HTTP failures', async () => {
  const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
    rpcJsonResponse({ error: 'unauthorized' }, 401),
  )
  vi.stubGlobal('fetch', fetchMock)

  await expect(
    connectMnie({ baseURL: 'https://example.com', token: 'bad-token', transport: 'rest' }),
  ).rejects.toMatchObject({ name: 'MnieRpcError', code: -32000, message: 'unauthorized' })
})

test('rest transport rejects non-RPC payloads', async () => {
  const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
    rpcJsonResponse({ status: 'ok' }),
  )
  vi.stubGlobal('fetch', fetchMock)

  await expect(
    connectMnie({ baseURL: 'https://example.com', token: 'test-token', transport: 'rest' }),
  ).rejects.toThrow('invalid Mnie RPC response')
})
