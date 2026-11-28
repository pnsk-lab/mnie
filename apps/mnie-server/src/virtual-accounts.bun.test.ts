import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDb } from './db'
import {
  apiKeys,
  accountAudit,
  appState,
  externalOrderReservations,
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
  virtualAssetMovements,
  virtualAccounts,
} from './db/schema'
import {
  addDecimal,
  approvePhysicalAccountReconciliation,
  applyVirtualOperationEffects,
  bindApiKeyToVirtualAccount,
  canonicalDecimal,
  commitVirtualOperation,
  createVirtualAccount,
  initializeVirtualAccounts,
  listVirtualAccountAssets,
  listVirtualAccounts,
  normalizeAssetKey,
  reconcilePhysicalAccount,
  reserveVirtualOperation,
  reserveVirtualReplacement,
  transferVirtualAsset,
} from './virtual-accounts'

const setPhysicalAsset = async (db: ReturnType<typeof createDb>, amount: string) => {
  await db
    .insert(physicalAccountAssets)
    .values({
      physicalAccountId: 'physical-1',
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      amount,
      version: 1,
      updatedAt: new Date(0),
    })
    .onConflictDoUpdate({
      target: [physicalAccountAssets.physicalAccountId, physicalAccountAssets.assetKey],
      set: { amount, updatedAt: new Date() },
    })
}

const addAsset = async (db: ReturnType<typeof createDb>, accountId: string, available: string) => {
  await db.insert(virtualAccountAssets).values({
    virtualAccountId: accountId,
    assetKey: 'cash:JPY',
    assetKind: 'cash',
    available,
    reserved: '0',
    pending: '0',
    version: 1,
    updatedAt: new Date(0),
  })
}

