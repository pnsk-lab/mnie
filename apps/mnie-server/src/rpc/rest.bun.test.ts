import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { createApiKey } from '../security/api-keys'
import { STATIC_METHODS } from './handler'

const rpcErrorBody = (body: unknown) => body as { error: { code: number; message: string } }

describe('REST RPC transport', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mnie-rest-'))
  const config: ServerConfig = {
    port: 0,
    databasePath: join(directory, 'test.sqlite'),
    corsOrigin: 'http://localhost',
    sessionCookieName: 'mnie_session',
    rpName: 'Mnie test',
    rpId: 'localhost',
    origin: 'http://localhost',
  }
  const db = createDb(config.databasePath)
  let server: ReturnType<typeof Bun.serve>
  let token: string
  let closeRuntime: () => Promise<void>
  let baseURL: string

  const rpc = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseURL}/api/rpc/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })

  beforeAll(async () => {
    ;({ token } = await createApiKey(db, 'rest-integration', { scopes: ['read'] }))
    const runtime = createServerApp(db, config, { backgroundJobs: false })
    closeRuntime = runtime.close
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
      websocket: runtime.websocket,
    })
    baseURL = `http://localhost:${server.port}`
  })

  afterAll(async () => {
    server.stop(true)
    await closeRuntime()
    rmSync(directory, { recursive: true, force: true })
  })

  test('invokes portfolio methods over HTTP POST', async () => {
    const response = await rpc('portfolio.accounts.list', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { accounts: [] },
    })
  })

  test('invokes dynamic account methods over HTTP POST', async () => {
    const response = await rpc('account.operations', { account: 'missing' })
    expect(response.status).toBe(200)
    const body = rpcErrorBody(await response.json())
    expect(body.error.code).toBe(-32603)
  })

  test('returns a JSON-RPC error envelope for owner-only portfolio methods', async () => {
    const response = await rpc('portfolio.ledger.observations.list', {})
    expect(response.status).toBe(200)
    const body = rpcErrorBody(await response.json())
    expect(body.error.code).toBe(-32603)
    expect(body.error.message).toContain('owner session is required')
  })

  test('does not expose admin methods to API keys', async () => {
    const response = await rpc('admin.providers.list', {})
    expect(response.status).toBe(200)
    const body = rpcErrorBody(await response.json())
    expect(body.error.code).toBe(-32603)
    expect(body.error.message).toContain('owner session is required')
  })

  test('lists RPC methods', async () => {
    const response = await rpc('rpc.methods', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: (STATIC_METHODS as readonly string[]).filter(
        (method) => !method.startsWith('admin.'),
      ),
    })
  })

  test('404s on unknown methods and non-POST requests', async () => {
    const response = await rpc('not.a.method', {})
    expect(response.status).toBe(404)
    expect(rpcErrorBody(await response.json()).error.code).toBe(-32601)
    const get = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(get.status).toBe(404)
  })

  test('rejects unauthenticated requests', async () => {
    const response = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'portfolio.accounts.list' }),
    })
    expect(response.status).toBe(401)
  })

  test('rejects cross-origin requests', async () => {
    const response = await rpc(
      'portfolio.accounts.list',
      {},
      {
        Origin: 'https://untrusted.invalid',
      },
    )
    expect(response.status).toBe(403)
  })

  test('authenticates with the api key query parameter', async () => {
    const response = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list?key=${token}`, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'portfolio.accounts.list',
        params: {},
      }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { accounts: [] },
    })
  })

  test('rejects malformed and non-JSON-RPC bodies', async () => {
    const malformed = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    expect(rpcErrorBody(await malformed.json()).error.code).toBe(-32700)
    const array = await rpc('portfolio.accounts.list', [1, 2])
    expect(array.status).toBe(400)
    expect(rpcErrorBody(await array.json()).error.code).toBe(-32602)
    const mismatch = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'account.operations' }),
    })
    expect(mismatch.status).toBe(400)
    expect(rpcErrorBody(await mismatch.json()).error.code).toBe(-32600)
    const empty = await fetch(`${baseURL}/api/rpc/portfolio.accounts.list`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(empty.status).toBe(400)
    expect(rpcErrorBody(await empty.json()).error.code).toBe(-32700)
  })
})
