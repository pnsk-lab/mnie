import type {
  Account,
  Balance,
  FinancialAssetChange,
  FinancialProvider,
  InvestmentPosition,
  MethodMap,
  Page,
  Transaction,
} from '@mnie/types'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db'
import {
  financialAccounts,
  physicalAccountAssets,
  physicalPositionPrices,
  virtualAssetMovements,
  accountAudit,
  virtualAccountAssets,
  virtualAccounts,
} from './db/schema'
import type { OpenProvider, ProviderRegistry } from './providers/registry'
import { sha256, randomId } from './security/crypto'
import {
  canonicalDecimal,
  addDecimal,
  multiplyDecimal,
  ensureDefaultVirtualAccounts,
  financialAssetKey,
} from './virtual-accounts'

export const discoverPhysicalAccounts = async (
  db: Db,
  providers: ProviderRegistry,
  profileIds?: readonly string[],
  opened?: OpenProvider,
) => {
  const profiles = (await providers.profiles()).filter(
    (profile) => !profileIds || profileIds.includes(profile.id),
  )
  const physicalAccountIds: string[] = []
  const discovered = await Promise.all(
    profiles.map(async (profile) => {
      const discover = async ({ provider }: OpenProvider) => {
        const descriptor = providers.descriptor(profile)
        if (!provider.methods().includes('accounts.list')) {
          throw new Error(`${descriptor.provider.name} does not provide account discovery`)
        }
        const page = (await provider.invoke('accounts.list', {})) as Page<Account>
        const now = new Date()
        for (const account of page.items) {
          const id = `financial-account_${sha256(`${profile.id}:${account.id}`).slice(0, 32)}`
          physicalAccountIds.push(id)
          await db
            .insert(financialAccounts)
            .values({
              id,
              profileId: profile.id,
              connectorTypeId: profile.provider,
              institutionId: profile.provider,
              providerAccountId: account.id,
              kind: account.kind,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [financialAccounts.profileId, financialAccounts.providerAccountId],
              set: { kind: account.kind, updatedAt: now },
            })
        }
        return page.items
      }
      return opened?.profile.id === profile.id ? discover(opened) : providers.use(profile, discover)
    }),
  )
  return { discovered: discovered.flat().length, physicalAccountIds }
}

const balancePriority: Record<Balance['type'], number> = {
  current: 6,
  available: 5,
  withdrawable: 4,
  'buying-power': 3,
  collateral: 2,
  points: 1,
}

const latestTransactionBalance = (transactions: Transaction[]) => {
  const latestFirst = [...transactions].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  )
  for (const transaction of latestFirst) {
    if (transaction.balanceAfter?.kind === 'money') return transaction.balanceAfter.money
  }
  return undefined
}

export interface PhysicalAssetSnapshot {
  assetKey: string
  assetKind: 'cash' | 'security'
  amount: string
  price?: { currency: string; value: string }
  /** Total acquisition cost, used to derive unrealized profit/loss. */
  costBasis?: { currency: string; value: string }
  name?: string
}

const decimalOrUndefined = (value: string | undefined): string | undefined => {
  if (value == null) return undefined
  try {
    return canonicalDecimal(value)
  } catch {
    return undefined
  }
}

/**
 * Derives the total acquisition cost of a position. Prefers
 * marketValue - unrealizedProfitLoss (both totals) and falls back to
 * averagePrice * quantity. Returns undefined when the provider does not
 * report a usable cost basis instead of guessing.
 */
export const positionCostBasis = (
  position: Pick<
    InvestmentPosition,
    'quantity' | 'averagePrice' | 'marketValue' | 'unrealizedProfitLoss'
  >,
): { currency: string; value: string } | undefined => {
  const marketValue = position.marketValue
  const profitLoss = position.unrealizedProfitLoss
  if (marketValue && profitLoss && marketValue.currency === profitLoss.currency) {
    const market = decimalOrUndefined(marketValue.value)
    const profit = decimalOrUndefined(profitLoss.value)
    if (market != null && profit != null) {
      return {
        currency: marketValue.currency,
        value: addDecimal(market, profit.startsWith('-') ? profit.slice(1) : `-${profit}`),
      }
    }
  }
  const averagePrice = position.averagePrice
  const quantity = decimalOrUndefined(position.quantity)
  if (averagePrice && quantity != null) {
    const average = decimalOrUndefined(averagePrice.value)
    if (average != null) {
      return { currency: averagePrice.currency, value: multiplyDecimal(average, quantity) }
    }
  }
  return undefined
}