const addPhysicalAccount = async (db: ReturnType<typeof createDb>) => {
  await db.insert(financialAccounts).values({
    id: 'physical-1',
    profileId: 'profile-1',
    connectorTypeId: 'test-broker',
    institutionId: 'test-broker',
    providerAccountId: 'provider-account-1',
    kind: 'brokerage',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
}

describe('virtual account ledger', () => {
  test('initializes every discovered physical account as Unallocated', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const initialized = await initializeVirtualAccounts(db, 'physical-1')
    expect(initialized.unallocated).toMatchObject({ label: 'Unallocated', kind: 'system' })
    await expect(initializeVirtualAccounts(db, 'physical-1')).rejects.toThrow('already initialized')
  })

  test('uses exact canonical decimal arithmetic', () => {
    expect(canonicalDecimal('100.2500')).toBe('100.25')
    expect(addDecimal('9007199254740993.01', '0.09')).toBe('9007199254740993.1')
    expect(() => canonicalDecimal('1e3')).toThrow('invalid decimal')
    expect(normalizeAssetKey('security:7203:TSE:cash:specific')).toBe(
      'security:7203:TSE:cash:specific',
    )
  })

  test('transfers only available assets atomically and records both movements', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const from = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Personal',
    })
    const to = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Agent',
    })
    await addAsset(db, from.id, '1000.25')

    await transferVirtualAsset(db, {
      fromAccountId: from.id,
      toAccountId: to.id,
      assetKey: 'cash:JPY',
      amount: '250.05',
      expectedFromVersion: 1,
      expectedToVersion: 0,
      reason: 'agent allocation',
    })

    expect((await listVirtualAccountAssets(db, from.id, { owner: true }))[0]).toMatchObject({
      available: '750.2',
      reserved: '0',
      version: 2,
    })
    expect((await listVirtualAccountAssets(db, to.id, { owner: true }))[0]).toMatchObject({
      available: '250.05',
      version: 1,
    })
    expect(await db.select().from(virtualAssetMovements)).toHaveLength(2)

    await expect(
      transferVirtualAsset(db, {
        fromAccountId: from.id,
        toAccountId: to.id,
        assetKey: 'cash:JPY',
        amount: '1',
        expectedFromVersion: 1,
        expectedToVersion: 0,
        reason: 'stale retry',
      }),
    ).rejects.toThrow('asset version conflict')
  })

  test('does not reveal system or unbound accounts to API keys', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const personal = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Personal',
    })
    const agent = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Agent',
    })
    await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Unallocated',
      kind: 'system',
    })
    await db.insert(apiKeys).values({
      id: 'key-1',
      label: 'agent key',
      tokenHash: 'hash',
      createdAt: new Date(0),
    })
    await bindApiKeyToVirtualAccount(db, 'key-1', agent.id, 'trade')

    expect(await listVirtualAccounts(db, { owner: false, apiKeyId: 'key-1' })).toEqual([
      expect.objectContaining({
        id: agent.id,
        permissions: { read: true, trade: true, manage: false },
      }),
    ])
    expect(await listVirtualAccounts(db, { owner: false })).toEqual([])
    expect((await listVirtualAccounts(db, { owner: true })).map((account) => account.id)).toEqual([
      personal.id,
      agent.id,
      expect.stringMatching(/^acct_/),
    ])
  })

  test('allows only one Unallocated account per physical account', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Unallocated',
      kind: 'system',
    })
    await expect(
      createVirtualAccount(db, {
        physicalAccountId: 'physical-1',
        label: 'Another system account',
        kind: 'system',
      }),
    ).rejects.toThrow()
  })

  test('derives Unallocated from the physical cache without storing system holdings', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const { unallocated } = await initializeVirtualAccounts(db, 'physical-1')
    const personal = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Personal',
    })
    await setPhysicalAsset(db, '1000')
    await addAsset(db, personal.id, '300')

    expect(await listVirtualAccountAssets(db, unallocated.id, { owner: true })).toEqual([
      expect.objectContaining({ assetKey: 'cash:JPY', available: '700' }),
    ])
    expect(
      await db
        .select()
        .from(virtualAccountAssets)
        .where(eq(virtualAccountAssets.virtualAccountId, unallocated.id)),
    ).toEqual([])
  })

  test('locks after an external decrease and requires remediation plus explicit approval', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const { unallocated } = await initializeVirtualAccounts(db, 'physical-1')
    const personal = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Personal',
    })
    await addAsset(db, personal.id, '800')
    await setPhysicalAsset(db, '1000')
    expect((await reconcilePhysicalAccount(db, 'physical-1')).locked).toBe(false)

    await setPhysicalAsset(db, '1200')
    expect(await listVirtualAccountAssets(db, unallocated.id, { owner: true })).toEqual([
      expect.objectContaining({ available: '400' }),
    ])

    await setPhysicalAsset(db, '700')
    const reconciliation = await reconcilePhysicalAccount(db, 'physical-1')
    expect(reconciliation.deficits[0]).toMatchObject({ available: '-100' })
    expect((await db.select().from(virtualAccounts)).map((account) => account.status)).toEqual([
      'reconciliation_required',
      'reconciliation_required',
    ])
    await expect(approvePhysicalAccountReconciliation(db, 'physical-1')).rejects.toThrow(
      'must not be negative',
    )

    const [derived] = await listVirtualAccountAssets(db, unallocated.id, { owner: true })
    await transferVirtualAsset(db, {
      fromAccountId: personal.id,
      toAccountId: unallocated.id,
      assetKey: 'cash:JPY',
      amount: '100',
      expectedFromVersion: 1,
      expectedToVersion: derived!.version,
      reason: 'external balance reconciliation',
    })
    await expect(approvePhysicalAccountReconciliation(db, 'physical-1')).resolves.toEqual({
      ok: true,
    })
    expect((await db.select().from(virtualAccounts)).map((account) => account.status)).toEqual([
      'active',
      'active',
    ])
    expect(await listVirtualAccountAssets(db, unallocated.id, { owner: true })).toEqual([
      expect.objectContaining({ available: '0' }),
    ])
  })

  test('does not lock on transient snapshot error alone and records distinct lock reasons on divergence', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    await initializeVirtualAccounts(db, 'physical-1')
    await db.insert(appState).values({
      key: 'physical_snapshot_error:physical-1',
      value: 'BROKER_SNAPSHOT_UNAVAILABLE',
      updatedAt: new Date(),
    })
    const transient = await reconcilePhysicalAccount(db, 'physical-1')
    expect(transient.locked).toBe(false)
    expect(transient.snapshotError).toBe(true)
    expect(transient.syncErrors).toHaveLength(1)
    expect(
      await db.select().from(accountAudit).where(eq(accountAudit.event, 'reconciliation.locked')),
    ).toHaveLength(0)

    await db.insert(externalOrderReservations).values({
      physicalAccountId: 'physical-1',
      providerOrderId: 'ext-unknown-1',
      changes: [],
      state: 'needs_review',
      updatedAt: new Date(),
    })
    const diverged = await reconcilePhysicalAccount(db, 'physical-1')
    expect(diverged.locked).toBe(true)
    const locks = await db
      .select()
      .from(accountAudit)
      .where(eq(accountAudit.event, 'reconciliation.locked'))
    expect(locks).toHaveLength(1)
    expect(locks[0]?.detail).toMatchObject({
      snapshotError: true,
      externalOrderReviewRequired: true,
    })
  })

  test('self-heals legacy snapshot-error-only locks while keeping divergence locks manual', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const { unallocated } = await initializeVirtualAccounts(db, 'physical-1')
    const trading = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Trading',
    })
    const paused = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Paused',
    })
    await setPhysicalAsset(db, '1000')
    const now = new Date()
    // Simulate legacy snapshot-error-only lock on all accounts (one of which was previously frozen).
    for (const [account, previousStatus] of [
      [unallocated, 'active'],
      [trading, 'active'],
      [paused, 'frozen'],
    ] as const) {
      db.update(virtualAccounts)
        .set({ status: 'reconciliation_required', version: account.version + 1, updatedAt: now })
        .where(eq(virtualAccounts.id, account.id))
        .run()
      db.insert(accountAudit)
        .values({
          id: `audit-lock-${account.id}`,
          accountId: account.id,
          event: 'reconciliation.locked',
          detail: {
            previousStatus,
            deficitAssetKeys: [],
            orderIds: [],
            externalOrderReviewRequired: false,
            snapshotError: true,
          },
          createdAt: now,
        })
        .run()
    }
    db.insert(appState)
      .values({
        key: 'physical_snapshot_error:physical-1',
        value: 'BROKER_SNAPSHOT_UNAVAILABLE',
        updatedAt: now,
      })
      .run()

    // While the legacy unscoped snapshot error is still present, keep accounts locked.
    expect((await reconcilePhysicalAccount(db, 'physical-1')).locked).toBe(true)

    // Once the snapshot error clears and ledger is consistent, accounts auto-unlock to previous status.
    db.delete(appState).where(eq(appState.key, 'physical_snapshot_error:physical-1')).run()
    const recovered = await reconcilePhysicalAccount(db, 'physical-1')
    expect(recovered.locked).toBe(false)
    expect(
      Object.fromEntries(
        db
          .select()
          .from(virtualAccounts)
          .all()
          .map((account) => [account.id, account.status]),
      ),
    ).toEqual({
      [unallocated.id]: 'active',
      [trading.id]: 'active',
      [paused.id]: 'frozen',
    })
    expect(
      db
        .select()
        .from(accountAudit)
        .where(eq(accountAudit.event, 'reconciliation.auto_unlocked'))
        .all(),
    ).toHaveLength(3)
  })

  test('reserves provider changes within the virtual balance and releases them on cancellation', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const account = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Trading',
    })
    await addAsset(db, account.id, '1000')
    const changes = [
      {
        asset: { kind: 'cash' as const, currency: 'JPY' },
        availableDelta: '-600',
        reservedDelta: '600',
        pendingDelta: '0',
      },
    ]

    const reservationId = await reserveVirtualOperation(db, account.id, changes)
    expect((await listVirtualAccountAssets(db, account.id, { owner: true }))[0]).toMatchObject({
      available: '400',
      reserved: '600',
    })
    await commitVirtualOperation(db, account.id, changes, reservationId, {
      referenceId: 'provider-order-1',
      changes,
    })
    await applyVirtualOperationEffects(db, account.id, {
      referenceId: 'provider-cancel-1',
      changes: [],
      reversesReferenceIds: ['provider-order-1'],
    })
    expect((await listVirtualAccountAssets(db, account.id, { owner: true }))[0]).toMatchObject({
      available: '1000',
      reserved: '0',
    })
  })

  test('rejects a provider reservation that exceeds the virtual allocation', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const account = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Trading',
    })
    await addAsset(db, account.id, '1000')
    await expect(
      reserveVirtualOperation(db, account.id, [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-1000.01',
          reservedDelta: '1000.01',
          pendingDelta: '0',
        },
      ]),
    ).rejects.toThrow('insufficient virtual asset')
    expect((await listVirtualAccountAssets(db, account.id, { owner: true }))[0]).toMatchObject({
      available: '1000',
      reserved: '0',
    })
  })

  test('replaces an existing reservation using the net virtual balance', async () => {
    const db = createDb(':memory:')
    await addPhysicalAccount(db)
    const account = await createVirtualAccount(db, {
      physicalAccountId: 'physical-1',
      label: 'Trading',
    })
    await addAsset(db, account.id, '1000')
    const original = [
      {
        asset: { kind: 'cash' as const, currency: 'JPY' },
        availableDelta: '-600',
        reservedDelta: '600',
        pendingDelta: '0',
      },
    ]
    const originalReservation = await reserveVirtualOperation(db, account.id, original)
    await commitVirtualOperation(db, account.id, original, originalReservation, {
      referenceId: 'provider-order-1',
      changes: original,
    })
    const replacement = [
      {
        asset: { kind: 'cash' as const, currency: 'JPY' },
        availableDelta: '-800',
        reservedDelta: '800',
        pendingDelta: '0',
      },
    ]
    const replacementReservation = await reserveVirtualReplacement(
      db,
      account.id,
      replacement,
      'provider-order-1',
    )
    await commitVirtualOperation(
      db,
      account.id,
      replacement,
      replacementReservation.reservationId,
      {
        referenceId: 'provider-order-1',
        changes: replacement,
        reversesReferenceIds: ['provider-order-1'],
      },
    )
    expect((await listVirtualAccountAssets(db, account.id, { owner: true }))[0]).toMatchObject({
      available: '200',
      reserved: '800',
    })
  })
})
