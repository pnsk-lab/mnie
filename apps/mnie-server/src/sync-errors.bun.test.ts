import { describe, expect, test } from 'bun:test'
import { createDb } from './db'
import { appState } from './db/schema'
import {
  blockingSyncErrorsForTrade,
  clearLegacyPhysicalSyncError,
  clearPhysicalSyncError,
  clearPhysicalSyncErrorsByPrefix,
  formatBlockingSyncError,
  hasUnscopedPhysicalSyncError,
  listPhysicalSyncErrors,
  setPhysicalSyncError,
} from './sync-errors'

describe('scoped sync errors', () => {
  test('isolates physical account IDs containing SQLite LIKE underscore wildcards', () => {
    const db = createDb(':memory:')
    setPhysicalSyncError(db, 'financial-account_abc', {
      stage: 'open_orders',
      scope: 'open_orders:us',
      reason: 'timeout',
      venues: ['XNAS', 'XNYS', 'ARCX'],
    })
    setPhysicalSyncError(db, 'financial-accountXabc', {
      stage: 'physical_assets',
      scope: 'physical_assets',
      reason: 'maintenance',
      code: 'ECOMN0004',
    })

    expect(listPhysicalSyncErrors(db, 'financial-account_abc')).toEqual([
      expect.objectContaining({
        stage: 'open_orders',
        scope: 'open_orders:us',
        reason: 'timeout',
        venues: ['XNAS', 'XNYS', 'ARCX'],
      }),
    ])
    expect(listPhysicalSyncErrors(db, 'financial-accountXabc')).toEqual([
      expect.objectContaining({
        stage: 'physical_assets',
        scope: 'physical_assets',
        reason: 'maintenance',
        code: 'ECOMN0004',
      }),
    ])
  })

  test('parses legacy unscoped keys fail-closed and clears them cleanly', () => {
    const db = createDb(':memory:')
    db.insert(appState)
      .values({
        key: 'physical_snapshot_error:phys-1',
        value: 'BROKER_SNAPSHOT_UNAVAILABLE',
        updatedAt: new Date(),
      })
      .run()

    const errors = listPhysicalSyncErrors(db, 'phys-1')
    expect(errors).toEqual([
      expect.objectContaining({
        stage: 'physical_assets',
        scope: 'legacy',
        reason: 'unknown',
      }),
    ])
    expect(hasUnscopedPhysicalSyncError(errors)).toBe(true)
    expect(
      blockingSyncErrorsForTrade(errors, {
        operation: 'investments.orders.preview',
        venue: 'XTKS',
      }),
    ).toHaveLength(1)

    clearLegacyPhysicalSyncError(db, 'phys-1')
    expect(listPhysicalSyncErrors(db, 'phys-1')).toEqual([])
  })

  test('gates only matching venues for venue-scoped open_orders errors', () => {
    const db = createDb(':memory:')
    setPhysicalSyncError(db, 'phys-1', {
      stage: 'open_orders',
      scope: 'open_orders:us',
      reason: 'timeout',
      venues: ['XNAS', 'XNYS', 'ARCX'],
    })
    const errors = listPhysicalSyncErrors(db, 'phys-1')

    expect(hasUnscopedPhysicalSyncError(errors)).toBe(false)
    expect(
      blockingSyncErrorsForTrade(errors, {
        operation: 'investments.orders.preview',
        venue: 'XTKS',
      }),
    ).toEqual([])
    expect(
      blockingSyncErrorsForTrade(errors, {
        operation: 'investments.orders.preview',
        venue: 'XNAS',
      }),
    ).toHaveLength(1)
    // Fail-closed when target venue is unknown on a real trade, but allow generic method availability probes.
    expect(
      blockingSyncErrorsForTrade(errors, {
        operation: 'investments.orders.preview',
      }),
    ).toHaveLength(1)
    expect(
      blockingSyncErrorsForTrade(errors, {
        operation: 'investments.orders.preview',
        allowVenueScopedWhenVenueOmitted: true,
      }),
    ).toEqual([])
    expect(formatBlockingSyncError(errors)).toBe(
      'broker sync unavailable for open_orders:us (timeout)',
    )
  })

  test('blocks all trades on unscoped open_orders or physical_assets and ignores virtual_account_snapshots', () => {
    const db = createDb(':memory:')
    setPhysicalSyncError(db, 'phys-1', {
      stage: 'virtual_account_snapshots',
      scope: 'virtual_account_snapshots',
      reason: 'unknown',
    })
    expect(
      blockingSyncErrorsForTrade(listPhysicalSyncErrors(db, 'phys-1'), {
        operation: 'investments.orders.create',
        venue: 'XTKS',
      }),
    ).toEqual([])

    setPhysicalSyncError(db, 'phys-1', {
      stage: 'physical_assets',
      scope: 'physical_assets',
      reason: 'maintenance',
      code: 'ECOMN0004',
    })
    const withAssetsError = listPhysicalSyncErrors(db, 'phys-1')
    expect(hasUnscopedPhysicalSyncError(withAssetsError)).toBe(true)
    expect(
      blockingSyncErrorsForTrade(withAssetsError, {
        operation: 'investments.orders.create',
        venue: 'XTKS',
      }),
    ).toHaveLength(1)
    expect(
      blockingSyncErrorsForTrade(withAssetsError, {
        operation: 'investments.orders.cancel',
        venue: 'XTKS',
      }),
    ).toEqual([])
    expect(
      formatBlockingSyncError(
        blockingSyncErrorsForTrade(withAssetsError, {
          operation: 'investments.orders.create',
          venue: 'XTKS',
        }),
      ),
    ).toBe('broker sync unavailable for physical_assets (maintenance: ECOMN0004)')

    clearPhysicalSyncError(db, 'phys-1', 'physical_assets')
    setPhysicalSyncError(db, 'phys-1', {
      stage: 'open_orders',
      scope: 'open_orders:us',
      reason: 'timeout',
      venues: ['XNAS'],
    })
    setPhysicalSyncError(db, 'phys-1', {
      stage: 'open_orders',
      scope: 'open_orders:domestic',
      reason: 'timeout',
      venues: ['XTKS'],
    })
    clearPhysicalSyncErrorsByPrefix(db, 'phys-1', 'open_orders')
    expect(listPhysicalSyncErrors(db, 'phys-1').map((item) => item.scope)).toEqual([
      'virtual_account_snapshots',
    ])
  })
})
