import { expect, test } from 'bun:test'
import { summarizeSyncFailure } from './account-sync-diagnostics'

test('classifies broker failures without copying upstream message contents', () => {
  expect(summarizeSyncFailure(new Error('maintenance ECOMN0004 secret=PRIVATE'))).toEqual({
    reason: 'maintenance',
    code: 'ECOMN0004',
  })
  expect(summarizeSyncFailure(new Error('HTTP 504 upstream request timeout'))).toEqual({
    reason: 'timeout',
  })
  expect(summarizeSyncFailure(new Error('authentication failed token=PRIVATE'))).toEqual({
    reason: 'authentication',
  })
  expect(summarizeSyncFailure(new Error('unexpected account=PRIVATE'))).toEqual({
    reason: 'unknown',
  })
})
