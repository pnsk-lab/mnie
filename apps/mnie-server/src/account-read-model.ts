import type { Transaction, HistoryItem } from '@mnie/types'
import { sha256 } from './security/crypto'
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { Db } from './db'
import {
  accountAudit,
  virtualAssetMovements,
  virtualOrders,
  physicalPositionPrices,
  virtualAccounts,
  financialAccounts,
  historyTransactions,
  virtualAccountSnapshots,
} from './db/schema'
import type { AccountAccess } from './account-policy'
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  listVirtualAccountAssets,
  listVirtualAccounts,
} from './virtual-accounts'
import { publicOrder } from './order-coordinator'

export const accountSelection = async (
  db: Db,
  access: AccountAccess,
  input: Record<string, unknown> = {},
) => {
  const accessible = await listVirtualAccounts(db, access)
  const accessibleIds = new Set<string>(accessible.map((account) => account.id as string))
  let requested: string[] | undefined
  if (typeof input.account === 'string') requested = [input.account]
  else if (Array.isArray(input.accounts)) requested = input.accounts as string[]
  else if (Array.isArray(input.profiles)) {
    const rows = db
      .select({ id: virtualAccounts.id, profileId: financialAccounts.profileId })
      .from(virtualAccounts)
      .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
      .all()
    const profiles = input.profiles as string[]
    requested = rows
      .filter((row) => profiles.includes(row.profileId) && accessibleIds.has(row.id as string))
      .map((row) => row.id as string)
    return accessible.filter((account) => requested!.includes(account.id as string))
  }
  if (
    requested !== undefined &&
    (!Array.isArray(requested) ||
      requested.some((id) => typeof id !== 'string' || !accessibleIds.has(id)))
  )
    throw new Error('account not found')
  return accessible.filter((account) => !requested || (requested as string[]).includes(account.id))
}

export const accountPositions = async (db: Db, accountId: string, access: AccountAccess) => {
  const assets = await listVirtualAccountAssets(db, accountId, access)
  const account = db.select().from(virtualAccounts).where(eq(virtualAccounts.id, accountId)).get()!
  const prices = db
    .select()
    .from(physicalPositionPrices)
    .where(eq(physicalPositionPrices.physicalAccountId, account.physicalAccountId))
    .all()
  return assets
    .filter((asset) => asset.assetKind === 'security')
    .map((asset) => {
      const [, instrumentId, venue, , accountType] = asset.assetKey.split(':')
      const price = prices.find((row) => row.assetKey === asset.assetKey)
      const quantity = addDecimal(addDecimal(asset.available, asset.reserved), asset.pending)
      const marketValue = price
        ? { currency: price.price.currency, value: multiplyDecimal(quantity, price.price.value) }
        : undefined
      const costBasis = price?.costBasis
      const unrealizedProfitLoss =
        marketValue && costBasis && costBasis.currency === marketValue.currency
          ? {
              currency: marketValue.currency,
              value: addDecimal(
                marketValue.value,
                costBasis.value.startsWith('-') ? costBasis.value.slice(1) : `-${costBasis.value}`,
              ),
            }
          : undefined
      return {
        id: `position_${accountId}_${encodeURIComponent(asset.assetKey)}`,
        accountId,
        instrumentId: instrumentId!,
        venue: venue!,
        positionType: 'cash' as const,
        accountType,
        quantity,
        instrumentName: price?.name ?? instrumentId,
        currentPrice: price?.price,
        marketValue,
        unrealizedProfitLoss,
        availableQuantity: asset.available,
        reservedQuantity: asset.reserved,
        pendingQuantity: asset.pending,
      }
    })
    .filter((position) => position.quantity !== '0')
}
export const accountBalances = async (db: Db, accountId: string, access: AccountAccess) =>
  (await listVirtualAccountAssets(db, accountId, access))
    .filter(
      (asset) =>
        asset.assetKind === 'cash' &&
        addDecimal(addDecimal(asset.available, asset.reserved), asset.pending) !== '0',
    )
    .flatMap((asset) => [
      {
        accountId,
        type: 'current' as const,
        amount: {
          kind: 'money' as const,
          money: {
            currency: asset.assetKey.slice(5),
            value: addDecimal(addDecimal(asset.available, asset.reserved), asset.pending),
          },
        },
        asOf: asset.updatedAt,
      },
      {
        accountId,
        type: 'available' as const,
        amount: {
          kind: 'money' as const,
          money: { currency: asset.assetKey.slice(5), value: asset.available },
        },
        asOf: asset.updatedAt,
      },
    ])

export const accountOrders = async (db: Db, accountId: string, access: AccountAccess) => {
  await accountSelection(db, access, { account: accountId })
  return db
    .select()
    .from(virtualOrders)
    .where(eq(virtualOrders.accountId, accountId))
    .all()
    .filter((order) => !order.request.parentId)
    .map(publicOrder)
}

