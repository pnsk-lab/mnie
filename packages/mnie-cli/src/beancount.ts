import type { HistoryItem } from '@repo/client-mnie'

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u
const currencyPattern = /^[A-Z]{3}$/u
const datePrefixPattern = /^\d{4}-\d{2}-\d{2}/u

interface PreparedTransaction {
  date: string
  id: string
  profileId: string
  kind: string
  description: string
  account: string
  counterAccount: 'Income:Uncategorized' | 'Expenses:Uncategorized'
  direction: 'credit' | 'debit'
  currency: string
  amount: string
  occurredAt: string
}

const quote = (value: string) => JSON.stringify(value)

const transactionError = (id: string, message: string): never => {
  throw new Error(`transaction ${id || '<unknown>'}: ${message}`)
}

const calendarDate = (value: string, id: string) => {
  const date = value.match(datePrefixPattern)?.[0]
  if (!date) return transactionError(id, 'occurredAt must start with YYYY-MM-DD')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    transactionError(id, 'occurredAt contains an invalid calendar date')
  }
  if (!Number.isFinite(new Date(value).getTime())) {
    transactionError(id, 'occurredAt must be a valid timestamp')
  }
  return date
}

const profileComponent = (profileId: string, id: string) => {
  const runs = profileId.match(/[A-Za-z0-9]+/gu)
  if (!runs) return transactionError(id, 'profileId cannot form a Beancount account')
  const component = runs.map((run) => `${run[0]!.toUpperCase()}${run.slice(1)}`).join('')
  return /^\d/u.test(component) ? `Profile${component}` : component
}

const prepare = (item: HistoryItem): PreparedTransaction => {
  if (item.kind !== 'transaction') {
    throw new Error(`history item ${item.occurredAt}: expected transaction`)
  }
  const transaction = item.transaction
  const profileId = item.profileId
  if (!profileId) return transactionError(transaction.id, 'profileId is required')
  if (transaction.status !== 'posted') transactionError(transaction.id, 'status must be posted')
  if (transaction.kind === 'investment-trade') {
    transactionError(transaction.id, 'investment-trade is not supported')
  }
  const direction = transaction.direction
  if (direction !== 'credit' && direction !== 'debit') {
    return transactionError(transaction.id, 'direction must be credit or debit')
  }
  const amount = transaction.amount
  if (!amount || amount.kind !== 'money') {
    return transactionError(transaction.id, 'money amount is required')
  }
  const { currency, value } = amount.money
  if (!currencyPattern.test(currency)) transactionError(transaction.id, 'currency is invalid')
  const absoluteValue = value.startsWith('-') ? value.slice(1) : value
  if (!decimalPattern.test(absoluteValue)) transactionError(transaction.id, 'amount is invalid')
  return {
    date: calendarDate(item.occurredAt, transaction.id),
    id: transaction.id,
    profileId,
    kind: transaction.kind,
    description: transaction.description,
    account: `Assets:Mnie:${profileComponent(profileId, transaction.id)}`,
    counterAccount: direction === 'credit' ? 'Income:Uncategorized' : 'Expenses:Uncategorized',
    direction,
    currency,
    amount: absoluteValue,
    occurredAt: item.occurredAt,
  }
}

interface OpenDirective {
  date: string
  currencies: Set<string>
}

const compare = (left: string, right: string) => left.localeCompare(right)

export const formatBeancount = (items: HistoryItem[]) => {
  const transactions = items
    .filter((item) => item.kind !== 'transaction' || item.transaction.direction !== 'neutral')
    .map(prepare)
  const profileByAccount = new Map<string, string>()
  for (const transaction of transactions) {
    const existing = profileByAccount.get(transaction.account)
    if (existing && existing !== transaction.profileId) {
      transactionError(transaction.id, 'profile account collision')
    }
    profileByAccount.set(transaction.account, transaction.profileId)
  }
  transactions.sort(
    (left, right) =>
      compare(left.occurredAt, right.occurredAt) ||
      compare(left.profileId, right.profileId) ||
      compare(left.id, right.id),
  )

  if (transactions.length === 0) return 'option "operating_currency" "JPY"\n'

  const opens = new Map<string, OpenDirective>()
  const registerOpen = (account: string, date: string, currency: string) => {
    const existing = opens.get(account)
    if (!existing) {
      opens.set(account, { date, currencies: new Set([currency]) })
      return
    }
    if (date < existing.date) existing.date = date
    existing.currencies.add(currency)
  }
  for (const transaction of transactions) {
    registerOpen(transaction.account, transaction.date, transaction.currency)
    registerOpen(transaction.counterAccount, transaction.date, transaction.currency)
  }

  const directives = [...opens.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(
      ([account, open]) =>
        `${open.date} open ${account} ${[...open.currencies].sort(compare).join(' ')}`,
    )
  const entries = transactions.map((transaction) => {
    const sourceAmount =
      transaction.direction === 'credit' ? transaction.amount : `-${transaction.amount}`
    const counterAmount =
      transaction.direction === 'credit' ? `-${transaction.amount}` : transaction.amount
    const postings =
      transaction.direction === 'credit'
        ? [
            `  ${transaction.account}  ${sourceAmount} ${transaction.currency}`,
            `  ${transaction.counterAccount}  ${counterAmount} ${transaction.currency}`,
          ]
        : [
            `  ${transaction.counterAccount}  ${counterAmount} ${transaction.currency}`,
            `  ${transaction.account}  ${sourceAmount} ${transaction.currency}`,
          ]
    return [
      `${transaction.date} * ${quote(transaction.description)}`,
      `  mnie-id: ${quote(transaction.id)}`,
      `  mnie-profile-id: ${quote(transaction.profileId)}`,
      `  mnie-kind: ${quote(transaction.kind)}`,
      ...postings,
    ].join('\n')
  })

  return [
    'option "operating_currency" "JPY"',
    '',
    ...directives,
    '',
    entries.join('\n\n'),
    '',
  ].join('\n')
}
