import { createHash } from 'node:crypto'
import type {
  Account,
  CommonOperations,
  DateRangeRequest,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  Page,
  Transaction,
} from '@mnie/types'
import { VpassAuthError, VpassError } from './client'
import type { VpassProfile, VpassStatementEntry } from './profile'

const PROVIDER_ID = 'vpass'

/**
 * Statement rows carry no upstream identifier, so observations are aligned on a
 * content fingerprint instead. Date, merchant, direction and amount are the fields
 * that are both present on every row and stable across re-reads — the billing
 * month moves when a charge is re-billed, and the holder column is blank on
 * single-holder accounts.
 */
const FINGERPRINT_VERSION = 'vpass-2'

const fingerprintOf = (transaction: Transaction): string => {
  const amount = transaction.amount?.kind === 'money' ? transaction.amount.money.value : ''
  return createHash('sha256')
    .update(
      [transaction.occurredAt, transaction.description, transaction.direction, amount].join(' '),
    )
    .digest('hex')
    .slice(0, 32)
}

/** Deterministic id so repeated reads of one period produce stable rows. */
const entryId = (period: string, entry: VpassStatementEntry, index: number) =>
  `${period}:${index}:${createHash('sha256')
    .update([entry.usedOn, entry.merchant, entry.amount].join(' '))
    .digest('hex')
    .slice(0, 12)}`

/**
 * Billing periods overlapping an ISO date range.
 *
 * A statement is addressed by billing period, not by date, and the two do not
 * line up: a purchase made in June appears on the August statement. So the
 * caller's range is matched against usage dates after fetching, and the set of
 * periods fetched is deliberately wider than the range.
 */
const shiftYearMonth = (yearMonth: number, months: number): number => {
  const absolute = Math.floor(yearMonth / 100) * 12 + ((yearMonth % 100) - 1) + months
  return Math.floor(absolute / 12) * 100 + ((absolute % 12) + 1)
}

const periodsFor = (periods: string[], from?: string, to?: string): string[] => {
  // Period codes are YYYYMM, except the not-yet-billed one, which carries a
  // trailing marker digit. Compare on the first six characters only.
  const bound = (value: string | undefined, fallback: number) =>
    value ? Number(value.slice(0, 7).replace('-', '')) : fallback
  // Include the normal two-month billing lag after the usage range, retaining
  // one month before it. Step through the calendar: 202601 - 1 is 202512.
  const low = shiftYearMonth(bound(from, 190001), -1)
  const high = shiftYearMonth(bound(to, 299912), 2)
  return periods.filter((period) => {
    const yearMonth = Number(period.slice(0, 6))
    return Number.isFinite(yearMonth) && yearMonth >= low && yearMonth <= high
  })
}

const toTransaction = (
  accountId: string,
  period: string,
  entry: VpassStatementEntry,
  index: number,
): Transaction => {
  const base = {
    id: entryId(period, entry, index),
    accountId,
    status: 'posted' as const,
    amount: {
      kind: 'money' as const,
      money: { currency: 'JPY', value: String(Math.abs(entry.amount)) },
    },
    occurredAt: `${entry.usedOn}T00:00:00+09:00`,
    description: entry.merchant,
  }
  // A negative row is a refund or a reversal: money coming back to the card.
  return entry.amount < 0
    ? { ...base, kind: 'deposit' as const, direction: 'credit' as const }
    : { ...base, kind: 'withdrawal' as const, direction: 'debit' as const }
}

/** Resolves the authenticated card before exposing its member-site account identifier. */
export const createProvider = async (
  profile: VpassProfile,
): Promise<FinancialProvider<CommonOperations>> => {
  const cards = await profile.cards()
  // Auth's cardCode and the member site's cardIdentifyKey are different IDs.
  // The global ID and issuer identify the authenticated card in the card list.
  const authenticatedCards = cards.filter(
    (card) =>
      profile.session.globalId &&
      card.globalId === profile.session.globalId &&
      card.cardCompanyCode === profile.session.cardCompanyCode,
  )
  if (authenticatedCards.length !== 1 || !authenticatedCards[0]!.cardCode) {
    throw new VpassError('Could not uniquely resolve the authenticated VPass card')
  }
  const accountId = authenticatedCards[0]!.cardCode

  const listTransactions = async ({
    accountId: requestedAccountId,
    from,
    to,
    limit,
  }: DateRangeRequest): Promise<Page<Transaction>> => {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new Error('VPass transaction history limit must be a non-negative safe integer')
    }
    if ((requestedAccountId && requestedAccountId !== accountId) || limit === 0) {
      return { items: [] }
    }
    // An undated request must keep the site's default selection. The first
    // available option may be a future, empty billing bucket.
    const periods =
      !from && !to ? [undefined] : periodsFor(await profile.statementPeriods(), from, to)
    // Keyed by id: an installment charge is listed again on each statement it
    // is billed across, and asking for a period the site does not recognise
    // makes it answer with the default one instead of an error.
    const byId = new Map<string, Transaction>()
    for (const period of periods) {
      const statement = await profile.statement(period)
      statement.entries.forEach((entry, index) => {
        if (from && entry.usedOn < from) return
        if (to && entry.usedOn > to) return
        const transaction = toTransaction(accountId, statement.period || period || '', entry, index)
        if (!byId.has(transaction.id)) byId.set(transaction.id, transaction)
      })
    }
    const items = [...byId.values()].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    )
    return { items: limit === undefined ? items : items.slice(0, limit) }
  }

  return {
    descriptor: { id: PROVIDER_ID, name: 'VPass' },
    accountId,
    transactionObservationPolicy: {
      accountKind: 'credit-card',
      institutionId: 'smbc',
      // Statements give a usage date and nothing finer.
      timePrecision: 'day',
      identity: {
        kind: 'ordered-snapshot',
        fingerprintVersion: FINGERPRINT_VERSION,
        fingerprint: fingerprintOf,
      },
    },
    capabilities: () => ['accounts:read', 'transactions:read', 'cards:read'],
    operations: () => ['accounts.list', 'transactions.list', 'history.list'],
    checkAvailability: async () => {
      try {
        await profile.continueSession()
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof VpassAuthError
              ? 'VPass authentication is required'
              : 'VPass availability check failed',
          reason: error instanceof VpassAuthError ? 'AUTHENTICATION_REQUIRED' : 'UNKNOWN',
        }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') {
        const cards = await profile.cards()
        const items: Account[] = cards.map((card) => ({
          id: card.cardCode,
          providerId: PROVIDER_ID,
          kind: 'credit-card',
          name: card.cardName,
          ...(card.last4 ? { maskedNumber: `****${card.last4}` } : {}),
        }))
        return { items } as Page<Account> as never
      }

      if (name === 'transactions.list') {
        return (await listTransactions(request as DateRangeRequest)) as never
      }

      if (name === 'history.list') {
        const input = request as HistoryListRequest
        if (input.kinds?.some((kind) => kind !== 'transaction')) {
          throw new Error('VPass history.list supports transaction history only')
        }
        const { items } = await listTransactions(input)
        return {
          items: items.map((transaction) => ({
            kind: 'transaction' as const,
            occurredAt: transaction.occurredAt,
            transaction,
          })),
        } as Page<HistoryItem> as never
      }

      // balances.list is deliberately absent: a VPass statement reports billed
      // and unbilled totals, not a card balance, and reporting one as the other
      // would be wrong. Read the totals through statement() instead.
      throw new Error(`unsupported VPass operation: ${name}`)
    },
    exportSession: () => ({ ...profile.session, cookies: profile.client.jar.export() }),
    close: () => profile.logout(),
  }
}