export const fetchPhysicalAccountAssets = async (
  provider: FinancialProvider<MethodMap>,
  physical: typeof financialAccounts.$inferSelect,
) => {
  const snapshotAssets: PhysicalAssetSnapshot[] = []
  if (provider.methods().includes('balances.list')) {
    const balances = (await provider.invoke('balances.list', {
      account: physical.providerAccountId,
    })) as Balance[]
    const selected = new Map<string, Balance>()
    for (const balance of balances) {
      if (balance.amount.kind !== 'money') continue
      const currency = balance.amount.money.currency.toUpperCase()
      const current = selected.get(currency)
      if (!current || balancePriority[balance.type] > balancePriority[current.type]) {
        selected.set(currency, balance)
      }
    }
    for (const [currency, balance] of selected) {
      if (balance.amount.kind !== 'money') continue
      snapshotAssets.push({
        assetKey: `cash:${currency}`,
        assetKind: 'cash',
        amount: canonicalDecimal(balance.amount.money.value),
      })
    }
  } else if (provider.methods().includes('transactions.list')) {
    const page = (await provider.invoke('transactions.list', {
      account: physical.providerAccountId,
    })) as Page<Transaction>
    const balance = latestTransactionBalance(page.items)
    if (!balance) throw new Error('Provider did not return a balance')
    snapshotAssets.push({
      assetKey: `cash:${balance.currency.toUpperCase()}`,
      assetKind: 'cash',
      amount: canonicalDecimal(balance.value),
    })
  }
  if (provider.methods().includes('investments.positions.list')) {
    const page = (await provider.invoke('investments.positions.list', {
      account: physical.providerAccountId,
      positionType: 'cash',
    })) as Page<InvestmentPosition>
    for (const position of page.items) {
      if (position.positionType !== 'cash') continue
      snapshotAssets.push({
        assetKey: financialAssetKey({
          kind: 'security',
          instrumentId: position.instrumentId,
          venue: position.venue ?? position.market ?? '',
          positionType: 'cash',
          ...(position.accountType ? { accountType: position.accountType } : {}),
        }),
        assetKind: 'security',
        amount: canonicalDecimal(position.quantity),
        price: position.currentPrice,
        costBasis: positionCostBasis(position),
        name: position.instrumentName,
      })
    }
  }
  if (!snapshotAssets.length) throw new Error('Provider did not return physical assets')
  return snapshotAssets
}

