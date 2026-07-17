import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import { connectMnie, type MnieWorkspace } from '../../../../packages/client-mnie/src/index'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import { accountProfiles } from '../db/schema'
import type { ProviderRegistry } from '../providers/registry'
import { createApiKey } from '../security/api-keys'

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
  let workspace: MnieWorkspace
  let token: string
  let providers: ProviderRegistry
  let closeRuntime: () => Promise<void>

  beforeAll(async () => {
    ;({ token } = await createApiKey(db, 'integration', { scopes: ['read'] }))
    const runtime = createServerApp(db, config, { backgroundJobs: false })
    providers = runtime.providers
    closeRuntime = runtime.close
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
      websocket: runtime.websocket,
    })
    workspace = await connectMnie({
      baseURL: `http://localhost:${server.port}`,
      token,
      WebSocket,
    })
  })

  afterAll(async () => {
    workspace.close()
    server.stop(true)
    await closeRuntime()
    rmSync(directory, { recursive: true, force: true })
  })

  test('invokes workspace operations through WebSocket', async () => {
    await expect(workspace.invoke('profiles.list', {})).resolves.toEqual([])
    await expect(workspace.invoke('transaction-observations.list', {})).resolves.toEqual([])
  })

  test('does not expose owner admin operations to API keys', async () => {
    const socket = new WebSocket(`ws://localhost:${server.port}/api/ws?key=${token}`)
    const response = await new Promise<{ error?: { message?: string } }>((resolve, reject) => {
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 7,
            method: 'admin.invoke',
            params: { operation: 'profiles.list', input: {} },
          }),
        )
      })
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number
          error?: { message?: string }
        }
        if (message.id === 7) resolve(message)
      })
      socket.addEventListener('error', () => reject(new Error('socket failed')))
    })
    socket.close()
    expect(response.error?.message).toBe('owner session is required')
  })

  test('does not expose removed HTTP application APIs or a duplicate WebSocket route', async () => {
    for (const path of [
      '/api/admin/profiles',
      '/api/assets',
      '/api/history',
      '/api/mcp',
      '/api/api/ws',
      '/mcp',
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
      operations: () => ['accounts.list'],
      checkAvailability: async () => ({ ok: true }),
      invoke: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return { items: [] }
      },
      exportSession: () => ({}),
      close: () => {},
    } as FinancialProvider<OperationMap>
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
      const remote = workspace.profile(profileId)
      await Promise.all([
        remote.invoke('accounts.list', {}),
        remote.invoke('accounts.list', {}),
        remote.invoke('accounts.list', {}),
      ])
      expect(maximumActive).toBe(1)
    } finally {
      providers.open = originalOpen
    }
  })
})
