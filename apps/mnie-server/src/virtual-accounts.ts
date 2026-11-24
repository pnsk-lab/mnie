import { validateAccountPolicy } from './account-policy'
import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'
import type {
  FinancialAccountId,
  FinancialAssetChange,
  FinancialAssetReference,
  FinancialOperationEffects,
  PublicFinancialAccount,
  VirtualAccountAsset,
} from '@mnie/types'
import type { Db } from './db'
import {
  apiKeyVirtualAccounts,
  apiKeys,
  appState,
  externalOrderReservations,
  virtualOrders,
  accountAudit,
  virtualOrderQuotes,
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
  virtualAccounts,
  virtualAssetMovements,
  virtualOperationEffects,
} from './db/schema'
import { randomId } from './security/crypto'

type Decimal = { coefficient: bigint; scale: number }

const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/

export const canonicalDecimal = (input: string) => {
  const match = decimalPattern.exec(input)
  if (!match) throw new Error(`invalid decimal: ${input}`)
  const fraction = (match[3] ?? '').replace(/0+$/, '')
  const integer = match[2]!
  const value = `${match[1]}${integer}${fraction ? `.${fraction}` : ''}`
  return value === '-0' ? '0' : value
}

const parseDecimal = (input: string): Decimal => {
  const canonical = canonicalDecimal(input)
  const negative = canonical.startsWith('-')
  const unsigned = negative ? canonical.slice(1) : canonical
  const [integer, fraction = ''] = unsigned.split('.')
  return {
    coefficient: BigInt(`${negative ? '-' : ''}${integer}${fraction}`),
    scale: fraction.length,
  }
}

const align = (left: Decimal, right: Decimal) => {
  const scale = Math.max(left.scale, right.scale)
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ] as const
}

