import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FinancialProvider, MethodMap } from '@mnie/types'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { accountProfiles, financialAccounts } from '../db/schema'
import type { ProviderRegistry } from '../providers/registry'
import { createApiKey } from '../security/api-keys'
import {
  bindApiKeyToVirtualAccount,
  createVirtualAccount,
  initializeVirtualAccounts,
} from '../virtual-accounts'

describe('WebSocket RPC boundaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mnie-ws-'))
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
  let apiKeyId: string
  let providers: ProviderRegistry
  let closeRuntime: () => Promise<void>

  const connect = () =>
    new Promise<{ socket: WebSocket; greeting: { methods: string[] } }>((resolve, reject) => {
      const socket = new WebSocket(`ws://localhost:${server.port}/api/ws?key=${token}`)
      socket.addEventListener(
        'message',
        (event) => {
          try {
            const greeting = JSON.parse(String(event.data)).result as {
              connected: boolean
              methods: string[]
            }
            resolve({ socket, greeting })
          } catch (cause) {
            reject(cause)
          }
        },
        { once: true },
      )
      socket.addEventListener('error', () => reject(new Error('socket failed')))
    })

  const call = (socket: WebSocket, id: number, method: string, params: Record<string, unknown>) =>
    new Promise<{ result?: unknown; error?: { message?: string } }>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number
          result?: unknown
          error?: { message?: string }
        }
        if (message.id === id) {
          socket.removeEventListener('message', onMessage)
          resolve(message)
        }
      }
      socket.addEventListener('message', onMessage)
      socket.addEventListener('error', () => reject(new Error('socket failed')), { once: true })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })

  beforeAll(async () => {
    ;({ token, id: apiKeyId } = await createApiKey(db, 'integration', { scopes: ['read'] }))
    const runtime = createServerApp(db, config, { backgroundJobs: false })
    providers = runtime.providers
    closeRuntime = runtime.close
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
      websocket: runtime.websocket,
    })
  })

  afterAll(async () => {
    server.stop(true)
    await closeRuntime()
    rmSync(directory, { recursive: true, force: true })
  })

  test('greets with the caller-visible method list and serves portfolio reads', async () => {
    const { socket, greeting } = await connect()
    try {
      expect(greeting.methods).toContain('rpc.methods')
      expect(greeting.methods).toContain('portfolio.accounts.list')
      expect(greeting.methods.some((method) => method.startsWith('admin.'))).toBe(false)
      expect(await call(socket, 1, 'rpc.methods', {})).toMatchObject({ result: greeting.methods })
      await expect(call(socket, 2, 'portfolio.accounts.list', {})).resolves.toMatchObject({
        result: { accounts: [] },
      })
      const forbidden = await call(socket, 3, 'portfolio.ledger.observations.list', {})
      expect(forbidden.error?.message).toBe('owner session is required')
    } finally {
      socket.close()
    }
  })

  test('does not expose owner admin methods to API keys', async () => {
    const { socket } = await connect()
    try {
      const response = await call(socket, 7, 'admin.providers.list', {})
      expect(response.error?.message).toBe('owner session is required')
    } finally {
      socket.close()
    }
  })
  test('exposes and authorizes only explicitly granted admin methods to an API key', async () => {
    const previousToken = token
    const key = await createApiKey(db, 'limited admin', {
      scopes: ['read'],
      allowedMethods: ['admin.providers.list'],
    })
    token = key.token
    const { socket, greeting } = await connect()
    try {
      expect(greeting.methods).toContain('admin.providers.list')
      expect(greeting.methods).not.toContain('admin.apiKeys.create')
      expect(await call(socket, 41, 'rpc.methods', {})).toMatchObject({ result: greeting.methods })
      const allowed = await call(socket, 42, 'admin.providers.list', {})
      expect(allowed.error).toBeUndefined()
      expect((allowed.result as { providers: unknown[] }).providers.length).toBeGreaterThan(0)
      const denied = await call(socket, 43, 'admin.apiKeys.create', { label: 'forbidden' })
      expect(denied.error?.message).toBe('owner session is required')
    } finally {
      socket.close()
      token = previousToken
    }
  })

  test('does not expose removed HTTP application APIs or a duplicate WebSocket route', async () => {
    for (const path of [
      '/api/admin/profiles',
      '/api/assets',
      '/api/history',
      '/api/api/ws',
      '/health',
      '/ws',
      '/auth/status',
    ]) {
      const response = await fetch(`http://localhost:${server.port}${path}`)
      expect(response.status).toBe(404)
    }
    const auth = await fetch(`http://localhost:${server.port}/api/auth/status`)
    expect(auth.status).toBe(200)
  })

  test('serializes concurrent profile invocations on one provider session', async () => {
    const profileId = 'concurrency-profile'
    const now = new Date()
    await db.insert(accountProfiles).values({
      id: profileId,
      provider: 'test-provider',
      label: 'Concurrency test',
      keyringAccount: 'unused',
      createdAt: now,
      updatedAt: now,
    })
    let active = 0
    let maximumActive = 0
    const provider = {
      descriptor: { id: 'test-provider', name: 'Test provider' },
      accountId: 'test-account',
      capabilities: () => ['accounts:read'],
      methods: () => ['accounts.list', 'balances.list', 'market.issue.search'],
      checkAvailability: async () => ({ ok: true }),
      invoke: async (method: string) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return method === 'balances.list'
          ? [
              {
                accountId: 'test-account',
                type: 'current',
                amount: { kind: 'money', money: { currency: 'JPY', value: '1000' } },
                asOf: new Date(0).toISOString(),
              },
            ]
          : { items: [] }
      },
      exportSession: () => ({}),
      close: () => {},
    } as FinancialProvider<MethodMap>
    const originalOpen = providers.open.bind(providers)
    providers.open = async (profileOrId, options) => {
      const profile =
        typeof profileOrId === 'string' ? await providers.profile(profileOrId) : profileOrId
      if (profile.id !== profileId) return originalOpen(profile, options)
      return {
        profile,
        provider,
        persist: async () => {},
        release: async () => {},
      }
    }
    try {
      const physicalAccountId = 'concurrency-physical-account'
      await db.insert(financialAccounts).values({
        id: physicalAccountId,
        profileId,
        connectorTypeId: 'test-provider',
        institutionId: 'test-provider',
        providerAccountId: 'test-account',
        kind: 'brokerage',
        createdAt: now,
        updatedAt: now,
      })
      await initializeVirtualAccounts(db, physicalAccountId)
      const { id: accountId } = await createVirtualAccount(db, {
        physicalAccountId,
        label: 'Concurrency account',
        kind: 'agent',
      })
      await bindApiKeyToVirtualAccount(db, apiKeyId, accountId, 'read')
      const { socket } = await connect()
      try {
        const results = await Promise.all([
          call(socket, 11, 'account.market.issue.search', { account: accountId, query: 'test' }),
          call(socket, 12, 'account.market.issue.search', { account: accountId, query: 'test' }),
          call(socket, 13, 'account.market.issue.search', { account: accountId, query: 'test' }),
        ])
        for (const result of results) expect(result.error).toBeUndefined()
        expect(maximumActive).toBe(1)
      } finally {
        socket.close()
      }
    } finally {
      providers.open = originalOpen
    }
  })
})
