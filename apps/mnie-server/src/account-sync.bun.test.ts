import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { OpenOrderSnapshot } from '@mnie/types'
import { createDb } from './db'
import {
  accountAudit,
  accountProfiles,
  appState,
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
  virtualAccounts,
  virtualOrders,
} from './db/schema'
import {
  approvePhysicalAccountReconciliation,
  bindApiKeyToVirtualAccount,
  createVirtualAccount,
  initializeVirtualAccounts,
} from './virtual-accounts'
import { createApiKey } from './security/api-keys'
import { FinancialAccountService } from './financial-account-service'
import { syncAccountOrdersUnlocked } from './account-sync'
import { inspectAccountReconciliation } from './account-reconciliation'
import { listPhysicalSyncErrors } from './sync-errors'
import type { ProviderRegistry } from './providers/registry'

const domesticRequest = {
  instrumentId: '7203',
  instrumentVenue: 'XTKS',
  side: 'buy',
  quantity: '1',
  positionType: 'cash',
  execution: {
    priceType: 'limit',
    venue: 'XTKS',
    limitPrice: { currency: 'JPY', value: '50' },
  },
}

const usRequest = {
  instrumentId: 'AAPL',
  instrumentVenue: 'XNAS',
  side: 'buy',
  quantity: '1',
  positionType: 'cash',
  execution: {
    priceType: 'limit',
    venue: 'XNAS',
    limitPrice: { currency: 'JPY', value: '50' },
  },
}

const reservation = [
  {
    asset: { kind: 'cash' as const, currency: 'JPY' },
    availableDelta: '-50',
    reservedDelta: '50',
    pendingDelta: '0',
  },
]