type PublicHistoryItem = {
  kind: 'transaction'
  profileId: string
  accountId: string
  occurredAt: string
  transaction: Transaction & {
    assetKey?: string
    availableDelta?: string
    reservedDelta?: string
    pendingDelta?: string
  }
}

export const accountHistory = async (
  db: Db,
  access: AccountAccess,
  input: Record<string, unknown>,
) => {
  const accounts = await accountSelection(db, access, input)
  const from = input.from ? new Date(String(input.from)) : new Date(0)
  const to = input.to ? new Date(String(input.to)) : new Date()
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to)
    throw new Error('invalid history range')
  if (!accounts.length) return { items: [], errors: [] }
  const rows = db
    .select()
    .from(virtualAssetMovements)
    .where(
      and(
        inArray(
          virtualAssetMovements.virtualAccountId,
          accounts.map((account) => account.id),
        ),
        gte(virtualAssetMovements.createdAt, from),
        lte(virtualAssetMovements.createdAt, to),
      ),
    )
    .orderBy(asc(virtualAssetMovements.createdAt))
    .all()
  const items: Array<HistoryItem & { accountId?: string }> = rows.map<PublicHistoryItem>((row) => {
    const delta = addDecimal(addDecimal(row.availableDelta, row.reservedDelta), row.pendingDelta)
    return {
      kind: 'transaction',
      profileId: row.virtualAccountId,
      accountId: row.virtualAccountId,
      occurredAt: row.createdAt.toISOString(),
      transaction: {
        id: row.id,
        accountId: row.virtualAccountId,
        kind: 'other',
        direction:
          compareDecimal(delta, '0') < 0
            ? 'debit'
            : compareDecimal(delta, '0') > 0
              ? 'credit'
              : 'neutral',
        status: 'posted',
        amount: row.assetKey.startsWith('cash:')
          ? {
              kind: 'money',
              money: { currency: row.assetKey.slice(5), value: delta.replace(/^-/, '') },
            }
          : null,
        occurredAt: row.createdAt.toISOString(),
        description: row.eventType,
        assetKey: row.assetKey,
        availableDelta: row.availableDelta,
        reservedDelta: row.reservedDelta,
        pendingDelta: row.pendingDelta,
      },
    }
  })
  for (const account of accounts.filter(
    (item) => item.category !== 'brokerage' && item.kind !== 'system',
  )) {
    const physical = db
      .select({ physical: financialAccounts })
      .from(virtualAccounts)
      .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
      .where(eq(virtualAccounts.id, account.id))
      .get()!.physical
    const rows = db
      .select()
      .from(historyTransactions)
      .where(
        and(
          eq(historyTransactions.profileId, physical.profileId),
          gte(historyTransactions.occurredAt, from),
          lte(historyTransactions.occurredAt, to),
        ),
      )
      .all()
    for (const row of rows) {
      const transaction = row.transaction as import('@mnie/types').Transaction
      if (transaction.accountId !== physical.providerAccountId) continue
      const publicTransaction = {
        ...transaction,
        id: `transaction_${sha256(`${account.id}:${row.transactionId}`)}`,
        accountId: account.id,
      }
      const fields = new Set([
        'id',
        'accountId',
        'kind',
        'direction',
        'status',
        'amount',
        'occurredAt',
        'description',
        'balanceAfter',
        'merchant',
        'counterparty',
        'transit',
        'charge',
        'reward',
        'investment',
      ])
      for (const field of Object.keys(publicTransaction))
        if (!fields.has(field)) Reflect.deleteProperty(publicTransaction, field)
      items.push({
        kind: 'transaction',
        profileId: account.id,
        accountId: account.id,
        occurredAt: row.occurredAt.toISOString(),
        transaction: publicTransaction,
      })
    }
  }
  const kinds = Array.isArray(input.kinds) ? input.kinds : ['transaction', 'snapshot']
  if (kinds.includes('snapshot')) {
    const snapshots = db
      .select()
      .from(virtualAccountSnapshots)
      .where(
        and(
          inArray(
            virtualAccountSnapshots.accountId,
            accounts.map((account) => account.id),
          ),
          gte(virtualAccountSnapshots.capturedAt, from),
          lte(virtualAccountSnapshots.capturedAt, to),
        ),
      )
      .all()
    for (const snapshot of snapshots)
      items.push({
        kind: 'snapshot',
        profileId: snapshot.accountId,
        accountId: snapshot.accountId,
        occurredAt: snapshot.capturedAt.toISOString(),
        snapshot: snapshot.snapshot,
      })
  }
  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  return { items: items.filter((item) => kinds.includes(item.kind)), errors: [] }
}

export const accountActivity = async (db: Db, accountId: string, access: AccountAccess) => {
  await accountSelection(db, access, { account: accountId })
  return {
    items: db.select().from(accountAudit).where(eq(accountAudit.accountId, accountId)).all(),
  }
}

