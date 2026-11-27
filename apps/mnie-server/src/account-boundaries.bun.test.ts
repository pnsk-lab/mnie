import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from './db'
import {
  accountProfiles,
  financialAccounts,
  virtualAccountAssets,
  virtualOrders,
  virtualOrderQuotes,
  physicalAccountAssets,
  apiKeyTradeUsage,
  virtualAccounts,
} from './db/schema'
import {
  createVirtualAccount,
  initializeVirtualAccounts,
  listVirtualAccountAssets,
  bindApiKeyToVirtualAccount,
  updateVirtualAccount,
  transferVirtualAssets,
} from './virtual-accounts'
import {
  createCoordinatedOrder,
  changeCoordinatedOrder,
  reconcileVirtualOrder,
  storeOrderQuote,
} from './order-coordinator'
import { accountHistory, accountOverview, accountValuation } from './account-read-model'
import { createApiKey, revokeApiKey } from './security/api-keys'
import { FinancialAccountService } from './financial-account-service'
import type { ProviderRegistry } from './providers/registry'

const directory = mkdtempSync(join(tmpdir(), 'mnie-account-'))
process.env.MNIE_KEYRING_BACKEND = 'sqlite'
process.env.MNIE_KEYRING_SQLITE_PATH = join(directory, 'keyring.sqlite')
process.env.MNIE_KEYRING_SECRET = 'account-boundary-test-only'
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const owner = { owner: true }
const changes = [
  {
    asset: { kind: 'cash' as const, currency: 'JPY' },
    availableDelta: '-60',
    reservedDelta: '60',
    pendingDelta: '0',
  },
]
const request = {
  instrumentId: '7203',
  side: 'buy',
  quantity: '1',
  positionType: 'cash',
  instrumentVenue: 'TSE',
}
const setup = async () => {
  const db = createDb(':memory:')
  const now = new Date()
  await db.insert(accountProfiles).values({
    id: 'connection',
    provider: 'test',
    label: 'test',
    keyringAccount: 'unused',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(financialAccounts).values({
    id: 'physical',
    profileId: 'connection',
    connectorTypeId: 'test',
    institutionId: 'test',
    providerAccountId: 'secret-physical-id',
    kind: 'brokerage',
    createdAt: now,
    updatedAt: now,
  })
  await initializeVirtualAccounts(db, 'physical')
  await db.insert(physicalAccountAssets).values({
    physicalAccountId: 'physical',
    assetKey: 'cash:JPY',
    assetKind: 'cash',
    amount: '200',
    updatedAt: now,
  })
  const a = await createVirtualAccount(db, {
    physicalAccountId: 'physical',
    label: 'A',
    kind: 'personal',
  })
  const b = await createVirtualAccount(db, {
    physicalAccountId: 'physical',
    label: 'B',
    kind: 'agent',
  })
  for (const account of [a, b])
    await db.insert(virtualAccountAssets).values({
      virtualAccountId: account.id,
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      available: '100',
      reserved: '0',
      pending: '0',
      updatedAt: now,
    })
  return { db, a, b }
}
const quote = (db: ReturnType<typeof createDb>, accountId: string, access = owner) =>
  storeOrderQuote(db, accountId, access, 'investments.orders.preview', request, {
    confirmationToken: 'secret-provider-token',
    projectedAssetChanges: changes,
    warnings: [],
  })
const submitInput = (preview: Record<string, unknown>, idempotencyKey = 'request-1') => ({
  ...request,
  confirmationToken: preview.confirmationToken,
  idempotencyKey,
  allowTransaction: true,
})

describe('public account isolation and durable orders', () => {
  test('hides unbound assets from all portfolio and history read models', async () => {
    const { db, a, b } = await setup()
    const key = await createApiKey(db, 'agent', { scopes: ['read'] })
    await bindApiKeyToVirtualAccount(db, key.id, a.id, 'read')
    const access = { owner: false, apiKeyId: key.id }
    const overview = await accountOverview(db, access, {})
    expect(overview.components.map((item) => item.profile.id)).toEqual([a.id])
    expect((await accountValuation(db, access, {})).total.value).toBe('100')
    await expect(accountHistory(db, access, { account: b.id })).rejects.toThrow('account not found')
    await expect(accountOverview(db, access, { accounts: [b.id] })).rejects.toThrow(
      'account not found',
    )
    await revokeApiKey(db, key.id)
    expect((await accountOverview(db, access, {})).components).toEqual([])
  })
  test('encrypts provider tokens and rejects quote replay across accounts', async () => {
    const { db, a, b } = await setup()
    const preview = await quote(db, a.id)
    expect(JSON.stringify(preview)).not.toContain('secret-provider-token')
    expect(JSON.stringify(await db.select().from(virtualOrderQuotes))).not.toContain(
      'secret-provider-token',
    )
    await expect(
      createCoordinatedOrder(db, b.id, owner, submitInput(preview), async () => {
        throw new Error('must not execute')
      }),
    ).rejects.toThrow('quote is invalid')
  })
  test('keeps reservations after submit timeout and never resubmits an idempotency key', async () => {
    const { db, a } = await setup()
    const input = submitInput(await quote(db, a.id))
    let calls = 0
    const execute = async () => {
      calls++
      throw new Error('timeout after broker accepted')
    }
    const first = await createCoordinatedOrder(db, a.id, owner, input, execute)
    expect(first.status).toBe('submission_unknown')
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]).toMatchObject({
      available: '40',
      reserved: '60',
    })
    expect(await createCoordinatedOrder(db, a.id, owner, input, execute)).toEqual(first)
    expect(calls).toBe(1)
  })
  test('prevents concurrent orders from spending the same cash', async () => {
    const { db, a } = await setup()
    const p1 = await quote(db, a.id),
      p2 = await quote(db, a.id)
    let calls = 0
    const execute = async () => {
      calls++
      return {
        id: `broker-${calls}`,
        status: 'open',
        effects: { referenceId: `broker-${calls}`, changes },
      }
    }
    const results = await Promise.allSettled([
      createCoordinatedOrder(db, a.id, owner, submitInput(p1, 'one'), execute),
      createCoordinatedOrder(db, a.id, owner, submitInput(p2, 'two'), execute),
    ])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(calls).toBe(1)
  })
  test('invalidates a preview after a freeze or access revocation', async () => {
    const { db, a } = await setup()
    const preview = await quote(db, a.id)
    await updateVirtualAccount(db, a.id, { expectedVersion: a.version, status: 'frozen' })
    await expect(
      createCoordinatedOrder(db, a.id, owner, submitInput(preview), async () => ({})),
    ).rejects.toThrow('quote is invalid')
  })
  test('confirmed broker cancellation releases only an identified order reservation', async () => {
    const { db, a } = await setup()
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      submitInput(await quote(db, a.id)),
      async () => ({
        id: 'broker-order',
        status: 'open',
        effects: { referenceId: 'broker-order', changes },
      }),
    )
    reconcileVirtualOrder(db, order.id, {
      id: 'broker-order',
      status: 'cancelled',
      executedQuantity: '0',
    })
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]).toMatchObject({
      available: '100',
      reserved: '0',
    })
    reconcileVirtualOrder(db, order.id, {
      id: 'broker-order',
      status: 'cancelled',
      executedQuantity: '0',
    })
    expect((await db.select().from(virtualOrders))[0]?.state).toBe('cancelled')
  })
  test('RPC account reads never expose raw provider positions or orders', async () => {
    const { db, a } = await setup()
    const gateway = {
      open: async () => ({
        profile: { id: 'connection' },
        provider: {
          methods: () => [
            'accounts.list',
            'investments.orders.list',
            'market.issue.chart',
            'private.history',
          ],
          invoke: async () => {
            throw new Error('raw read must not execute')
          },
        },
        persist: async () => {},
        release: async () => {},
      }),
    } as unknown as ProviderRegistry
    const service = new FinancialAccountService(db, gateway)
    const keyEligible = (await service.dispatch(
      'account.operations',
      { account: a.id, forApiKey: true },
      owner,
    )) as string[]
    expect(keyEligible).toContain('account.market.issue.chart')
    expect(keyEligible).not.toContain('account.private.history')
    expect(await service.dispatch('account.operations', { account: a.id }, owner)).toContain(
      'account.private.history',
    )
    const result = await service.dispatch('account.accounts.list', { account: a.id }, owner)
    expect(JSON.stringify(result)).not.toContain('secret-physical-id')
    expect(
      await service.dispatch('account.investments.orders.list', { account: a.id }, owner),
    ).toEqual({ items: [] })
    await expect(
      service.dispatch(
        'account.investments.orders.list',
        {
          account: a.id,
          accountId: 'secret-physical-id',
        },
        owner,
      ),
    ).rejects.toThrow('raw account IDs')
    await service.close()
  })
  test('dynamic account RPC methods are isolated per account', async () => {
    const { db, a, b } = await setup()
    const key = await createApiKey(db, 'scoped', {
      scopes: ['read'],
      accountBindings: [
        {
          accountId: a.id,
          role: 'read',
          allowedMethods: ['account.operations', 'account.accounts.list'],
        },
        {
          accountId: b.id,
          role: 'read',
          allowedMethods: ['account.operations', 'account.investments.orders.list'],
        },
      ],
    })
    const gateway = {
      open: async () => ({
        profile: { id: 'connection' },
        provider: { methods: () => ['accounts.list', 'investments.orders.list'] },
        persist: async () => {},
        release: async () => {},
      }),
    } as unknown as ProviderRegistry
    const service = new FinancialAccountService(db, gateway)
    const access = { owner: false, apiKeyId: key.id, scopes: ['read'] }
    expect(await service.dispatch('account.operations', { account: a.id }, access)).toEqual([
      'account.accounts.list',
    ])
    expect(await service.dispatch('account.operations', { account: b.id }, access)).toEqual([
      'account.investments.orders.list',
    ])
    await expect(
      service.dispatch('account.investments.orders.list', { account: a.id }, access),
    ).rejects.toThrow('account method not found')
    expect(
      await service.dispatch('account.investments.orders.list', { account: b.id }, access),
    ).toEqual({ items: [] })
    const hidden = await createApiKey(db, 'no discovery', {
      scopes: ['read'],
      accountBindings: [
        { accountId: a.id, role: 'read', allowedMethods: ['account.accounts.list'] },
      ],
    })
    await expect(
      service.dispatch(
        'account.operations',
        { account: a.id },
        { owner: false, apiKeyId: hidden.id, scopes: ['read'] },
      ),
    ).rejects.toThrow('account method not found')
    await service.close()
  })
  test('rolls back every asset in a batch when one transfer conflicts', async () => {
    const { db, a, b } = await setup()
    expect(() =>
      transferVirtualAssets(db, [
        {
          fromAccountId: a.id,
          toAccountId: b.id,
          assetKey: 'cash:JPY',
          amount: '10',
          expectedFromVersion: 1,
          expectedToVersion: 1,
          reason: 'test',
        },
        {
          fromAccountId: a.id,
          toAccountId: b.id,
          assetKey: 'cash:USD',
          amount: '1',
          expectedFromVersion: 1,
          expectedToVersion: 0,
          reason: 'test',
        },
      ]),
    ).toThrow('source asset allocation not found')
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]?.available).toBe('100')
    expect((await listVirtualAccountAssets(db, b.id, owner))[0]?.available).toBe('100')
  })
  test('applies partial-fill effects exactly once without affecting another account', async () => {
    const { db, a, b } = await setup()
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      submitInput(await quote(db, a.id)),
      async () => ({
        id: 'broker-partial',
        status: 'open',
        effects: { referenceId: 'broker-partial', changes },
      }),
    )
    const fill = {
      id: 'broker-partial',
      status: 'open',
      executedQuantity: '0.5',
      effects: {
        referenceId: 'broker-partial',
        changes: [
          {
            asset: { kind: 'cash' as const, currency: 'JPY' },
            availableDelta: '-60',
            reservedDelta: '30',
            pendingDelta: '0',
          },
          {
            asset: {
              kind: 'security' as const,
              instrumentId: '7203',
              venue: 'TSE',
              positionType: 'cash' as const,
            },
            availableDelta: '0.5',
            reservedDelta: '0',
            pendingDelta: '0',
          },
        ],
      },
    }
    reconcileVirtualOrder(db, order.id, fill)
    reconcileVirtualOrder(db, order.id, fill)
    expect(
      (await listVirtualAccountAssets(db, a.id, owner)).find(
        (asset) => asset.assetKey === 'cash:JPY',
      ),
    ).toMatchObject({ available: '40', reserved: '30' })
    expect((await listVirtualAccountAssets(db, b.id, owner))[0]?.available).toBe('100')
  })
  test('a restart preserves ambiguous orders and their reservations', async () => {
    const { db, a } = await setup()
    const preview = await quote(db, a.id)
    const order = await createCoordinatedOrder(db, a.id, owner, submitInput(preview), async () => {
      throw new Error('connection lost')
    })
    const path = join(directory, 'restart.sqlite')
    await Bun.write(path, db.$client.serialize())
    const restarted = createDb(path)
    expect(restarted.select().from(virtualOrders).get()?.state).toBe('submission_unknown')
    expect((await listVirtualAccountAssets(restarted, a.id, owner))[0]?.reserved).toBe('60')
    expect(order.status).toBe('submission_unknown')
    restarted.$client.close()
  })
  test('failed initial allocation leaves no new account or partial transfer', async () => {
    const { db, a } = await setup()
    const before = db.select().from(virtualAccounts).all().length
    await expect(
      createVirtualAccount(db, {
        physicalAccountId: 'physical',
        label: 'Unfunded',
        kind: 'agent',
        allocations: [
          {
            fromAccountId: a.id,
            assetKey: 'cash:JPY',
            amount: '101',
            expectedFromVersion: 1,
            reason: 'test',
          },
        ],
      }),
    ).rejects.toThrow('insufficient available asset')
    expect(db.select().from(virtualAccounts).all()).toHaveLength(before)
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]?.available).toBe('100')
  })
  test('an idempotent retry does not submit twice without time quotas', async () => {
    const { db, a } = await setup()
    const key = await createApiKey(db, 'trader', {
      scopes: ['read', 'trade'],
      accountBindings: [{ accountId: a.id, role: 'trade' }],
    })
    const access = { owner: false, apiKeyId: key.id }
    const preview = await storeOrderQuote(db, a.id, access, 'investments.orders.preview', request, {
      confirmationToken: 'private-token',
      projectedAssetChanges: changes,
    })
    const input = submitInput(preview)
    let calls = 0
    const execute = async () => {
      calls++
      return {
        id: 'broker-quota',
        status: 'open',
        effects: { referenceId: 'broker-quota', changes },
      }
    }
    await createCoordinatedOrder(db, a.id, access, input, execute)
    await createCoordinatedOrder(db, a.id, access, input, execute)
    expect(calls).toBe(1)
    expect(db.select().from(apiKeyTradeUsage).get()).toBeUndefined()
  })
  test('a provider without a complete account-isolation contract cannot trade', async () => {
    const { db, a } = await setup()
    let invoked = false
    const registry = {
      open: async () => ({
        profile: { id: 'connection' },
        provider: {
          methods: () => ['investments.orders.preview'],
          invoke: async () => {
            invoked = true
            return {}
          },
        },
        persist: async () => {},
        release: async () => {},
      }),
    } as unknown as ProviderRegistry
    const service = new FinancialAccountService(db, registry)
    const result = (await service.dispatch(
      'account.availability',
      { account: a.id, method: 'account.investments.orders.preview', params: request },
      owner,
    )) as { methods: Record<string, { available: boolean }> }
    expect(result.methods['account.investments.orders.preview']?.available).toBe(false)
    await expect(
      service.dispatch('account.investments.orders.preview', { account: a.id, ...request }, owner),
    ).rejects.toThrow('provider cannot guarantee')
    expect(invoked).toBe(false)
    await service.close()
  })
  test('a cancelled order without execution evidence keeps its reservation', async () => {
    const { db, a } = await setup()
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      submitInput(await quote(db, a.id)),
      async () => ({
        id: 'broker-no-evidence',
        status: 'open',
        effects: { referenceId: 'broker-no-evidence', changes },
      }),
    )
    reconcileVirtualOrder(db, order.id, { id: 'broker-no-evidence', status: 'cancelled' })
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]?.reserved).toBe('60')
    expect(db.select().from(virtualOrders).get()?.state).toBe('reconciliation_required')
  })

  test('a rejected replacement preserves the original order and reservation', async () => {
    const { db, a } = await setup()
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      submitInput(await quote(db, a.id)),
      async () => ({
        id: 'broker-replace',
        status: 'open',
        effects: { referenceId: 'broker-replace', changes },
      }),
    )
    const replacement = {
      orderId: order.id,
      quantity: '2',
      limitPrice: { currency: 'JPY', value: '45' },
    }
    const newChanges = [{ ...changes[0]!, availableDelta: '-90', reservedDelta: '90' }]
    const preview = await storeOrderQuote(
      db,
      a.id,
      owner,
      'investments.orders.replace.preview',
      replacement,
      { confirmationToken: 'replace-private', projectedAssetChanges: newChanges },
    )
    const response = await changeCoordinatedOrder(
      db,
      a.id,
      owner,
      'replace',
      {
        ...replacement,
        confirmationToken: preview.confirmationToken,
        idempotencyKey: 'replacement-1',
        allowTransaction: true,
      },
      async (input) => {
        expect(input.allowTransaction).toBe(true)
        expect(input.orderId).toBe('broker-replace')
        expect((await listVirtualAccountAssets(db, a.id, owner))[0]).toMatchObject({
          available: '10',
          reserved: '90',
        })
        return { id: 'broker-replace', status: 'rejected' }
      },
    )
    expect(response.status).toBe('open')
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]).toMatchObject({
      available: '40',
      reserved: '60',
    })
  })
  test('a cancellation receipt does not release cash until broker state is confirmed', async () => {
    const { db, a } = await setup()
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      submitInput(await quote(db, a.id)),
      async () => ({
        id: 'broker-cancel-pending',
        status: 'open',
        effects: { referenceId: 'broker-cancel-pending', changes },
      }),
    )
    const response = await changeCoordinatedOrder(
      db,
      a.id,
      owner,
      'cancel',
      { orderId: order.id, idempotencyKey: 'cancel-1', allowTransaction: true },
      async () => ({ id: 'broker-cancel-pending', status: 'cancelled' }),
    )
    expect(response.status).toBe('cancel_pending')
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]?.reserved).toBe('60')
    reconcileVirtualOrder(db, order.id, {
      id: 'broker-cancel-pending',
      status: 'cancelled',
      executedQuantity: '0',
    })
    expect((await listVirtualAccountAssets(db, a.id, owner))[0]?.reserved).toBe('0')
    expect(
      db
        .select()
        .from(virtualOrders)
        .all()
        .every((row) => ['cancelled', 'filled'].includes(row.state)),
    ).toBe(true)
  })
  test('one broker order cannot be attributed to two virtual accounts', async () => {
    const { db, a, b } = await setup()
    const execute = async () => ({
      id: 'same-broker-order',
      status: 'open',
      effects: { referenceId: 'same-broker-order', changes },
    })
    await createCoordinatedOrder(db, a.id, owner, submitInput(await quote(db, a.id)), execute)
    const second = await createCoordinatedOrder(
      db,
      b.id,
      owner,
      submitInput(await quote(db, b.id)),
      execute,
    )
    expect(second.status).toBe('submission_unknown')
    expect(
      db
        .select()
        .from(virtualOrders)
        .all()
        .filter((order) => order.providerOrderId === 'same-broker-order'),
    ).toHaveLength(1)
    expect((await listVirtualAccountAssets(db, b.id, owner))[0]?.reserved).toBe('60')
  })
  test('closed positions and empty cash lines do not break portfolio valuation', async () => {
    const { db, a } = await setup()
    const now = new Date()
    await db.insert(virtualAccountAssets).values([
      {
        virtualAccountId: a.id,
        assetKey: 'security:1951:XTKS:cash:specific',
        assetKind: 'security',
        available: '0',
        reserved: '0',
        pending: '0',
        updatedAt: now,
      },
      {
        virtualAccountId: a.id,
        assetKey: 'cash:USD',
        assetKind: 'cash',
        available: '0',
        reserved: '0',
        pending: '0',
        updatedAt: now,
      },
    ])
    const overview = await accountOverview(db, owner, {})
    const component = overview.components.find((item) => item.profile.id === a.id)
    expect(component?.positions).toEqual([])
    expect(component?.valuation).toMatchObject({
      amount: { currency: 'JPY', value: '100' },
    })
    expect(overview.errors).toEqual([])
    expect((await accountValuation(db, owner, { account: a.id })).total.value).toBe('100')
  })
  test('caller input cannot impersonate an internal order command', async () => {
    const { db, a } = await setup()
    await expect(
      storeOrderQuote(
        db,
        a.id,
        owner,
        'investments.orders.preview',
        { ...request, parentId: 'fake-parent' },
        { confirmationToken: 'private', projectedAssetChanges: changes },
      ),
    ).rejects.toThrow('internal order fields')
  })

  test('quantity-based market buy previews, reserves, executes, and releases unused buffer on fill', async () => {
    const { db, a } = await setup()
    const marketRequest = {
      ...request,
      execution: { priceType: 'market', venue: 'TSE' },
    }
    const marketReservation = [
      {
        asset: { kind: 'cash' as const, currency: 'JPY' },
        availableDelta: '-80',
        reservedDelta: '80',
        pendingDelta: '0',
      },
    ]
    const provider = {
      accountIsolation: {
        physicalCashIncludesReservations: true,
        stableOrderReferences: true,
        attributableSettlementEffects: true,
        completeOpenOrderSnapshot: true,
      },
      methods: () => [
        'balances.list',
        'investments.positions.list',
        'investments.orders.open',
        'investments.orders.get',
        'investments.orders.preview',
        'investments.orders.create',
      ],
      checkMethodAvailability: async () => ({ available: true }),
      invoke: async (method: string) => {
        if (method === 'balances.list') {
          return [
            {
              accountId: 'secret-physical-id',
              type: 'current',
              amount: { kind: 'money', money: { currency: 'JPY', value: '200' } },
              asOf: new Date().toISOString(),
            },
          ]
        }
        if (method === 'investments.positions.list') return { items: [] }
        if (method === 'investments.orders.open') return { items: [], complete: true }
        if (method === 'investments.orders.preview') {
          return {
            confirmationToken: 'market-confirm-1',
            estimatedAmount: { currency: 'JPY', value: '80' },
            heldAmount: { currency: 'JPY', value: '80' },
            projectedAssetChanges: marketReservation,
            warnings: [],
          }
        }
        return {
          id: 'broker-market-1',
          status: 'open',
          effects: { referenceId: 'broker-market-1', changes: marketReservation },
        }
      },
    }
    const registry = {
      open: async () => ({
        profile: { id: 'connection' },
        provider,
        persist: async () => {},
        release: async () => {},
      }),
    } as unknown as ProviderRegistry
    const service = new FinancialAccountService(db, registry)
    try {
      const availability = (await service.dispatch(
        'account.availability',
        { account: a.id, method: 'account.investments.orders.preview', params: marketRequest },
        owner,
      )) as { methods: Record<string, { available: boolean }> }
      expect(availability.methods['account.investments.orders.preview']?.available).toBe(true)

      const preview = (await service.dispatch(
        'account.investments.orders.preview',
        { account: a.id, ...marketRequest },
        owner,
      )) as { confirmationToken: string }
      expect(preview.confirmationToken).toBeTruthy()

      const created = (await service.dispatch(
        'account.investments.orders.create',
        {
          account: a.id,
          ...marketRequest,
          confirmationToken: preview.confirmationToken,
          idempotencyKey: 'market-buy-1',
          allowTransaction: true,
        },
        owner,
      )) as { id: string; status: string }
      expect(created.status).toBe('open')
      expect((await listVirtualAccountAssets(db, a.id, owner))[0]).toMatchObject({
        available: '20',
        reserved: '80',
      })

      // Actual execution fills below the stop-high / buffered reservation (65 < 80).
      reconcileVirtualOrder(db, created.id, {
        id: 'broker-market-1',
        status: 'executed',
        executedQuantity: '1',
        unexecutedQuantity: '0',
        effects: {
          referenceId: 'broker-market-1',
          changes: [
            {
              asset: { kind: 'cash', currency: 'JPY' },
              availableDelta: '-65',
              reservedDelta: '0',
              pendingDelta: '0',
            },
            {
              asset: { kind: 'security', instrumentId: '7203', venue: 'TSE', positionType: 'cash' },
              availableDelta: '1',
              reservedDelta: '0',
              pendingDelta: '0',
            },
          ],
        },
      })
      const assets = await listVirtualAccountAssets(db, a.id, owner)
      expect(assets.find((asset) => asset.assetKey === 'cash:JPY')).toMatchObject({
        available: '35',
        reserved: '0',
      })
      expect(
        assets.find((asset) => asset.assetKey === 'security:7203:TSE:cash:unspecified'),
      ).toMatchObject({
        available: '1',
        reserved: '0',
      })
    } finally {
      await service.close()
    }
  })

  test('market buy without projectedAssetChanges is still rejected', async () => {
    const { db, a } = await setup()
    await expect(
      storeOrderQuote(
        db,
        a.id,
        owner,
        'investments.orders.preview',
        { ...request, execution: { priceType: 'market', venue: 'TSE' } },
        { confirmationToken: 'missing-reservation', warnings: [] },
      ),
    ).rejects.toThrow('provider cannot determine a safe reservation')
  })

  test('account policy allowedOrderTypes can restrict a virtual account to limit orders', async () => {
    const { db, a } = await setup()
    await updateVirtualAccount(db, a.id, {
      expectedVersion: a.version,
      policy: { allowedOrderTypes: ['limit'] },
    })
    await expect(
      storeOrderQuote(
        db,
        a.id,
        owner,
        'investments.orders.preview',
        { ...request, execution: { priceType: 'market', venue: 'TSE' } },
        { confirmationToken: 'denied-market', projectedAssetChanges: changes, warnings: [] },
      ),
    ).rejects.toThrow('account policy denies orderType')
  })

  test('settlement overrun marks order reconciliation_required without touching sibling virtual accounts', async () => {
    const { db, a, b } = await setup()
    const marketRequest = {
      ...request,
      execution: { priceType: 'market', venue: 'TSE' },
    }
    const preview = await storeOrderQuote(
      db,
      a.id,
      owner,
      'investments.orders.preview',
      marketRequest,
      { confirmationToken: 'market-overrun', projectedAssetChanges: changes, warnings: [] },
    )
    const order = await createCoordinatedOrder(
      db,
      a.id,
      owner,
      {
        ...marketRequest,
        confirmationToken: preview.confirmationToken,
        idempotencyKey: 'market-overrun-1',
        allowTransaction: true,
      },
      async () => ({
        id: 'broker-overrun',
        status: 'open',
        effects: { referenceId: 'broker-overrun', changes },
      }),
    )

    // Actual fill costs 120 JPY, exceeding account A's 100 JPY total (40 available + 60 reserved).
    const overrunFill = {
      id: 'broker-overrun',
      status: 'executed',
      executedQuantity: '1',
      unexecutedQuantity: '0',
      effects: {
        referenceId: 'broker-overrun',
        changes: [
          {
            asset: { kind: 'cash', currency: 'JPY' },
            availableDelta: '-120',
            reservedDelta: '0',
            pendingDelta: '0',
          },
          {
            asset: { kind: 'security', instrumentId: '7203', venue: 'TSE', positionType: 'cash' },
            availableDelta: '1',
            reservedDelta: '0',
            pendingDelta: '0',
          },
        ],
      },
    }
    reconcileVirtualOrder(db, order.id, overrunFill)

    const orderRow = db.select().from(virtualOrders).get()
    expect(orderRow?.state).toBe('reconciliation_required')
    expect(orderRow?.error).toContain('insufficient virtual asset: cash:JPY')
    // Account A keeps its original reservation; sibling account B is completely untouched.
    const aCash = (await listVirtualAccountAssets(db, a.id, owner))[0]!
    const bCash = (await listVirtualAccountAssets(db, b.id, owner))[0]!
    expect(aCash).toMatchObject({ available: '40', reserved: '60' })
    expect(bCash).toMatchObject({ available: '100', reserved: '0' })

    // Once the owner transfers 30 JPY from B to A, reconciliation settles cleanly and clears error.
    transferVirtualAssets(db, [
      {
        fromAccountId: b.id,
        toAccountId: a.id,
        assetKey: 'cash:JPY',
        amount: '30',
        expectedFromVersion: bCash.version,
        expectedToVersion: aCash.version,
        reason: 'top-up after market buy fill',
      },
    ])
    reconcileVirtualOrder(db, order.id, overrunFill)
    const settledRow = db.select().from(virtualOrders).get()
    expect(settledRow?.state).toBe('filled')
    expect(settledRow?.error).toBeNull()
    expect(
      (await listVirtualAccountAssets(db, a.id, owner)).find(
        (asset) => asset.assetKey === 'cash:JPY',
      ),
    ).toMatchObject({ available: '10', reserved: '0' })
  })
})