const createFixture = async (options?: {
  openOrders?: () => Promise<OpenOrderSnapshot>
  balances?: () => Promise<unknown>
  orderSnapshot?: (input: Record<string, unknown>) => Promise<unknown>
}) => {
  const db = createDb(':memory:')
  const now = new Date()
  await db.insert(accountProfiles).values({
    id: 'connection',
    provider: 'sbi-sec',
    label: 'SBI',
    keyringAccount: 'unused',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(financialAccounts).values({
    id: 'financial-account_sbi',
    profileId: 'connection',
    connectorTypeId: 'sbi-sec',
    institutionId: 'sbi-sec',
    providerAccountId: '12345678',
    kind: 'brokerage',
    createdAt: now,
    updatedAt: now,
  })
  const { unallocated } = await initializeVirtualAccounts(db, 'financial-account_sbi')
  await db.insert(physicalAccountAssets).values({
    physicalAccountId: 'financial-account_sbi',
    assetKey: 'cash:JPY',
    assetKind: 'cash',
    amount: '200',
    updatedAt: now,
  })
  const trading = await createVirtualAccount(db, {
    physicalAccountId: 'financial-account_sbi',
    label: 'Agent',
  })
  await db.insert(virtualAccountAssets).values({
    virtualAccountId: trading.id,
    assetKey: 'cash:JPY',
    assetKind: 'cash',
    available: '150',
    reserved: '0',
    pending: '0',
    updatedAt: now,
  })
  const key = await createApiKey(db, 'bot', { scopes: ['read', 'trade'] })
  await bindApiKeyToVirtualAccount(db, key.id, trading.id, 'trade')
  const apiAccess = { owner: false, apiKeyId: key.id, scopes: ['read', 'trade'] }

  let openOrdersImpl =
    options?.openOrders ?? (async (): Promise<OpenOrderSnapshot> => ({ items: [], complete: true }))
  let balancesImpl =
    options?.balances ??
    (async () => [
      {
        accountId: '12345678',
        type: 'current',
        amount: { kind: 'money', money: { currency: 'JPY', value: '200' } },
        asOf: new Date().toISOString(),
      },
    ])
  let orderSnapshotImpl =
    options?.orderSnapshot ??
    (async (input: Record<string, unknown>) => ({
      id: String(input.orderId),
      status: 'open',
      executedQuantity: '0',
      unexecutedQuantity: '1',
    }))

  let snapshotCalls = 0
  let orderCounter = 0
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
      'investments.orders.cancel',
    ],
    checkMethodAvailability: async () => ({ available: true }),
    invoke: async (method: string, input: Record<string, unknown>) => {
      if (method === 'balances.list') {
        snapshotCalls += 1
        return balancesImpl()
      }
      if (method === 'investments.positions.list') return { items: [] }
      if (method === 'investments.orders.open') return openOrdersImpl()
      if (method === 'investments.orders.get') return orderSnapshotImpl(input)
      if (method === 'investments.orders.preview') {
        orderCounter += 1
        return {
          confirmationToken: `confirm-${orderCounter}`,
          estimatedAmount: { currency: 'JPY', value: '50' },
          projectedAssetChanges: reservation,
          warnings: [],
        }
      }
      if (method === 'investments.orders.create') {
        orderCounter += 1
        const id = `broker-${orderCounter}`
        return {
          id,
          status: 'open',
          effects: { referenceId: id, changes: reservation },
        }
      }
      if (method === 'investments.orders.cancel') {
        return { id: String(input.orderId), status: 'cancelled' }
      }
      throw new Error(`unexpected method: ${method}`)
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

  return {
    db,
    unallocated,
    trading,
    apiAccess,
    service,
    setOpenOrders: (fn: () => Promise<OpenOrderSnapshot>) => {
      openOrdersImpl = fn
    },
    setBalances: (fn: () => Promise<unknown>) => {
      balancesImpl = fn
    },
    setOrderSnapshot: (fn: (input: Record<string, unknown>) => Promise<unknown>) => {
      orderSnapshotImpl = fn
    },
    getSnapshotCalls: () => snapshotCalls,
  }
}

describe('scoped sync failures and self-healing (issue #36)', () => {
  test('US open_orders timeout keeps domestic trading working, blocks US, and self-heals on recovery', async () => {
    const fx = await createFixture({
      openOrders: async () => ({
        items: [],
        complete: false,
        completeVenues: ['XTKS', 'XNGO', 'XFKA', 'XSAP'],
        failedScopes: [
          {
            scope: 'us',
            venues: ['XNAS', 'XNYS', 'ARCX'],
            reason: 'timeout',
          },
        ],
      }),
    })
    try {
      const synced = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      expect(synced.locked).toBe(false)
      expect(synced.snapshotError).toBe(true)
      expect(synced.syncErrors).toEqual([
        expect.objectContaining({
          stage: 'open_orders',
          scope: 'open_orders:us',
          reason: 'timeout',
          venues: ['XNAS', 'XNYS', 'ARCX'],
        }),
      ])
      expect(fx.getSnapshotCalls()).toBe(1)

      // Virtual accounts remain active (not reconciliation_required) so trade capability stays intact.
      expect(
        fx.db
          .select()
          .from(virtualAccounts)
          .all()
          .every((account) => account.status === 'active'),
      ).toBe(true)

      // Inspection exposes scoped sync errors cleanly.
      const inspected = inspectAccountReconciliation(fx.db, 'financial-account_sbi')
      expect(inspected.snapshotError).toBe(true)
      expect(inspected.syncErrors).toHaveLength(1)
      expect(inspected.syncErrors[0]).toMatchObject({
        scope: 'open_orders:us',
        reason: 'timeout',
      })

      // Generic method probe (no params) stays available for healthy markets.
      const genericAvailability = (await fx.service.dispatch(
        'account.availability',
        { account: fx.trading.id, method: 'account.investments.orders.preview' },
        fx.apiAccess,
      )) as { methods: Record<string, { available: boolean }> }
      expect(genericAvailability.methods['account.investments.orders.preview']?.available).toBe(
        true,
      )

      // Domestic availability, preview, and order placement all succeed via API key!
      const domesticAvailability = (await fx.service.dispatch(
        'account.availability',
        {
          account: fx.trading.id,
          method: 'account.investments.orders.preview',
          params: domesticRequest,
        },
        fx.apiAccess,
      )) as { methods: Record<string, { available: boolean }> }
      expect(domesticAvailability.methods['account.investments.orders.preview']?.available).toBe(
        true,
      )

      const domesticPreview = (await fx.service.dispatch(
        'account.investments.orders.preview',
        { account: fx.trading.id, ...domesticRequest },
        fx.apiAccess,
      )) as { confirmationToken: string }
      expect(domesticPreview.confirmationToken).toBeTruthy()

      const domesticOrder = (await fx.service.dispatch(
        'account.investments.orders.create',
        {
          account: fx.trading.id,
          ...domesticRequest,
          confirmationToken: domesticPreview.confirmationToken,
          idempotencyKey: 'dom-1',
          allowTransaction: true,
        },
        fx.apiAccess,
      )) as { status: string }
      expect(domesticOrder.status).toBe('open')

      // US availability and preview are blocked fail-closed!
      const usAvailability = (await fx.service.dispatch(
        'account.availability',
        {
          account: fx.trading.id,
          method: 'account.investments.orders.preview',
          params: usRequest,
        },
        fx.apiAccess,
      )) as { methods: Record<string, { available: boolean; message?: string }> }
      expect(usAvailability.methods['account.investments.orders.preview']).toMatchObject({
        available: false,
        message: 'broker sync unavailable for open_orders:us (timeout)',
      })
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...usRequest },
          fx.apiAccess,
        ),
      ).rejects.toThrow('broker sync unavailable for open_orders:us (timeout)')

      // Once US open_orders recovers, trading self-heals automatically without manual owner approval!
      fx.setOpenOrders(async () => ({ items: [], complete: true }))
      const usPreview = (await fx.service.dispatch(
        'account.investments.orders.preview',
        { account: fx.trading.id, ...usRequest },
        fx.apiAccess,
      )) as { confirmationToken: string }
      expect(usPreview.confirmationToken).toBeTruthy()
      expect(listPhysicalSyncErrors(fx.db, 'financial-account_sbi')).toEqual([])
    } finally {
      await fx.service.close()
    }
  })

  test('whole-account open_orders timeout keeps physical_assets fresh, avoids manual lock, and self-heals', async () => {
    const fx = await createFixture({
      openOrders: async () => {
        throw new Error('HTTP 504 Gateway Timeout')
      },
    })
    try {
      const synced = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      // physical_assets still ran even though open_orders threw!
      expect(fx.getSnapshotCalls()).toBe(1)
      expect(synced.locked).toBe(false)
      expect(synced.syncErrors).toEqual([
        expect.objectContaining({
          stage: 'open_orders',
          scope: 'open_orders',
          reason: 'timeout',
        }),
      ])

      // All trades fail closed while whole open_orders is dirty, with clear error (not "method not found").
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...domesticRequest },
          fx.apiAccess,
        ),
      ).rejects.toThrow('broker sync unavailable for open_orders (timeout)')

      // Once open_orders recovers, API key trading resumes immediately without owner intervention.
      fx.setOpenOrders(async () => ({ items: [], complete: true }))
      const preview = (await fx.service.dispatch(
        'account.investments.orders.preview',
        { account: fx.trading.id, ...domesticRequest },
        fx.apiAccess,
      )) as { confirmationToken: string }
      expect(preview.confirmationToken).toBeTruthy()
    } finally {
      await fx.service.close()
    }
  })

  test('per-order order_snapshot failure isolates to the failing order and venue without aborting sync', async () => {
    const fx = await createFixture()
    try {
      const now = new Date()
      fx.db
        .update(virtualAccountAssets)
        .set({ available: '50', reserved: '100', updatedAt: now })
        .where(eq(virtualAccountAssets.virtualAccountId, fx.trading.id))
        .run()
      fx.db
        .insert(virtualOrders)
        .values([
          {
            id: 'order-us',
            accountId: fx.trading.id,
            physicalAccountId: 'financial-account_sbi',
            providerOrderId: 'broker-us-1',
            idempotencyKey: 'k-us',
            requestHash: 'h-us',
            request: usRequest,
            changes: reservation,
            state: 'open' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'order-jp',
            accountId: fx.trading.id,
            physicalAccountId: 'financial-account_sbi',
            providerOrderId: 'broker-jp-1',
            idempotencyKey: 'k-jp',
            requestHash: 'h-jp',
            request: domesticRequest,
            changes: reservation,
            state: 'open' as const,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .run()

      fx.setOrderSnapshot(async (input) => {
        if (input.orderId === 'broker-us-1') throw new Error('HTTP 504 timeout')
        return {
          id: 'broker-jp-1',
          status: 'cancelled',
          executedQuantity: '0',
          unexecutedQuantity: '0',
        }
      })

      const synced = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      expect(synced.locked).toBe(false)
      expect(fx.getSnapshotCalls()).toBe(1)
      // Domestic order reconciled even though US order_snapshot failed.
      expect(
        fx.db.select().from(virtualOrders).where(eq(virtualOrders.id, 'order-jp')).get()?.state,
      ).toBe('cancelled')
      expect(synced.syncErrors).toEqual([
        expect.objectContaining({
          stage: 'order_snapshot',
          scope: 'order_snapshot:order-us',
          orderId: 'order-us',
          venues: ['XNAS'],
          reason: 'timeout',
        }),
      ])

      // Domestic preview works; US preview is blocked.
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...domesticRequest },
          fx.apiAccess,
        ),
      ).resolves.toMatchObject({ confirmationToken: expect.any(String) })
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...usRequest },
          fx.apiAccess,
        ),
      ).rejects.toThrow('order_snapshot:order-us')

      // Recovery clears the per-order error automatically.
      fx.setOrderSnapshot(async (input) => ({
        id: String(input.orderId),
        status: 'open',
        executedQuantity: '0',
        unexecutedQuantity: '1',
      }))
      await syncAccountOrdersUnlocked(fx.db, fx.service.gateway, 'financial-account_sbi')
      expect(listPhysicalSyncErrors(fx.db, 'financial-account_sbi')).toEqual([])
    } finally {
      await fx.service.close()
    }
  })

  test('legacy snapshot-error-only locked accounts auto-unlock when domestic sync succeeds even if US is still down', async () => {
    const fx = await createFixture({
      openOrders: async () => ({
        items: [],
        complete: false,
        completeVenues: ['XTKS', 'XNGO', 'XFKA', 'XSAP'],
        failedScopes: [{ scope: 'us', venues: ['XNAS', 'XNYS', 'ARCX'], reason: 'timeout' }],
      }),
    })
    try {
      const now = new Date()
      // Simulate production state before fix: legacy snapshot error locked all accounts.
      fx.db
        .insert(appState)
        .values({
          key: 'physical_snapshot_error:financial-account_sbi',
          value: 'BROKER_SNAPSHOT_UNAVAILABLE',
          updatedAt: now,
        })
        .run()
      for (const account of fx.db.select().from(virtualAccounts).all()) {
        fx.db
          .update(virtualAccounts)
          .set({ status: 'reconciliation_required', version: account.version + 1, updatedAt: now })
          .where(eq(virtualAccounts.id, account.id))
          .run()
        fx.db
          .insert(accountAudit)
          .values({
            id: `legacy-lock-${account.id}`,
            accountId: account.id,
            event: 'reconciliation.locked',
            detail: {
              previousStatus: 'active',
              deficitAssetKeys: [],
              orderIds: [],
              externalOrderReviewRequired: false,
              snapshotError: true,
            },
            createdAt: now,
          })
          .run()
      }

      const synced = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      expect(synced.locked).toBe(false)
      expect(
        fx.db
          .select()
          .from(virtualAccounts)
          .all()
          .every((account) => account.status === 'active'),
      ).toBe(true)

      // Domestic works immediately; US remains fail-closed!
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...domesticRequest },
          fx.apiAccess,
        ),
      ).resolves.toMatchObject({ confirmationToken: expect.any(String) })
      await expect(
        fx.service.dispatch(
          'account.investments.orders.preview',
          { account: fx.trading.id, ...usRequest },
          fx.apiAccess,
        ),
      ).rejects.toThrow('open_orders:us')
    } finally {
      await fx.service.close()
    }
  })

  test('actual ledger divergence still locks accounts and requires explicit owner approval', async () => {
    const fx = await createFixture({
      balances: async () => [
        {
          accountId: '12345678',
          type: 'current',
          // Allocated is 150, actual dropped to 100 -> -50 unallocated deficit!
          amount: { kind: 'money', money: { currency: 'JPY', value: '100' } },
          asOf: new Date().toISOString(),
        },
      ],
    })
    try {
      const diverged = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      expect(diverged.locked).toBe(true)
      expect(diverged.deficits[0]).toMatchObject({ assetKey: 'cash:JPY', available: '-50' })

      // Even if broker cash returns to 200 on the next sync, divergence lock does NOT auto-unlock.
      fx.setBalances(async () => [
        {
          accountId: '12345678',
          type: 'current',
          amount: { kind: 'money', money: { currency: 'JPY', value: '200' } },
          asOf: new Date().toISOString(),
        },
      ])
      const afterDeposit = await syncAccountOrdersUnlocked(
        fx.db,
        fx.service.gateway,
        'financial-account_sbi',
      )
      expect(afterDeposit.deficits).toEqual([])
      expect(afterDeposit.locked).toBe(true)

      // Explicit owner approval unlocks once consistent.
      await expect(
        approvePhysicalAccountReconciliation(fx.db, 'financial-account_sbi'),
      ).resolves.toEqual({ ok: true })
      expect(
        fx.db
          .select()
          .from(virtualAccounts)
          .all()
          .every((account) => account.status === 'active'),
      ).toBe(true)
    } finally {
      await fx.service.close()
    }
  })
})
