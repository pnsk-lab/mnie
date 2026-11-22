import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createServerApp } from '../app'
import type { ServerConfig } from '../config'
import { createDb } from '../db'
import {
  sessions,
  accountProfiles,
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
} from '../db/schema'
import {
  createVirtualAccount,
  initializeVirtualAccounts,
  listVirtualAccountAssets,
} from '../virtual-accounts'
import type { ProviderRegistry } from '../providers/registry'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiKey } from '../security/api-keys'

describe('Streamable HTTP MCP', () => {
  const db = createDb(':memory:')
  const config: ServerConfig = {
    port: 0,
    databasePath: ':memory:',
    origin: 'http://localhost',
    corsOrigin: 'http://localhost',
    sessionCookieName: 'mnie_session',
    rpName: 'Mnie test',
    rpId: 'localhost',
  }
  const runtime = createServerApp(db, config, { backgroundJobs: false })
  let server: ReturnType<typeof Bun.serve>
  let baseURL: string
  let token: string

  const connect = async (path = '/api/mcp', authorization = `Bearer ${token}`) => {
    const client = new Client({ name: 'mnie-integration', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(path, baseURL), {
        requestInit: { headers: { Authorization: authorization } },
      }),
    )
    return client
  }

  beforeAll(async () => {
    ;({ token } = await createApiKey(db, 'MCP integration', { scopes: ['read'] }))
    server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => runtime.app.fetch(request, { server: bunServer }),
      websocket: runtime.websocket,
    })
    baseURL = `http://localhost:${server.port}`
  })

  afterAll(async () => {
    server.stop(true)
    await runtime.close()
    db.$client.close()
  })

  test('requires authentication and advertises matching OAuth resource metadata', async () => {
    for (const path of ['/api/mcp', '/mcp']) {
      const response = await fetch(new URL(path, baseURL))
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain(
        new URL(`/.well-known/oauth-protected-resource${path}`, config.origin).href,
      )
      const metadata = await fetch(new URL(`/.well-known/oauth-protected-resource${path}`, baseURL))
      expect(await metadata.json()).toMatchObject({
        resource: new URL(path, config.origin).href,
        scopes_supported: ['read', 'trade', 'reconcile'],
      })
    }
    const invalid = await fetch(new URL('/api/mcp', baseURL), {
      headers: { Authorization: 'Bearer invalid' },
    })
    expect(invalid.status).toBe(401)
  })

  test('MCP SDK initializes, discovers tools, and invokes the shared portfolio on both paths', async () => {
    for (const path of ['/api/mcp', '/mcp']) {
      const client = await connect(path)
      try {
        const { tools } = await client.listTools()
        expect(tools.map((tool) => tool.name)).toContain('mnie-account-invoke')
        expect(tools.map((tool) => tool.name)).toContain('mnie-profile-invoke')
        expect(tools.some((tool) => tool.name.startsWith('mnie-admin-'))).toBe(false)
        const result = await client.callTool({
          name: 'mnie-portfolio-accounts-list',
          arguments: { params: {} },
        })
        expect(result.isError).not.toBe(true)
        expect(result.content).toEqual([{ type: 'text', text: '{"accounts":[]}' }])
        const unavailable = await client.callTool({
          name: 'mnie-account-invoke',
          arguments: { account: 'unbound', method: 'account.balances.list', params: {} },
        })
        expect(unavailable.isError).toBe(true)
        const invalid = await client.callTool({
          name: 'mnie-portfolio-accounts-list',
          arguments: { params: { account: 'missing' } },
        })
        expect(invalid.isError).toBe(true)
      } finally {
        await client.close()
      }
    }
  })

  test('preserves read, reconcile, and owner restrictions', async () => {
    const { token: limitedToken } = await createApiKey(db, 'no read', { scopes: ['trade'] })
    const limited = await connect('/api/mcp', `Bearer ${limitedToken}`)
    const reader = await connect()
    try {
      const denied = await limited.callTool({ name: 'mnie-portfolio-accounts-list', arguments: {} })
      expect(denied.isError).toBe(true)
      expect(denied.content).toEqual([{ type: 'text', text: 'missing OAuth scope: read' }])
      const reconcile = await reader.callTool({
        name: 'mnie-portfolio-ledger-reconciliation-confirm',
        arguments: { params: { proposalId: 'test' } },
      })
      expect(reconcile.isError).toBe(true)
      expect(reconcile.content).toEqual([{ type: 'text', text: 'missing OAuth scope: reconcile' }])
      const admin = await reader.callTool({ name: 'mnie-account-invoke', arguments: {} })
      expect(admin.isError).toBe(true)
    } finally {
      await limited.close()
      await reader.close()
    }
  })

  test('allows owner sessions and rejects cross-origin requests', async () => {
    const sessionId = crypto.randomUUID()
    await db.insert(sessions).values({
      id: sessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    const client = new Client({ name: 'owner', version: '1.0.0' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), {
          requestInit: { headers: { Cookie: `${config.sessionCookieName}=${sessionId}` } },
        }),
      )
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
        'mnie-admin-providers-list',
      )
      const result = await client.callTool({ name: 'mnie-admin-providers-list', arguments: {} })
      expect(result.isError).not.toBe(true)
    } finally {
      await client.close()
    }
    const response = await fetch(new URL('/api/mcp', baseURL), {
      headers: { Origin: 'https://untrusted.invalid', Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(403)
  })
  test('preserves account-bound quotes across MCP HTTP calls and submits once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mnie-mcp-orders-'))
    const previous = {
      backend: process.env.MNIE_KEYRING_BACKEND,
      path: process.env.MNIE_KEYRING_SQLITE_PATH,
      secret: process.env.MNIE_KEYRING_SECRET,
    }
    process.env.MNIE_KEYRING_BACKEND = 'sqlite'
    process.env.MNIE_KEYRING_SQLITE_PATH = join(directory, 'secrets.sqlite')
    process.env.MNIE_KEYRING_SECRET = 'mcp-isolation-test-only'
    const now = new Date()
    await db.insert(accountProfiles).values({
      id: 'mcp-connection',
      provider: 'fixture',
      label: 'test',
      keyringAccount: 'unused',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(financialAccounts).values({
      id: 'mcp-physical',
      profileId: 'mcp-connection',
      providerAccountId: 'private-account',
      connectorTypeId: 'fixture',
      institutionId: 'fixture',
      kind: 'brokerage',
      createdAt: now,
      updatedAt: now,
    })
    await initializeVirtualAccounts(db, 'mcp-physical')
    await db.insert(physicalAccountAssets).values({
      physicalAccountId: 'mcp-physical',
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      amount: '100',
      updatedAt: now,
    })
    const account = await createVirtualAccount(db, {
      physicalAccountId: 'mcp-physical',
      kind: 'agent',
      label: 'MCP Agent',
    })
    await db.insert(virtualAccountAssets).values({
      virtualAccountId: account.id,
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      available: '100',
      reserved: '0',
      pending: '0',
      updatedAt: now,
    })
    const key = await createApiKey(db, 'MCP trading', {
      scopes: ['read', 'trade'],
      accountBindings: [{ accountId: account.id, role: 'trade' }],
    })
    const changes = [
      {
        asset: { kind: 'cash', currency: 'JPY' },
        availableDelta: '-60',
        reservedDelta: '60',
        pendingDelta: '0',
      },
    ]
    let submissions = 0
    const originalOpen = runtime.providers.open.bind(runtime.providers)
    runtime.providers.open = (async () => ({
      profile: { id: 'mcp-connection' },
      provider: {
        accountIsolation: {
          physicalCashIncludesReservations: true,
          stableOrderReferences: true,
          attributableSettlementEffects: true,
          completeOpenOrderSnapshot: true,
        },
        methods: () => [
          'balances.list',
          'investments.orders.open',
          'investments.orders.preview',
          'investments.orders.create',
        ],
        checkMethodAvailability: async () => ({ available: true }),
        invoke: async (method: string, input: Record<string, unknown>) => {
          if (method === 'investments.orders.open') return { items: [], complete: true }
          if (method === 'balances.list')
            return [
              {
                accountId: 'private-account',
                type: 'current',
                amount: { kind: 'money', money: { currency: 'JPY', value: '100' } },
                asOf: new Date().toISOString(),
              },
            ]
          if (method === 'investments.orders.preview')
            return {
              confirmationToken: 'private-broker-token',
              projectedAssetChanges: changes,
              warnings: [],
            }
          submissions++
          expect(input.confirmationToken).toBe('private-broker-token')
          expect(input.account).toBe('private-account')
          expect(input.allowTransaction).toBe(true)
          return {
            id: 'private-broker-order',
            status: 'open',
            effects: { referenceId: 'private-broker-order', changes },
          }
        },
      },
      persist: async () => {},
      release: async () => {},
    })) as unknown as ProviderRegistry['open']
    const client = await connect('/api/mcp', `Bearer ${key.token}`)
    const parse = (result: unknown) => {
      if (!result || typeof result !== 'object' || !('content' in result))
        throw new Error('MCP response has no content')
      if (
        !Array.isArray(result.content) ||
        result.content[0]?.type !== 'text' ||
        typeof result.content[0]?.text !== 'string'
      )
        throw new Error('MCP response has no text')
      if ('isError' in result && result.isError === true) throw new Error(result.content[0].text)
      return JSON.parse(result.content[0].text) as Record<string, unknown>
    }
    try {
      const preview = parse(
        await client.callTool({
          name: 'mnie-account-invoke',
          arguments: {
            account: account.id,
            method: 'account.investments.orders.preview',
            params: {
              instrumentId: '7203',
              instrumentVenue: 'XTKS',
              positionType: 'cash',
              side: 'buy',
              quantity: '1',
              execution: {
                priceType: 'limit',
                venue: 'XTKS',
                limitPrice: { currency: 'JPY', value: '60' },
              },
            },
          },
        }),
      )
      expect(JSON.stringify(preview)).not.toContain('private-broker-token')
      const input = {
        confirmationToken: preview.confirmationToken,
        idempotencyKey: 'mcp-once',
        allowTransaction: true,
      }
      const result = parse(
        await client.callTool({
          name: 'mnie-account-invoke',
          arguments: {
            account: account.id,
            method: 'account.investments.orders.create',
            params: input,
          },
        }),
      )
      expect(result.status).toBe('open')
      expect(JSON.stringify(result)).not.toContain('private-broker-order')
      const repeated = parse(
        await client.callTool({
          name: 'mnie-account-invoke',
          arguments: {
            account: account.id,
            method: 'account.investments.orders.create',
            params: input,
          },
        }),
      )
      expect(repeated.id).toBe(result.id)
      expect(submissions).toBe(1)
      expect((await listVirtualAccountAssets(db, account.id, { owner: true }))[0]).toMatchObject({
        available: '40',
        reserved: '60',
      })
    } finally {
      await client.close()
      runtime.providers.open = originalOpen
      for (const [name, value] of Object.entries({
        MNIE_KEYRING_BACKEND: previous.backend,
        MNIE_KEYRING_SQLITE_PATH: previous.path,
        MNIE_KEYRING_SECRET: previous.secret,
      })) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