export const addDecimal = (left: string, right: string) => {
  const [a, b, scale] = align(parseDecimal(left), parseDecimal(right))
  const negative = a + b < 0n
  const digits = (negative ? -(a + b) : a + b).toString().padStart(scale + 1, '0')
  const raw = scale
    ? `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    : `${negative ? '-' : ''}${digits}`
  return canonicalDecimal(raw)
}

export const multiplyDecimal = (left: string, right: string) => {
  const a = parseDecimal(left),
    b = parseDecimal(right)
  const scale = a.scale + b.scale
  const coefficient = a.coefficient * b.coefficient
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(scale + 1, '0')
  return canonicalDecimal(
    `${coefficient < 0n ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`,
  )
}

export const compareDecimal = (left: string, right: string) => {
  const [a, b] = align(parseDecimal(left), parseDecimal(right))
  return a < b ? -1 : a > b ? 1 : 0
}

export const normalizeAssetKey = (assetKey: string) => {
  const normalized = assetKey.trim()
  if (/^cash:[A-Z]{3}$/.test(normalized)) return normalized
  if (/^security:[^:\s]+:[^:\s]+:cash:[^:\s]+$/.test(normalized)) return normalized
  throw new Error('assetKey must be cash:ISO4217 or security:symbol:market:cash:taxClass')
}

const requiredAssetPart = (value: string) => {
  if (!value?.trim() || /[:\s]/.test(value)) throw new Error('asset identity is missing or invalid')
  return value
}

export const financialAssetKey = (asset: FinancialAssetReference) =>
  asset.kind === 'cash'
    ? normalizeAssetKey(`cash:${asset.currency.toUpperCase()}`)
    : normalizeAssetKey(
        `security:${requiredAssetPart(asset.instrumentId)}:${requiredAssetPart(asset.venue)}:cash:${asset.accountType ? requiredAssetPart(asset.accountType) : 'unspecified'}`,
      )

const canonicalChange = (change: FinancialAssetChange): FinancialAssetChange => ({
  asset: change.asset,
  availableDelta: canonicalDecimal(change.availableDelta),
  reservedDelta: canonicalDecimal(change.reservedDelta),
  pendingDelta: canonicalDecimal(change.pendingDelta),
})

const aggregateChanges = (changes: FinancialAssetChange[]) => {
  const aggregated = new Map<string, FinancialAssetChange>()
  for (const raw of changes) {
    const change = canonicalChange(raw)
    const assetKey = financialAssetKey(change.asset)
    const current = aggregated.get(assetKey)
    aggregated.set(
      assetKey,
      current
        ? {
            asset: current.asset,
            availableDelta: addDecimal(current.availableDelta, change.availableDelta),
            reservedDelta: addDecimal(current.reservedDelta, change.reservedDelta),
            pendingDelta: addDecimal(current.pendingDelta, change.pendingDelta),
          }
        : change,
    )
  }
  return [...aggregated.entries()]
}

export const negateDecimal = (value: string) => {
  const canonical = canonicalDecimal(value)
  return canonical === '0' ? '0' : canonical.startsWith('-') ? canonical.slice(1) : `-${canonical}`
}

export const invertChanges = (changes: FinancialAssetChange[]) =>
  changes.map((change) => ({
    asset: change.asset,
    availableDelta: negateDecimal(change.availableDelta),
    reservedDelta: negateDecimal(change.reservedDelta),
    pendingDelta: negateDecimal(change.pendingDelta),
  }))

type VirtualAccountTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

export const applyAssetChanges = (
  tx: VirtualAccountTransaction,
  input: {
    accountId: string
    changes: FinancialAssetChange[]
    eventType: string
    referenceType: string
    referenceId: string
    metadata?: Record<string, unknown>
    settlement?: boolean
  },
) => {
  const account = tx
    .select({ status: virtualAccounts.status })
    .from(virtualAccounts)
    .where(eq(virtualAccounts.id, input.accountId))
    .get()
  if (!account) throw new Error('account not found')
  if (account.status !== 'active' && !input.settlement)
    throw new Error('asset changes require an active account')
  const now = new Date()
  for (const [assetKey, change] of aggregateChanges(input.changes)) {
    const existing = tx
      .select()
      .from(virtualAccountAssets)
      .where(
        and(
          eq(virtualAccountAssets.virtualAccountId, input.accountId),
          eq(virtualAccountAssets.assetKey, assetKey),
        ),
      )
      .get()
    const available = addDecimal(existing?.available ?? '0', change.availableDelta)
    const reserved = addDecimal(existing?.reserved ?? '0', change.reservedDelta)
    const pending = addDecimal(existing?.pending ?? '0', change.pendingDelta)
    if ([available, reserved, pending].some((value) => compareDecimal(value, '0') < 0)) {
      throw new Error(`insufficient virtual asset: ${assetKey}`)
    }
    if (existing) {
      const updated = tx
        .update(virtualAccountAssets)
        .set({
          available,
          reserved,
          pending,
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(virtualAccountAssets.virtualAccountId, input.accountId),
            eq(virtualAccountAssets.assetKey, assetKey),
            eq(virtualAccountAssets.version, existing.version),
          ),
        )
        .returning({ version: virtualAccountAssets.version })
        .get()
      if (!updated) throw new Error('asset version conflict')
    } else {
      tx.insert(virtualAccountAssets)
        .values({
          virtualAccountId: input.accountId,
          assetKey,
          assetKind: change.asset.kind,
          available,
          reserved,
          pending,
          version: 1,
          updatedAt: now,
        })
        .run()
    }
    tx.insert(virtualAssetMovements)
      .values({
        id: randomId('movement'),
        virtualAccountId: input.accountId,
        assetKey,
        availableDelta: change.availableDelta,
        reservedDelta: change.reservedDelta,
        pendingDelta: change.pendingDelta,
        eventType: input.eventType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        metadata: input.metadata,
        createdAt: now,
      })
      .run()
  }
}

export const reserveVirtualOperation = async (
  db: Db,
  accountId: string,
  changes: FinancialAssetChange[],
) => {
  if (!changes.length) throw new Error('provider did not report projected asset changes')
  const reservationId = randomId('reservation')
  db.transaction((tx) =>
    applyAssetChanges(tx, {
      accountId,
      changes,
      eventType: 'provider_operation_reservation',
      referenceType: 'provider_operation_pending',
      referenceId: reservationId,
    }),
  )
  return reservationId
}

export const rollbackVirtualOperation = async (
  db: Db,
  accountId: string,
  changes: FinancialAssetChange[],
  reservationId: string,
) => {
  db.transaction((tx) =>
    applyAssetChanges(tx, {
      accountId,
      changes: invertChanges(changes),
      eventType: 'provider_operation_rollback',
      referenceType: 'provider_operation_rollback',
      referenceId: reservationId,
    }),
  )
}

export interface VirtualReplacementReservation {
  reservationId: string
  replacedReferenceId: string
  replacedChanges: FinancialAssetChange[]
}

export const reserveVirtualReplacement = async (
  db: Db,
  accountId: string,
  changes: FinancialAssetChange[],
  replacedReferenceId: string,
): Promise<VirtualReplacementReservation> => {
  if (!changes.length) throw new Error('provider did not report projected asset changes')
  const reservationId = randomId('reservation')
  let replacedChanges: FinancialAssetChange[] | undefined
  db.transaction((tx) => {
    const active = tx
      .select()
      .from(virtualOperationEffects)
      .where(
        and(
          eq(virtualOperationEffects.virtualAccountId, accountId),
          eq(virtualOperationEffects.providerReferenceId, replacedReferenceId),
          eq(virtualOperationEffects.status, 'active'),
        ),
      )
      .get()
    if (!active) throw new Error(`active virtual operation not found: ${replacedReferenceId}`)
    replacedChanges = active.changes
    applyAssetChanges(tx, {
      accountId,
      changes: invertChanges(active.changes),
      eventType: 'provider_operation_replacement_release',
      referenceType: 'provider_operation_replacement_release',
      referenceId: reservationId,
      metadata: { replacedReferenceId },
    })
    applyAssetChanges(tx, {
      accountId,
      changes,
      eventType: 'provider_operation_replacement_reservation',
      referenceType: 'provider_operation_replacement_pending',
      referenceId: reservationId,
      metadata: { replacedReferenceId },
    })
    tx.update(virtualOperationEffects)
      .set({ status: 'reversed', updatedAt: new Date() })
      .where(
        and(
          eq(virtualOperationEffects.virtualAccountId, accountId),
          eq(virtualOperationEffects.providerReferenceId, replacedReferenceId),
        ),
      )
      .run()
  })
  if (!replacedChanges) throw new Error('replacement reservation was not created')
  return { reservationId, replacedReferenceId, replacedChanges }
}

export const rollbackVirtualReplacement = async (
  db: Db,
  accountId: string,
  changes: FinancialAssetChange[],
  reservation: VirtualReplacementReservation,
) => {
  db.transaction((tx) => {
    applyAssetChanges(tx, {
      accountId,
      changes: invertChanges(changes),
      eventType: 'provider_operation_replacement_rollback',
      referenceType: 'provider_operation_replacement_rollback_new',
      referenceId: reservation.reservationId,
    })
    applyAssetChanges(tx, {
      accountId,
      changes: reservation.replacedChanges,
      eventType: 'provider_operation_replacement_rollback',
      referenceType: 'provider_operation_replacement_rollback_old',
      referenceId: reservation.reservationId,
    })
    tx.update(virtualOperationEffects)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(virtualOperationEffects.virtualAccountId, accountId),
          eq(virtualOperationEffects.providerReferenceId, reservation.replacedReferenceId),
        ),
      )
      .run()
  })
}

export const commitVirtualOperation = async (
  db: Db,
  accountId: string,
  projectedChanges: FinancialAssetChange[],
  reservationId: string,
  effects: FinancialOperationEffects,
) => {
  const now = new Date()
  db.transaction((tx) => {
    applyAssetChanges(tx, {
      accountId,
      changes: invertChanges(projectedChanges),
      eventType: 'provider_operation_reservation_release',
      referenceType: 'provider_operation_commit_release',
      referenceId: reservationId,
    })
    applyAssetChanges(tx, {
      accountId,
      changes: effects.changes,
      eventType: 'provider_operation_effect',
      referenceType: 'provider_operation_commit',
      referenceId: reservationId,
      metadata: { providerReferenceId: effects.referenceId },
    })
    tx.insert(virtualOperationEffects)
      .values({
        virtualAccountId: accountId,
        providerReferenceId: effects.referenceId,
        movementReferenceId: reservationId,
        changes: effects.changes.map(canonicalChange),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          virtualOperationEffects.virtualAccountId,
          virtualOperationEffects.providerReferenceId,
        ],
        set: {
          movementReferenceId: reservationId,
          changes: effects.changes.map(canonicalChange),
          status: 'active',
          updatedAt: now,
        },
      })
      .run()
  })
}

export const applyVirtualOperationEffects = async (
  db: Db,
  accountId: string,
  effects: FinancialOperationEffects,
) => {
  db.transaction((tx) => {
    for (const reversedReferenceId of effects.reversesReferenceIds ?? []) {
      const active = tx
        .select()
        .from(virtualOperationEffects)
        .where(
          and(
            eq(virtualOperationEffects.virtualAccountId, accountId),
            eq(virtualOperationEffects.providerReferenceId, reversedReferenceId),
            eq(virtualOperationEffects.status, 'active'),
          ),
        )
        .get()
      if (!active) throw new Error(`active virtual operation not found: ${reversedReferenceId}`)
      applyAssetChanges(tx, {
        accountId,
        changes: invertChanges(active.changes),
        eventType: 'provider_operation_reversal',
        referenceType: 'provider_operation_reversal',
        referenceId: effects.referenceId,
        metadata: { reversedReferenceId },
      })
      tx.update(virtualOperationEffects)
        .set({ status: 'reversed', updatedAt: new Date() })
        .where(
          and(
            eq(virtualOperationEffects.virtualAccountId, accountId),
            eq(virtualOperationEffects.providerReferenceId, reversedReferenceId),
          ),
        )
        .run()
    }
    if (!effects.changes.length) return
    const movementReferenceId = randomId('reservation')
    applyAssetChanges(tx, {
      accountId,
      changes: effects.changes,
      eventType: 'provider_operation_effect',
      referenceType: 'provider_operation',
      referenceId: movementReferenceId,
      metadata: { providerReferenceId: effects.referenceId },
    })
    const now = new Date()
    tx.insert(virtualOperationEffects)
      .values({
        virtualAccountId: accountId,
        providerReferenceId: effects.referenceId,
        movementReferenceId,
        changes: effects.changes.map(canonicalChange),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          virtualOperationEffects.virtualAccountId,
          virtualOperationEffects.providerReferenceId,
        ],
        set: {
          movementReferenceId,
          changes: effects.changes.map(canonicalChange),
          status: 'active',
          updatedAt: now,
        },
      })
      .run()
  })
}

const publicAccount = (
  row: typeof virtualAccounts.$inferSelect,
  role: 'read' | 'trade' | 'manage',
  category: PublicFinancialAccount['category'] = 'other',
  provider?: string,
): PublicFinancialAccount => {
  const trade =
    category === 'brokerage' &&
    role !== 'read' &&
    row.kind !== 'system' &&
    row.status === 'active' &&
    row.policy.tradingEnabled !== false
  return {
    id: row.id as FinancialAccountId,
    implementation: category === 'brokerage' ? 'virtual-brokerage' : 'passthrough-readonly',
    category,
    ...(provider ? { provider } : {}),
    label: row.label,
    kind: row.kind,
    status: row.status,
    capabilities: [
      'balances:read',
      'transactions:read',
      ...(category === 'brokerage' ? ['investments:read'] : []),
      ...(trade ? ['investments:trade'] : []),
    ],
    permissions: { read: true, trade, manage: role === 'manage' },
    ...(row.color ? { color: row.color } : {}),
    ...(row.icon ? { icon: row.icon } : {}),
    version: row.version,
  }
}

const physicalCategory = (kind: string): PublicFinancialAccount['category'] =>
  kind === 'brokerage' || kind === 'bank' ? kind : kind === 'transit-card' ? 'transit' : 'other'

export const listVirtualAccounts = async (
  db: Db,
  access: { owner: boolean; apiKeyId?: string },
) => {
  if (access.owner) {
    const rows = await db
      .select({
        account: virtualAccounts,
        physicalKind: financialAccounts.kind,
        connectorTypeId: financialAccounts.connectorTypeId,
      })
      .from(virtualAccounts)
      .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
      .where(ne(virtualAccounts.status, 'closed'))
    return rows.map(({ account, physicalKind, connectorTypeId }) =>
      publicAccount(account, 'manage', physicalCategory(physicalKind), connectorTypeId),
    )
  }
  if (!access.apiKeyId) return []
  const rows = await db
    .select({
      account: virtualAccounts,
      role: apiKeyVirtualAccounts.role,
      scopes: apiKeys.scopes,
      physicalKind: financialAccounts.kind,
      connectorTypeId: financialAccounts.connectorTypeId,
    })
    .from(apiKeyVirtualAccounts)
    .innerJoin(apiKeys, eq(apiKeys.id, apiKeyVirtualAccounts.apiKeyId))
    .innerJoin(virtualAccounts, eq(virtualAccounts.id, apiKeyVirtualAccounts.virtualAccountId))
    .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
    .where(
      and(
        eq(apiKeyVirtualAccounts.apiKeyId, access.apiKeyId),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ne(virtualAccounts.kind, 'system'),
        ne(virtualAccounts.status, 'closed'),
      ),
    )
  return rows
    .filter((row) => row.scopes === null || row.scopes.includes('read'))
    .map(({ account, role, physicalKind, connectorTypeId, scopes }) =>
      publicAccount(
        account,
        role === 'trade' && scopes !== null && !scopes.includes('trade') ? 'read' : role,
        physicalCategory(physicalKind),
        connectorTypeId,
      ),
    )
}

export const getVirtualAccount = async (
  db: Db,
  accountId: string,
  access: { owner: boolean; apiKeyId?: string },
) => {
  const account = (await listVirtualAccounts(db, access)).find((item) => item.id === accountId)
  if (!account) throw new Error('account not found')
  return account
}

export const getVirtualAccountTarget = async (
  db: Db,
  accountId: string,
  access: { owner: boolean; apiKeyId?: string },
) => {
  const account = await getVirtualAccount(db, accountId, access)
  const [target] = await db
    .select({
      physical: financialAccounts,
    })
    .from(virtualAccounts)
    .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
    .where(eq(virtualAccounts.id, accountId))
    .limit(1)
  if (!target) throw new Error('account target not found')
  return {
    account,
    physical: target.physical,
    physicalAccountId: target.physical.id,
    profileId: target.physical.profileId,
    providerAccountId: target.physical.providerAccountId,
  }
}

export const listDerivedUnallocatedAssets = (db: Db, physicalAccountId: string) => {
  const unallocated = db
    .select()
    .from(virtualAccounts)
    .where(
      and(
        eq(virtualAccounts.physicalAccountId, physicalAccountId),
        eq(virtualAccounts.systemRole, 'unallocated'),
      ),
    )
    .get()
  if (!unallocated) throw new Error('Unallocated account is missing')
  const physicalAssets = db
    .select()
    .from(physicalAccountAssets)
    .where(eq(physicalAccountAssets.physicalAccountId, physicalAccountId))
    .all()
  const allocatedRows = db
    .select({ asset: virtualAccountAssets })
    .from(virtualAccountAssets)
    .innerJoin(virtualAccounts, eq(virtualAccounts.id, virtualAccountAssets.virtualAccountId))
    .where(
      and(
        eq(virtualAccounts.physicalAccountId, physicalAccountId),
        ne(virtualAccounts.kind, 'system'),
        ne(virtualAccounts.status, 'closed'),
      ),
    )
    .all()
  const allocated = new Map<string, string>()
  for (const { asset } of allocatedRows) {
    const total = addDecimal(addDecimal(asset.available, asset.reserved), asset.pending)
    allocated.set(asset.assetKey, addDecimal(allocated.get(asset.assetKey) ?? '0', total))
  }
  const externalReserved = new Map<string, string>()
  for (const order of db
    .select()
    .from(externalOrderReservations)
    .where(
      and(
        eq(externalOrderReservations.physicalAccountId, physicalAccountId),
        ne(externalOrderReservations.state, 'closed'),
      ),
    )
    .all())
    for (const change of order.changes) {
      const assetKey = financialAssetKey(change.asset)
      externalReserved.set(
        assetKey,
        addDecimal(externalReserved.get(assetKey) ?? '0', change.reservedDelta),
      )
    }
  const physicalByKey = new Map(physicalAssets.map((asset) => [asset.assetKey, asset]))
  const keys = new Set([...physicalByKey.keys(), ...allocated.keys(), ...externalReserved.keys()])
  return [...keys].map((assetKey): VirtualAccountAsset => {
    const physical = physicalByKey.get(assetKey)
    return {
      accountId: unallocated.id as FinancialAccountId,
      assetKey,
      assetKind: physical?.assetKind ?? (assetKey.startsWith('cash:') ? 'cash' : 'security'),
      available: addDecimal(
        addDecimal(physical?.amount ?? '0', negateDecimal(allocated.get(assetKey) ?? '0')),
        negateDecimal(externalReserved.get(assetKey) ?? '0'),
      ),
      reserved: externalReserved.get(assetKey) ?? '0',
      pending: '0',
      version: unallocated.version,
      updatedAt: (physical?.updatedAt ?? unallocated.updatedAt).toISOString(),
    }
  })
}

export const reconcilePhysicalAccount = async (db: Db, physicalAccountId: string) => {
  const assets = listDerivedUnallocatedAssets(db, physicalAccountId)
  const deficits = assets.filter((asset) => compareDecimal(asset.available, '0') < 0)
  const unresolved = db
    .select()
    .from(virtualOrders)
    .where(eq(virtualOrders.physicalAccountId, physicalAccountId))
    .all()
    .filter((order) => ['submission_unknown', 'reconciliation_required'].includes(order.state))
  const externalUnknown =
    db
      .select()
      .from(externalOrderReservations)
      .where(
        and(
          eq(externalOrderReservations.physicalAccountId, physicalAccountId),
          eq(externalOrderReservations.state, 'needs_review'),
        ),
      )
      .all().length > 0
  const snapshotError =
    db
      .select()
      .from(appState)
      .where(eq(appState.key, `physical_snapshot_error:${physicalAccountId}`))
      .get() !== undefined
  db.transaction((tx) => {
    if (deficits.length || unresolved.length || externalUnknown || snapshotError) {
      for (const account of tx
        .select()
        .from(virtualAccounts)
        .where(eq(virtualAccounts.physicalAccountId, physicalAccountId))
        .all()) {
        if (['closed', 'reconciliation_required'].includes(account.status)) continue
        tx.update(virtualAccounts)
          .set({
            status: 'reconciliation_required',
            version: account.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(virtualAccounts.id, account.id))
          .run()
        tx.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.accountId, account.id)).run()
        tx.insert(accountAudit)
          .values({
            id: randomId('audit'),
            accountId: account.id,
            event: 'reconciliation.locked',
            detail: {
              previousStatus: account.status,
              deficitAssetKeys: deficits.map((asset) => asset.assetKey),
              orderIds: unresolved.map((order) => order.id),
              externalOrderReviewRequired: externalUnknown,
              snapshotError,
            },
            createdAt: new Date(),
          })
          .run()
      }
    }
  })
  const locked =
    db
      .select()
      .from(virtualAccounts)
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, physicalAccountId),
          eq(virtualAccounts.status, 'reconciliation_required'),
        ),
      )
      .get() !== undefined
  return {
    locked,
    deficits,
    assets,
    unresolvedOrderIds: unresolved.map((order) => order.id),
    externalUnknown,
    snapshotError,
  }
}

export const approvePhysicalAccountReconciliation = async (db: Db, physicalAccountId: string) => {
  const reconciliation = await reconcilePhysicalAccount(db, physicalAccountId)
  if (reconciliation.deficits.length)
    throw new Error('Unallocated assets must not be negative before unlocking')
  if (reconciliation.externalUnknown || reconciliation.snapshotError)
    throw new Error('resolve incomplete broker snapshots before unlocking')
  if (reconciliation.unresolvedOrderIds.length)
    throw new Error('resolve unknown orders before unlocking')
  db.transaction((tx) => {
    for (const account of tx
      .select()
      .from(virtualAccounts)
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, physicalAccountId),
          eq(virtualAccounts.status, 'reconciliation_required'),
        ),
      )
      .all()) {
      const lock = tx
        .select()
        .from(accountAudit)
        .where(
          and(
            eq(accountAudit.accountId, account.id),
            eq(accountAudit.event, 'reconciliation.locked'),
          ),
        )
        .orderBy(desc(accountAudit.createdAt))
        .get()
      tx.update(virtualAccounts)
        .set({
          status: lock?.detail.previousStatus === 'frozen' ? 'frozen' : 'active',
          version: account.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(virtualAccounts.id, account.id))
        .run()
      tx.insert(accountAudit)
        .values({
          id: randomId('audit'),
          accountId: account.id,
          event: 'reconciliation.approved',
          detail: { physicalAccountId },
          createdAt: new Date(),
        })
        .run()
    }
  })
  return { ok: true }
}

export const listVirtualAccountAssets = async (
  db: Db,
  accountId: string,
  access: { owner: boolean; apiKeyId?: string },
): Promise<VirtualAccountAsset[]> => {
  await getVirtualAccount(db, accountId, access)
  const [account] = await db
    .select()
    .from(virtualAccounts)
    .where(eq(virtualAccounts.id, accountId))
    .limit(1)
  if (!account) throw new Error('account not found')
  if (account.systemRole === 'unallocated') {
    return listDerivedUnallocatedAssets(db, account.physicalAccountId)
  }
  const rows = await db
    .select()
    .from(virtualAccountAssets)
    .where(eq(virtualAccountAssets.virtualAccountId, accountId))
  return rows.map((row) => ({
    accountId: row.virtualAccountId as FinancialAccountId,
    assetKey: row.assetKey,
    assetKind: row.assetKind,
    available: row.available,
    reserved: row.reserved,
    pending: row.pending,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

const createVirtualAccountSync = (
  db: Db,
  input: {
    physicalAccountId: string
    label: string
    kind: 'personal' | 'agent' | 'system'
    color?: string
    icon?: string
    policy?: Record<string, unknown>
    allocations?: Array<{
      fromAccountId: string
      assetKey: string
      amount: string
      expectedFromVersion: number
      reason: string
    }>
  },
) => {
  if (!input.physicalAccountId.trim() || !input.label.trim()) {
    throw new Error('physicalAccountId and label are required')
  }
  const physicalAccount = db
    .select({
      id: financialAccounts.id,
      kind: financialAccounts.kind,
      connectorTypeId: financialAccounts.connectorTypeId,
    })
    .from(financialAccounts)
    .where(eq(financialAccounts.id, input.physicalAccountId.trim()))
    .get()
  if (!physicalAccount) throw new Error('physical account not found')
  if (physicalAccount.kind !== 'brokerage') {
    if (
      input.kind !== 'personal' ||
      db
        .select()
        .from(virtualAccounts)
        .where(
          and(
            eq(virtualAccounts.physicalAccountId, physicalAccount.id),
            ne(virtualAccounts.kind, 'system'),
          ),
        )
        .get()
    )
      throw new Error('non-brokerage accounts support one read-only account')
  }
  const now = new Date()
  const row: typeof virtualAccounts.$inferInsert = {
    id: randomId('acct'),
    physicalAccountId: input.physicalAccountId.trim(),
    label: input.label.trim(),
    kind: input.kind,
    systemRole: input.kind === 'system' ? 'unallocated' : null,
    status: 'active',
    color: input.color,
    icon: input.icon,
    policy: input.policy
      ? validateAccountPolicy(input.policy)
      : { tradingEnabled: input.kind !== 'system' },
    createdAt: now,
    updatedAt: now,
  }
  db.insert(virtualAccounts).values(row).run()
  return publicAccount(
    db.select().from(virtualAccounts).where(eq(virtualAccounts.id, row.id)).get()!,
    'manage',
    physicalCategory(physicalAccount.kind),
    physicalAccount.connectorTypeId,
  )
}

export const createVirtualAccount = async (
  db: Db,
  input: Parameters<typeof createVirtualAccountSync>[1],
) =>
  db.transaction(() => {
    const account = createVirtualAccountSync(db, input)
    if (input.allocations?.length)
      transferVirtualAssets(
        db,
        input.allocations.map((allocation) => ({
          ...allocation,
          toAccountId: account.id,
          expectedToVersion: 0,
        })),
      )
    db.insert(accountAudit)
      .values({
        id: randomId('audit'),
        accountId: account.id,
        event: 'account.created',
        detail: { kind: account.kind },
        createdAt: new Date(),
      })
      .run()
    return account
  })

export const initializeVirtualAccounts = async (db: Db, physicalAccountId: string) => {
  const [physicalAccount] = await db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.id, physicalAccountId))
    .limit(1)
  if (!physicalAccount) throw new Error('physical account not found')
  const existing = await db
    .select()
    .from(virtualAccounts)
    .where(eq(virtualAccounts.physicalAccountId, physicalAccountId))
  if (existing.some((account) => account.systemRole === 'unallocated')) {
    throw new Error('virtual accounts are already initialized')
  }

  const now = new Date()
  const unallocatedId = randomId('acct')
  await db.insert(virtualAccounts).values({
    id: unallocatedId,
    physicalAccountId,
    label: 'Unallocated',
    kind: 'system',
    systemRole: 'unallocated',
    status: 'active',
    policy: { tradingEnabled: false },
    createdAt: now,
    updatedAt: now,
  })
  return {
    unallocated: await getVirtualAccount(db, unallocatedId, { owner: true }),
  }
}

export const ensureDefaultVirtualAccounts = async (
  db: Db,
  physicalAccountIds?: readonly string[],
) => {
  const allPhysical = await db.select({ id: financialAccounts.id }).from(financialAccounts)
  const physical = allPhysical.filter(
    (account) => !physicalAccountIds || physicalAccountIds.includes(account.id),
  )
  let created = 0
  for (const account of physical) {
    const existing = await db
      .select({ id: virtualAccounts.id })
      .from(virtualAccounts)
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, account.id),
          eq(virtualAccounts.systemRole, 'unallocated'),
        ),
      )
      .limit(1)
    if (existing.length) continue
    await initializeVirtualAccounts(db, account.id)
    created += 1
  }
  return { created }
}

export const listManagedVirtualAccounts = async (db: Db) => {
  const rows = await db
    .select({ account: virtualAccounts, physical: financialAccounts })
    .from(virtualAccounts)
    .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
    .where(ne(virtualAccounts.status, 'closed'))
    .orderBy(financialAccounts.createdAt, virtualAccounts.createdAt)
  return rows.map(({ account, physical }) => ({
    ...publicAccount(account, 'manage', physicalCategory(physical.kind), physical.connectorTypeId),
    physicalAccountId: physical.id,
    profileId: physical.profileId,
    providerAccountId: physical.providerAccountId,
    connectorTypeId: physical.connectorTypeId,
    physicalAccountKind: physical.kind,
    policy: account.policy,
  }))
}

export const listVirtualAccountInitializations = async (db: Db) => {
  const rows = await db
    .select({ physicalAccountId: virtualAccounts.physicalAccountId })
    .from(virtualAccounts)
    .groupBy(virtualAccounts.physicalAccountId)
  return rows.map((row) => row.physicalAccountId)
}

export const bindApiKeyToVirtualAccount = async (
  db: Db,
  apiKeyId: string,
  virtualAccountId: string,
  role: 'read' | 'trade',
) => {
  const account = await getVirtualAccount(db, virtualAccountId, { owner: true })
  if (account.kind === 'system') throw new Error('system accounts cannot be bound to API keys')
  const key = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), isNull(apiKeys.revokedAt)))
    .get()
  if (!key) throw new Error('API key not found')
  const otherBindings = db
    .select()
    .from(apiKeyVirtualAccounts)
    .where(
      and(
        eq(apiKeyVirtualAccounts.apiKeyId, apiKeyId),
        ne(apiKeyVirtualAccounts.virtualAccountId, virtualAccountId),
      ),
    )
    .all()
  if (
    (role === 'trade' && otherBindings.length) ||
    otherBindings.some((binding) => binding.role === 'trade')
  )
    throw new Error('a trade key must be bound to exactly one account')
  db.delete(virtualOrderQuotes)
    .where(
      and(
        eq(virtualOrderQuotes.accountId, virtualAccountId),
        eq(virtualOrderQuotes.principal, apiKeyId),
      ),
    )
    .run()
  db.insert(accountAudit)
    .values({
      id: randomId('audit'),
      accountId: virtualAccountId,
      event: 'access.bound',
      detail: { apiKeyId, role },
      createdAt: new Date(),
    })
    .run()
  await db
    .insert(apiKeyVirtualAccounts)
    .values({ apiKeyId, virtualAccountId, role, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [apiKeyVirtualAccounts.apiKeyId, apiKeyVirtualAccounts.virtualAccountId],
      set: { role },
    })
}

const transferVirtualAssetSync = (
  db: Db,
  input: {
    fromAccountId: string
    toAccountId: string
    assetKey: string
    amount: string
    expectedFromVersion: number
    expectedToVersion: number
    reason: string
  },
) => {
  const assetKey = normalizeAssetKey(input.assetKey)
  const amount = canonicalDecimal(input.amount)
  if (compareDecimal(amount, '0') <= 0) throw new Error('amount must be greater than zero')
  if (input.fromAccountId === input.toAccountId) throw new Error('accounts must be different')
  const accounts = db
    .select()
    .from(virtualAccounts)
    .where(inArray(virtualAccounts.id, [input.fromAccountId, input.toAccountId]))
    .all()
  if (accounts.length !== 2) throw new Error('account not found')
  if (new Set(accounts.map((account) => account.physicalAccountId)).size !== 1) {
    throw new Error('asset transfer requires accounts in the same physical account')
  }
  const fromAccount = accounts.find((account) => account.id === input.fromAccountId)!
  const toAccount = accounts.find((account) => account.id === input.toAccountId)!
  const remediation =
    toAccount.systemRole === 'unallocated' &&
    accounts.every(
      (account) => account.status === 'active' || account.status === 'reconciliation_required',
    )
  if (accounts.some((account) => account.status !== 'active') && !remediation) {
    throw new Error('asset transfer requires active accounts')
  }
  const rows = db
    .select()
    .from(virtualAccountAssets)
    .where(
      and(
        inArray(virtualAccountAssets.virtualAccountId, [input.fromAccountId, input.toAccountId]),
        eq(virtualAccountAssets.assetKey, assetKey),
      ),
    )
    .all()
  const storedFrom = rows.find((row) => row.virtualAccountId === input.fromAccountId)
  const existingTo = rows.find((row) => row.virtualAccountId === input.toAccountId)
  const derivedAssets =
    fromAccount.systemRole === 'unallocated' || toAccount.systemRole === 'unallocated'
      ? listDerivedUnallocatedAssets(db, fromAccount.physicalAccountId)
      : []
  const derived = derivedAssets.find((asset) => asset.assetKey === assetKey)
  const from =
    fromAccount.systemRole === 'unallocated'
      ? derived && {
          virtualAccountId: fromAccount.id,
          assetKey,
          assetKind: derived.assetKind,
          available: derived.available,
          reserved: '0',
          pending: '0',
          costBasis: null,
          version: derived.version,
          updatedAt: new Date(derived.updatedAt),
        }
      : storedFrom
  if (!from) throw new Error('source asset allocation not found')
  const to =
    toAccount.systemRole === 'unallocated'
      ? {
          virtualAccountId: toAccount.id,
          assetKey,
          assetKind: derived?.assetKind ?? (assetKey.startsWith('cash:') ? 'cash' : 'security'),
          available: derived?.available ?? '0',
          reserved: '0',
          pending: '0',
          costBasis: null,
          version: derived?.version ?? 0,
          updatedAt: new Date(derived?.updatedAt ?? 0),
        }
      : (existingTo ??
        ({
          virtualAccountId: input.toAccountId,
          assetKey,
          assetKind: assetKey.startsWith('cash:') ? 'cash' : 'security',
          available: '0',
          reserved: '0',
          pending: '0',
          costBasis: null,
          version: 0,
          updatedAt: new Date(0),
        } as const))
  if (from.version !== input.expectedFromVersion || to.version !== input.expectedToVersion) {
    throw new Error('asset version conflict')
  }
  if (compareDecimal(from.available, amount) < 0) throw new Error('insufficient available asset')
  const now = new Date()
  const referenceId = randomId('transfer')
  db.transaction((tx) => {
    const systemAccount =
      fromAccount.systemRole === 'unallocated'
        ? fromAccount
        : toAccount.systemRole === 'unallocated'
          ? toAccount
          : undefined
    if (systemAccount) {
      const systemVersion = tx
        .update(virtualAccounts)
        .set({ version: systemAccount.version + 1, updatedAt: now })
        .where(
          and(
            eq(virtualAccounts.id, systemAccount.id),
            eq(virtualAccounts.version, systemAccount.version),
          ),
        )
        .returning({ version: virtualAccounts.version })
        .get()
      if (!systemVersion) throw new Error('asset version conflict')
    }
    if (toAccount.systemRole !== 'unallocated' && !existingTo) {
      tx.insert(virtualAccountAssets).values(to).onConflictDoNothing().run()
    }
    if (fromAccount.systemRole !== 'unallocated') {
      const fromResult = tx
        .update(virtualAccountAssets)
        .set({
          available: addDecimal(from.available, `-${amount}`),
          version: from.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(virtualAccountAssets.virtualAccountId, from.virtualAccountId),
            eq(virtualAccountAssets.assetKey, assetKey),
            eq(virtualAccountAssets.version, from.version),
          ),
        )
        .returning({ version: virtualAccountAssets.version })
        .get()
      if (!fromResult) throw new Error('asset version conflict')
    }
    if (toAccount.systemRole !== 'unallocated') {
      const toResult = tx
        .update(virtualAccountAssets)
        .set({
          available: addDecimal(to.available, amount),
          version: to.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(virtualAccountAssets.virtualAccountId, to.virtualAccountId),
            eq(virtualAccountAssets.assetKey, assetKey),
            eq(virtualAccountAssets.version, to.version),
          ),
        )
        .returning({ version: virtualAccountAssets.version })
        .get()
      if (!toResult) throw new Error('asset version conflict')
    }
    tx.insert(virtualAssetMovements)
      .values([
        {
          id: randomId('movement'),
          virtualAccountId: from.virtualAccountId,
          assetKey,
          availableDelta: `-${amount}`,
          reservedDelta: '0',
          pendingDelta: '0',
          eventType: 'internal_transfer',
          referenceType: 'transfer',
          referenceId,
          metadata: { reason: input.reason, counterpartyAccountId: to.virtualAccountId },
          createdAt: now,
        },
        {
          id: randomId('movement'),
          virtualAccountId: to.virtualAccountId,
          assetKey,
          availableDelta: amount,
          reservedDelta: '0',
          pendingDelta: '0',
          eventType: 'internal_transfer',
          referenceType: 'transfer',
          referenceId,
          metadata: { reason: input.reason, counterpartyAccountId: from.virtualAccountId },
          createdAt: now,
        },
      ])
      .run()
  })
  return { id: referenceId }
}

export const transferVirtualAsset = async (...args: Parameters<typeof transferVirtualAssetSync>) =>
  transferVirtualAssetSync(...args)

export const updateVirtualAccount = async (
  db: Db,
  accountId: string,
  input: {
    expectedVersion: number
    label?: string
    policy?: Record<string, unknown>
    status?: 'active' | 'frozen' | 'closed'
  },
) => {
  const { virtualOrders, accountAudit, virtualOrderQuotes } = await import('./db/schema')
  db.transaction((tx) => {
    const account = tx.select().from(virtualAccounts).where(eq(virtualAccounts.id, accountId)).get()
    if (!account || account.status === 'closed' || account.kind === 'system')
      throw new Error('account cannot be modified')
    if (account.version !== input.expectedVersion) throw new Error('account version conflict')
    if (account.status === 'reconciliation_required' && input.status === 'active')
      throw new Error('reconciliation approval is required')
    if (input.status === 'closed') {
      const assets = tx
        .select()
        .from(virtualAccountAssets)
        .where(eq(virtualAccountAssets.virtualAccountId, accountId))
        .all()
      if (
        assets.some((asset) =>
          [asset.available, asset.reserved, asset.pending].some(
            (value) => compareDecimal(value, '0') !== 0,
          ),
        )
      )
        throw new Error('transfer all assets before closing the account')
      if (
        tx
          .select()
          .from(virtualOrders)
          .where(eq(virtualOrders.accountId, accountId))
          .all()
          .some((order) => !['filled', 'cancelled', 'rejected', 'expired'].includes(order.state))
      )
        throw new Error('account has unresolved orders')
    }
    if (input.label !== undefined && !input.label.trim()) throw new Error('label is required')
    tx.update(virtualAccounts)
      .set({
        ...(input.label ? { label: input.label.trim() } : {}),
        ...(input.policy ? { policy: validateAccountPolicy(input.policy) } : {}),
        ...(input.status ? { status: input.status } : {}),
        version: account.version + 1,
        updatedAt: new Date(),
        ...(input.status === 'closed' ? { closedAt: new Date() } : {}),
      })
      .where(eq(virtualAccounts.id, accountId))
      .run()
    tx.delete(virtualOrderQuotes).where(eq(virtualOrderQuotes.accountId, accountId)).run()
    tx.insert(accountAudit)
      .values({
        id: randomId('audit'),
        accountId,
        event: 'account.updated',
        detail: { ...input },
        createdAt: new Date(),
      })
      .run()
  })
  return { ok: true }
}

export const revokeAccountAccess = async (db: Db, apiKeyId: string, accountId: string) => {
  const { accountAudit, virtualOrderQuotes } = await import('./db/schema')
  db.transaction((tx) => {
    tx.delete(apiKeyVirtualAccounts)
      .where(
        and(
          eq(apiKeyVirtualAccounts.apiKeyId, apiKeyId),
          eq(apiKeyVirtualAccounts.virtualAccountId, accountId),
        ),
      )
      .run()
    tx.delete(virtualOrderQuotes)
      .where(
        and(
          eq(virtualOrderQuotes.accountId, accountId),
          eq(virtualOrderQuotes.principal, apiKeyId),
        ),
      )
      .run()
    tx.insert(accountAudit)
      .values({
        id: randomId('audit'),
        accountId,
        event: 'access.revoked',
        detail: { apiKeyId },
        createdAt: new Date(),
      })
      .run()
  })
  return { ok: true }
}

export const transferVirtualAssets = (
  db: Db,
  inputs: Array<Parameters<typeof transferVirtualAsset>[1]>,
) => {
  if (!inputs.length) throw new Error('select assets to transfer')
  if (
    new Set(inputs.map((input) => `${input.fromAccountId}:${input.toAccountId}:${input.assetKey}`))
      .size !== inputs.length
  )
    throw new Error('duplicate transfer asset')
  return db.transaction(() => {
    const systemVersions = new Map<string, number>()
    const increments = new Map<string, number>()
    for (const input of inputs) {
      for (const accountId of [input.fromAccountId, input.toAccountId]) {
        const account = db
          .select()
          .from(virtualAccounts)
          .where(eq(virtualAccounts.id, accountId))
          .get()
        if (account?.kind === 'system' && !systemVersions.has(accountId))
          systemVersions.set(accountId, account.version)
      }
    }
    return inputs.map((input) => {
      const adjusted = { ...input }
      for (const [field, id] of [
        ['expectedFromVersion', input.fromAccountId],
        ['expectedToVersion', input.toAccountId],
      ] as const) {
        if (systemVersions.has(id)) {
          if (input[field] !== systemVersions.get(id)) throw new Error('asset version conflict')
          adjusted[field] += increments.get(id) ?? 0
        }
      }
      const result = transferVirtualAssetSync(db, adjusted)
      for (const id of [input.fromAccountId, input.toAccountId])
        if (systemVersions.has(id)) increments.set(id, (increments.get(id) ?? 0) + 1)
      return result
    })
  })
}
