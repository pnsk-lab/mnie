import { expect, test } from 'bun:test'
import type { InvestmentOrder } from '@mnie/types'
import { createDb } from './db'
import {
  financialAccounts,
  physicalAccountAssets,
  virtualAccountAssets,
  virtualAssetMovements,
} from './db/schema'
import {
  createVirtualAccount,
  initializeVirtualAccounts,
  listDerivedUnallocatedAssets,
  listVirtualAccountAssets,
  reconcilePhysicalAccount,
} from './virtual-accounts'
import { syncExternalOrderReservations } from './external-order-reservations'

const fixture = async () => {
  const db = createDb(':memory:')
  const now = new Date()
  db.insert(financialAccounts)
    .values({
      id: 'physical',
      profileId: 'profile',
      connectorTypeId: 'test',
      institutionId: 'test',
      providerAccountId: 'private',
      kind: 'brokerage',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  await initializeVirtualAccounts(db, 'physical')
  db.insert(physicalAccountAssets)
    .values({
      physicalAccountId: 'physical',
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      amount: '100',
      version: 1,
      updatedAt: now,
    })
    .run()
  const personal = await createVirtualAccount(db, {
    physicalAccountId: 'physical',
    label: 'Personal',
  })
  db.insert(virtualAccountAssets)
    .values({
      virtualAccountId: personal.id,
      assetKey: 'cash:JPY',
      assetKind: 'cash',
      available: '60',
      reserved: '0',
      pending: '0',
      version: 1,
      updatedAt: now,
    })
    .run()
  return { db, personal }
}

const order = (reserved?: string): InvestmentOrder => ({
  id: 'external',
  accountId: 'private',
  instrumentId: 'test',
  side: 'buy',
  status: 'open',
  ...(reserved === undefined
    ? {}
    : {
        effects: {
          referenceId: 'external',
          changes: [
            {
              asset: { kind: 'cash', currency: 'JPY' },
              availableDelta: `-${reserved}`,
              reservedDelta: reserved,
              pendingDelta: '0',
            },
          ],
        },
      }),
})

test('external orders reserve only Unallocated, deduplicate, and release on a complete snapshot', async () => {
  const { db, personal } = await fixture()
  const snapshot = { items: [order('30')], complete: true }
  syncExternalOrderReservations(db, 'physical', snapshot)
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '10',
    reserved: '30',
  })
  expect((await listVirtualAccountAssets(db, personal.id, { owner: true }))[0]?.available).toBe(
    '60',
  )
  expect((await reconcilePhysicalAccount(db, 'physical')).locked).toBe(false)
  const count = db.select().from(virtualAssetMovements).all().length
  syncExternalOrderReservations(db, 'physical', snapshot)
  expect(db.select().from(virtualAssetMovements).all()).toHaveLength(count)
  expect(() => syncExternalOrderReservations(db, 'physical', { items: [] })).toThrow('complete')
  syncExternalOrderReservations(db, 'physical', { items: [], complete: true })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '40',
    reserved: '0',
  })
})

test('external deficits freeze accounts and missing evidence preserves previous reservations', async () => {
  const { db } = await fixture()
  syncExternalOrderReservations(db, 'physical', { items: [order('50')], complete: true })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]?.available).toBe('-10')
  expect((await reconcilePhysicalAccount(db, 'physical')).locked).toBe(true)
  syncExternalOrderReservations(db, 'physical', { items: [order()], complete: true })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]?.reserved).toBe('50')
  expect((await reconcilePhysicalAccount(db, 'physical')).locked).toBe(true)
})

test('missing external reservation evidence freezes accounts without inventing amounts', async () => {
  const { db } = await fixture()
  syncExternalOrderReservations(db, 'physical', { items: [order()], complete: true })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '40',
    reserved: '0',
  })
  expect((await reconcilePhysicalAccount(db, 'physical')).locked).toBe(true)
})

test('partial open-order snapshot attributes observed orders while preserving unobserved reservations', async () => {
  const { db } = await fixture()
  // Initially an external order reserves 20 JPY.
  syncExternalOrderReservations(db, 'physical', { items: [order('20')], complete: true })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '20',
    reserved: '20',
  })

  // Partial snapshot (e.g. domestic only while US timed out) observes a new domestic order of 10 JPY
  // and does not include the earlier order; the earlier reservation must stay locked fail-closed.
  const domesticExternal: InvestmentOrder = {
    ...order('10'),
    id: 'domestic-ext-2',
    effects: {
      referenceId: 'domestic-ext-2',
      changes: [
        {
          asset: { kind: 'cash', currency: 'JPY' },
          availableDelta: '-10',
          reservedDelta: '10',
          pendingDelta: '0',
        },
      ],
    },
  }
  syncExternalOrderReservations(db, 'physical', {
    items: [domesticExternal],
    complete: false,
    completeVenues: ['XTKS'],
  })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '10',
    reserved: '30',
  })

  // Once a globally complete snapshot returns only the domestic order, the absent order is released.
  syncExternalOrderReservations(db, 'physical', {
    items: [domesticExternal],
    complete: true,
  })
  expect(listDerivedUnallocatedAssets(db, 'physical')[0]).toMatchObject({
    available: '30',
    reserved: '10',
  })
})