const publicProvider = (db: Db, accountId: string) => {
  const row = db
    .select({ providerId: financialAccounts.connectorTypeId })
    .from(virtualAccounts)
    .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
    .where(eq(virtualAccounts.id, accountId))
    .get()
  if (!row) throw new Error('account not found')
  return { id: row.providerId, name: row.providerId }
}

export const accountOverview = async (
  db: Db,
  access: AccountAccess,
  input: Record<string, unknown>,
  providerColors?: ReadonlyMap<string, string>,
) => {
  const accounts = await accountSelection(db, access, input)
  const components = await Promise.all(
    accounts.map(async (account) => {
      const provider = publicProvider(db, account.id)
      return {
        profile: {
          id: account.id,
          provider,
          label: account.label,
          category: account.category,
          defaultColor: account.color ?? providerColors?.get(provider.id) ?? '#9aa0a9',
        },
        accounts: [
          {
            id: account.id,
            providerId: 'mnie',
            kind: account.category === 'transit' ? 'transit-card' : account.category,
            name: account.label,
          },
        ],
        balances: await accountBalances(db, account.id, access),
        positions: await accountPositions(db, account.id, access),
        orders: await accountOrders(db, account.id, access),
        valuation: await (async () => {
          const balances = await accountBalances(db, account.id, access)
          const positions = await accountPositions(db, account.id, access)
          const cash = balances.filter((balance) => balance.type === 'current')
          const currency = cash[0]?.amount.money.currency ?? positions[0]?.marketValue?.currency
          if (
            !currency ||
            cash.some((balance) => balance.amount.money.currency !== currency) ||
            positions.some(
              (position) => !position.marketValue || position.marketValue.currency !== currency,
            )
          )
            return undefined
          const cashValue = cash.reduce(
            (sum, balance) => addDecimal(sum, balance.amount.money.value),
            '0',
          )
          const holdingsValue = positions.reduce(
            (sum, position) => addDecimal(sum, position.marketValue!.value),
            '0',
          )
          return {
            amount: { currency, value: addDecimal(cashValue, holdingsValue) },
            cashAmount: { currency, value: cashValue },
            holdingsAmount: { currency, value: holdingsValue },
            asOf: new Date().toISOString(),
          }
        })(),
      }
    }),
  )
  const errors = components
    .filter(
      (component) =>
        !component.valuation && (component.positions.length || component.balances.length),
    )
    .map((component) => ({
      profileId: component.profile.id,
      providerId: component.profile.provider.id,
      operation: 'assets.valuation.get',
      message: 'current prices or explicit currency conversion are required for this account',
    }))
  return { components, errors, asOf: new Date().toISOString() }
}

export const accountValuation = async (
  db: Db,
  access: AccountAccess,
  input: Record<string, unknown>,
) => {
  const accounts = await accountSelection(db, access, input)
  const currency = String(input.baseCurrency ?? 'JPY')
  const components = []
  for (const account of accounts) {
    const assets = await listVirtualAccountAssets(db, account.id, access)
    const positions = await accountPositions(db, account.id, access)
    if (
      assets.some(
        (asset) =>
          asset.assetKind === 'cash' &&
          asset.assetKey !== `cash:${currency}` &&
          addDecimal(addDecimal(asset.available, asset.reserved), asset.pending) !== '0',
      ) ||
      positions.some(
        (position) => !position.marketValue || position.marketValue.currency !== currency,
      )
    )
      throw new Error(
        'account valuation requires current security prices and explicit currency conversion',
      )
    const cash = assets
      .filter((asset) => asset.assetKind === 'cash')
      .reduce(
        (sum, asset) =>
          addDecimal(sum, addDecimal(addDecimal(asset.available, asset.reserved), asset.pending)),
        '0',
      )
    const value = positions.reduce(
      (sum, position) => addDecimal(sum, position.marketValue!.value),
      cash,
    )
    components.push({
      profileId: account.id,
      providerId: 'mnie',
      label: account.label,
      originalAmount: { currency, value },
      convertedAmount: { currency, value },
      asOf: new Date().toISOString(),
    })
  }
  return {
    baseCurrency: currency,
    total: {
      currency,
      value: components.reduce(
        (sum, component) => addDecimal(sum, component.convertedAmount.value),
        '0',
      ),
    },
    components,
    errors: [],
    completeness: 'complete',
    asOf: new Date().toISOString(),
  }
}

export const saveAccountSnapshots = async (db: Db, accountIds: string[]) => {
  if (!accountIds.length) return
  const overview = await accountOverview(db, { owner: true }, { accounts: accountIds })
  const capturedAt = new Date()
  db.transaction((tx) => {
    for (const component of overview.components)
      tx.insert(virtualAccountSnapshots)
        .values({
          accountId: component.profile.id,
          capturedAt,
          snapshot: {
            accountId: component.profile.id,
            capturedAt: capturedAt.toISOString(),
            balances: component.balances,
            positions: component.positions,
            valuation: component.valuation,
          },
        })
        .run()
  })
}
