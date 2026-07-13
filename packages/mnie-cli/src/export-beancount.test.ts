import type { HistoryItem } from '@repo/client-mnie'
import { expect, test, vi } from 'vitest'
import { exportBeancount } from './export-beancount'

const transaction: HistoryItem = {
  kind: 'transaction',
  occurredAt: '2026-05-05T00:00:00.000Z',
  profileId: 'bank-main',
  transaction: {
    id: 'tx-1',
    accountId: 'account-1',
    kind: 'withdrawal',
    direction: 'debit',
    status: 'posted',
    amount: { kind: 'money', money: { currency: 'JPY', value: '1500' } },
    occurredAt: '2026-05-05T00:00:00.000Z',
    description: 'test transaction',
  },
}

test('exports filtered transaction history as Beancount', async () => {
  let resolvedProfileName: string | undefined
  let connectOptions: { baseURL: string; token: string } | undefined
  let invokeCall: { operation: string; input: unknown } | undefined
  let output = ''
  let closed = false

  await exportBeancount(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      profile: 'local',
      'profile-id': 'bank-main',
    },
    {
      resolveProfile: async (name) => {
        resolvedProfileName = name
        return { profile: { origin: 'https://example.com' }, apiKey: 'test-token' }
      },
      connect: async (options) => {
        connectOptions = options
        return {
          invoke: async (operation, input) => {
            invokeCall = { operation, input }
            return { items: [transaction] }
          },
          close: () => {
            closed = true
          },
        }
      },
      write: (value) => {
        output = value
      },
    },
  )

  expect(resolvedProfileName).toBe('local')
  expect(connectOptions).toEqual({ baseURL: 'https://example.com', token: 'test-token' })
  expect(invokeCall).toEqual({
    operation: 'history.list',
    input: {
      kinds: ['transaction'],
      from: '2026-05-01',
      to: '2026-05-31',
      profileIds: ['bank-main'],
    },
  })
  expect(output).toContain('mnie-id: "tx-1"')
  expect(closed).toBe(true)
})

const expectValidationError = async (options: Record<string, string | true>, message: string) => {
  let connected = false
  await expect(
    exportBeancount(options, {
      resolveProfile: async () => ({
        profile: { origin: 'https://example.com' },
        apiKey: 'test-token',
      }),
      connect: async () => {
        connected = true
        throw new Error('connect should not be called')
      },
      write: () => {},
    }),
  ).rejects.toThrow(message)
  expect(connected).toBe(false)
}

test('rejects a missing from date before connecting', async () => {
  await expectValidationError({ to: '2026-05-31' }, '--from is required')
})

test('rejects a missing to date before connecting', async () => {
  await expectValidationError({ from: '2026-05-01' }, '--to is required')
})

test('rejects an invalid calendar date before connecting', async () => {
  await expectValidationError(
    { from: '2026-02-30', to: '2026-05-31' },
    '--from must be a valid calendar date',
  )
})

test('rejects a non-ISO date before connecting', async () => {
  await expectValidationError(
    { from: 'May 1, 2026', to: '2026-05-31' },
    '--from must be YYYY-MM-DD',
  )
})

test('rejects a reversed date range before connecting', async () => {
  await expectValidationError(
    { from: '2026-06-01', to: '2026-05-31' },
    '--from must not be after --to',
  )
})

test('omits profileIds when profile-id is not supplied', async () => {
  let input: unknown

  await exportBeancount(
    { from: '2026-05-01', to: '2026-05-31' },
    {
      resolveProfile: async () => ({
        profile: { origin: 'https://example.com' },
        apiKey: 'test-token',
      }),
      connect: async () => ({
        invoke: async (_operation, request) => {
          input = request
          return { items: [] }
        },
        close: () => {},
      }),
      write: () => {},
    },
  )

  expect(input).toEqual({
    kinds: ['transaction'],
    from: '2026-05-01',
    to: '2026-05-31',
  })
  expect(input).not.toHaveProperty('profileIds')
})

test.each(['', ' \t\n'])('rejects an empty profile-id before connecting', async (profileId) => {
  await expectValidationError(
    { from: '2026-05-01', to: '2026-05-31', 'profile-id': profileId },
    '--profile-id must not be empty',
  )
})

test('closes the workspace when formatting fails', async () => {
  let closed = false
  const pendingTransaction: HistoryItem = {
    ...transaction,
    transaction: { ...transaction.transaction, status: 'pending' },
  }

  await expect(
    exportBeancount(
      { from: '2026-05-01', to: '2026-05-31' },
      {
        resolveProfile: async () => ({
          profile: { origin: 'https://example.com' },
          apiKey: 'test-token',
        }),
        connect: async () => ({
          invoke: async () => ({ items: [pendingTransaction] }),
          close: () => {
            closed = true
          },
        }),
        write: () => {},
      },
    ),
  ).rejects.toThrow('status must be posted')
  expect(closed).toBe(true)
})

const runCli = async (...args: string[]) => {
  const originalArgv = process.argv
  const stdout: string[] = []
  const stderr: string[] = []
  let exitCode: number | undefined
  process.argv = [process.execPath, 'mnie', ...args]
  const log = vi.spyOn(console, 'log').mockImplementation((...values) => {
    stdout.push(values.join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values) => {
    stderr.push(values.join(' '))
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = typeof code === 'number' ? code : 0
    return undefined as never
  })
  try {
    vi.resetModules()
    vi.doMock('@repo/client-mnie', () => ({ connectMnie: vi.fn() }))
    await import('./index')
    if (args[0] !== '--help') {
      await vi.waitFor(() => expect(exitCode).toBeDefined())
    }
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: exitCode ?? 0 }
  } finally {
    process.argv = originalArgv
    log.mockRestore()
    error.mockRestore()
    exit.mockRestore()
  }
}

test('advertises the Beancount export in CLI help', async () => {
  const result = await runCli('--help')

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain(
    'mnie export beancount --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--profile <name>] [--profile-id <id>]',
  )
})

test('dispatches export beancount to command validation', async () => {
  const result = await runCli('export', 'beancount')

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('--from is required')
})

test('rejects positional arguments for export beancount', async () => {
  const result = await runCli(
    'export',
    'beancount',
    'unexpected',
    '--from',
    '2026-05-01',
    '--to',
    '2026-05-31',
  )

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('export beancount does not accept positional arguments')
})