export const updatePhysicalAccountAssetCache = async (
  db: Db,
  physicalAccountId: string,
  snapshotAssets: PhysicalAssetSnapshot[],
) => {
  const cached = await db
    .select()
    .from(physicalAccountAssets)
    .where(eq(physicalAccountAssets.physicalAccountId, physicalAccountId))
  const snapshotKeys = new Set(snapshotAssets.map((asset) => asset.assetKey))
  const [unallocated] = await db
    .select({ id: virtualAccounts.id })
    .from(virtualAccounts)
    .where(
      and(
        eq(virtualAccounts.physicalAccountId, physicalAccountId),
        eq(virtualAccounts.systemRole, 'unallocated'),
      ),
    )
    .limit(1)
  const now = new Date()
  db.transaction((tx) => {
    if (unallocated) {
      tx.delete(virtualAccountAssets)
        .where(eq(virtualAccountAssets.virtualAccountId, unallocated.id))
        .run()
    }
    if (unallocated) {
      const changes = [
        ...snapshotAssets,
        ...cached
          .filter((asset) => !snapshotKeys.has(asset.assetKey))
          .map((asset) => ({ ...asset, amount: '0' })),
      ]
      for (const asset of changes) {
        const old = cached.find((row) => row.assetKey === asset.assetKey)?.amount ?? '0'
        const delta = addDecimal(asset.amount, old.startsWith('-') ? old.slice(1) : `-${old}`)
        if (delta === '0') continue
        const referenceId = randomId('external')
        tx.insert(virtualAssetMovements)
          .values({
            id: randomId('movement'),
            virtualAccountId: unallocated.id,
            assetKey: asset.assetKey,
            availableDelta: delta,
            reservedDelta: '0',
            pendingDelta: '0',
            eventType: 'external_snapshot_change',
            referenceType: 'physical_snapshot',
            referenceId,
            metadata: { previous: old, current: asset.amount },
            createdAt: now,
          })
          .run()
        tx.insert(accountAudit)
          .values({
            id: randomId('audit'),
            accountId: unallocated.id,
            event: 'external_activity.detected',
            detail: { assetKey: asset.assetKey, delta, referenceId },
            createdAt: now,
          })
          .run()
      }
    }
    for (const asset of snapshotAssets) {
      if (asset.price)
        tx.insert(physicalPositionPrices)
          .values({
            physicalAccountId,
            assetKey: asset.assetKey,
            price: asset.price,
            costBasis: asset.costBasis,
            name: asset.name,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [physicalPositionPrices.physicalAccountId, physicalPositionPrices.assetKey],
            set: {
              price: asset.price,
              costBasis: asset.costBasis,
              name: asset.name,
              updatedAt: now,
            },
          })
          .run()

      const existing = cached.find((item) => item.assetKey === asset.assetKey)
      tx.insert(physicalAccountAssets)
        .values({
          physicalAccountId,
          assetKey: asset.assetKey,
          assetKind: asset.assetKind,
          amount: asset.amount,
          version: (existing?.version ?? 0) + 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [physicalAccountAssets.physicalAccountId, physicalAccountAssets.assetKey],
          set: {
            assetKind: asset.assetKind,
            amount: asset.amount,
            version: (existing?.version ?? 0) + 1,
            updatedAt: now,
          },
        })
        .run()
    }
    for (const missing of cached.filter((asset) => !snapshotKeys.has(asset.assetKey))) {
      tx.update(physicalAccountAssets)
        .set({ amount: '0', version: missing.version + 1, updatedAt: now })
        .where(
          and(
            eq(physicalAccountAssets.physicalAccountId, physicalAccountId),
            eq(physicalAccountAssets.assetKey, missing.assetKey),
          ),
        )
        .run()
    }
    tx.update(virtualAccounts)
      .set({
        version: sql`${virtualAccounts.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, physicalAccountId),
          eq(virtualAccounts.systemRole, 'unallocated'),
        ),
      )
      .run()
  })
}

export const refreshPhysicalAccountAssets = async (
  db: Db,
  provider: FinancialProvider<MethodMap>,
  physical: typeof financialAccounts.$inferSelect,
) => {
  const assets = await fetchPhysicalAccountAssets(provider, physical)
  await updatePhysicalAccountAssetCache(db, physical.id, assets)
  return assets
}

export const applyPhysicalAccountAssetChanges = (
  db: Db,
  physicalAccountId: string,
  changes: FinancialAssetChange[],
) => {
  const totals = new Map<string, { assetKind: 'cash' | 'security'; amountDelta: string }>()
  for (const change of changes) {
    const assetKey = financialAssetKey(change.asset)
    const amountDelta = addDecimal(
      addDecimal(change.availableDelta, change.reservedDelta),
      change.pendingDelta,
    )
    const current = totals.get(assetKey)
    totals.set(assetKey, {
      assetKind: change.asset.kind,
      amountDelta: addDecimal(current?.amountDelta ?? '0', amountDelta),
    })
  }
  if (![...totals.values()].some((change) => change.amountDelta !== '0')) return
  const cached = db
    .select()
    .from(physicalAccountAssets)
    .where(eq(physicalAccountAssets.physicalAccountId, physicalAccountId))
    .all()
  const now = new Date()
  db.transaction((tx) => {
    for (const [assetKey, change] of totals) {
      if (change.amountDelta === '0') continue
      const existing = cached.find((asset) => asset.assetKey === assetKey)
      const amount = addDecimal(existing?.amount ?? '0', change.amountDelta)
      tx.insert(physicalAccountAssets)
        .values({
          physicalAccountId,
          assetKey,
          assetKind: change.assetKind,
          amount,
          version: (existing?.version ?? 0) + 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [physicalAccountAssets.physicalAccountId, physicalAccountAssets.assetKey],
          set: { amount, version: (existing?.version ?? 0) + 1, updatedAt: now },
        })
        .run()
    }
    tx.update(virtualAccounts)
      .set({ version: sql`${virtualAccounts.version} + 1`, updatedAt: now })
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, physicalAccountId),
          eq(virtualAccounts.systemRole, 'unallocated'),
        ),
      )
      .run()
  })
}

export const syncInitialUnallocatedAssets = async (
  db: Db,
  providers: ProviderRegistry,
  physicalAccountIds?: readonly string[],
  opened?: OpenProvider,
) => {
  const allPhysicalAccounts = await db.select().from(financialAccounts)
  const physicalAccounts = allPhysicalAccounts.filter(
    (account) => !physicalAccountIds || physicalAccountIds.includes(account.id),
  )
  let synced = 0
  const errors: Array<{ profileId: string; message: string }> = []
  for (const physical of physicalAccounts) {
    const [unallocated] = await db
      .select()
      .from(virtualAccounts)
      .where(
        and(
          eq(virtualAccounts.physicalAccountId, physical.id),
          eq(virtualAccounts.systemRole, 'unallocated'),
        ),
      )
      .limit(1)
    if (!unallocated) throw new Error(`Unallocated account is missing for ${physical.id}`)

    try {
      const sync = async ({ provider }: OpenProvider) => {
        const snapshotAssets = await refreshPhysicalAccountAssets(db, provider, physical)
        synced += snapshotAssets.length
      }
      if (opened?.profile.id === physical.profileId) await sync(opened)
      else await providers.use(physical.profileId, sync)
    } catch (cause) {
      errors.push({
        profileId: physical.profileId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  return { synced, errors }
}

export const provisionProfileAccounts = async (
  db: Db,
  providers: ProviderRegistry,
  profileId: string,
  opened?: OpenProvider,
) => {
  const discovery = await discoverPhysicalAccounts(db, providers, [profileId], opened)
  const defaults = await ensureDefaultVirtualAccounts(db, discovery.physicalAccountIds)
  const assets = await syncInitialUnallocatedAssets(
    db,
    providers,
    discovery.physicalAccountIds,
    opened,
  )
  if (assets.errors.length) {
    throw new Error(assets.errors.map((error) => error.message).join('; '))
  }
  return { ...discovery, ...defaults, ...assets }
}
