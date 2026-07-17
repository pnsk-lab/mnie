import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  HistoryItem,
  HistoryListRequest,
  Page,
  Transaction,
} from '@mnie/types'
import type { StarbucksHistory, StarbucksJpSession, StarbucksCard } from './index'

export interface StarbucksJpProviderOptions {
  close?: () => void | Promise<void>
}

const cardAccountId = (card: StarbucksCard) => `starbucks-card:${card.sb_card_id}`

const cardAccount = (card: StarbucksCard): Account => ({
  id: cardAccountId(card),
  providerId: 'starbucks-jp',
  kind: 'payment-wallet',
  name: card.nickname || 'スターバックス カード',
  maskedNumber: /^\d{16}$/.test(card.card_number) ? `••••${card.card_number.slice(-4)}` : undefined,
})

const jstDate = (value: string, name: string) => {
  const source = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+09:00`
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) throw new Error(`Starbucks ${name} is invalid`)
  return date
}

const dateInput = (value: string | undefined, name: 'from' | 'to') => {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`Starbucks history ${name} is invalid`)
  return date
}

const historyTransaction = (
  card: StarbucksCard,
  history: StarbucksHistory,
  index: number,
): Transaction => {
  if (!Number.isSafeInteger(history.used_amount)) {
    throw new Error('Starbucks history used_amount is not an integer')
  }
  const occurredAt = jstDate(history.created_date, 'history created_date').toISOString()
  const amount = history.used_amount
  const accountId = cardAccountId(card)
  const id = `starbucks-history:${encodeURIComponent(
    [card.sb_card_id, history.created_date, history.store_name, amount, index].join('|'),
  )}`
  if (amount < 0) {
    return {
      id,
      accountId,
      kind: 'payment',
      direction: 'debit',
      status: 'posted',
      amount: { kind: 'money', money: { currency: 'JPY', value: String(Math.abs(amount)) } },
      occurredAt,
      description: history.store_name,
      merchant: history.store_name,
    }
  }
  if (amount > 0) {
    return {
      id,
      accountId,
      kind: 'deposit',
      direction: 'credit',
      status: 'posted',
      amount: { kind: 'money', money: { currency: 'JPY', value: String(amount) } },
      occurredAt,
      description: history.store_name,
    }
  }
  return {
    id,
    accountId,
    kind: 'other',
    direction: 'neutral',
    status: 'posted',
    amount: null,
    occurredAt,
    description: history.store_name,
  }
}

const assertHistoryRequest = (request: HistoryListRequest) => {
  if (request.cursor) throw new Error('Starbucks history does not support cursors')
  if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 0)) {
    throw new Error('Starbucks history limit must be a non-negative integer')
  }
  if (request.kinds?.some((kind) => kind !== 'transaction')) {
    throw new Error('Starbucks history supports transaction history only')
  }
}

const balancesForCards = (cards: StarbucksCard[]): Balance[] =>
  cards.map((card) => ({
    accountId: cardAccountId(card),
    type: 'current',
    amount: {
      kind: 'money',
      money: { currency: 'JPY', value: String(card.latest_amount.amount) },
    },
    asOf: jstDate(card.latest_amount.updated_date, 'card updated_date').toISOString(),
  }))

/** Adapts the authenticated Starbucks session to the provider-neutral RPC surface. */
export const createStarbucksProvider = (
  profile: StarbucksJpSession,
  options: StarbucksJpProviderOptions = {},
): FinancialProvider<CommonOperations> => {
  const accounts = async (): Promise<Page<Account>> => ({
    items: (await profile.listCards()).map(cardAccount),
  })

  const balances = async (): Promise<Balance[]> => balancesForCards(await profile.listCards())

  const transactions = async (request: HistoryListRequest): Promise<Transaction[]> => {
    assertHistoryRequest(request)
    const from = dateInput(request.from, 'from')
    const to = dateInput(request.to, 'to') ?? new Date()
    if (from && from > to) throw new Error('Starbucks history from must not be after to')

    const cards = await profile.listCards()
    if (request.accountId && !cards.some((card) => cardAccountId(card) === request.accountId)) {
      return []
    }
    const selectedCards = request.accountId
      ? cards.filter((card) => cardAccountId(card) === request.accountId)
      : cards
    const records = (
      await Promise.all(
        selectedCards.map(async (card) => {
          const history = await profile.history(card.card_number)
          return history.map((item, index) => historyTransaction(card, item, index))
        }),
      )
    ).flat()
    const filtered = records
      .filter((transaction) => {
        const occurredAt = new Date(transaction.occurredAt)
        return (!from || occurredAt >= from) && occurredAt <= to
      })
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    return request.limit === undefined ? filtered : filtered.slice(0, request.limit)
  }

  return {
    descriptor: { id: 'starbucks-jp', name: 'スターバックス' },
    accountId: 'starbucks-jp',
    transactionObservationPolicy: {
      accountKind: 'payment-wallet',
      institutionId: 'starbucks-jp',
      timePrecision: 'instant',
      identity: {
        kind: 'ordered-snapshot',
        fingerprintVersion: 'starbucks-card-history-v1',
        fingerprint: (transaction) =>
          JSON.stringify([
            transaction.accountId,
            transaction.occurredAt,
            transaction.kind,
            transaction.direction,
            transaction.amount,
            transaction.description,
          ]),
      },
    },
    capabilities: () => ['accounts:read', 'balances:read', 'transactions:read', 'cards:read'],
    operations: () => ['accounts.list', 'balances.list', 'transactions.list', 'history.list'],
    checkAvailability: async () => {
      try {
        await profile.getBalance()
        return { ok: true }
      } catch (cause) {
        return {
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
          reason: 'AUTHENTICATION_REQUIRED',
        }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return accounts() as never
      if (name === 'balances.list') {
        const input = (request ?? {}) as { accountId?: string }
        const result = await balances()
        return (
          input.accountId ? result.filter((item) => item.accountId === input.accountId) : result
        ) as never
      }
      if (name === 'transactions.list') {
        return { items: await transactions((request ?? {}) as HistoryListRequest) } as never
      }
      if (name === 'history.list') {
        const items = await transactions((request ?? {}) as HistoryListRequest)
        return {
          items: items.map((transaction) => ({
            kind: 'transaction' as const,
            occurredAt: transaction.occurredAt,
            transaction,
          })),
        } as Page<HistoryItem> as never
      }
      throw new Error(`unsupported Starbucks operation: ${name}`)
    },
    exportSession: () => profile.session.export(),
    close: () => options.close?.(),
  }
}
