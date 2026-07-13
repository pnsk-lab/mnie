import type {
  Account,
  Balance,
  HistoryItem,
  HistoryListRequest,
  InvestmentOrder,
  InvestmentOrderCreateRequest,
  InvestmentOrderPreview,
  InvestmentOrderReceipt,
  InvestmentOrderRequest,
  InvestmentInstrument,
  InvestmentPosition,
  Page,
  Transaction,
} from '@mnie/types'
import { PayPaySecError } from './errors'
import { createPayPaySecClient } from './client'
import { loginWithPasskey } from './session'
import type {
  LoginWithPasskeyOptions,
  PayPaySecClient,
  PayPaySecClientOptions,
  PayPaySecHistoryRecord,
  PayPaySecPasskeyClientOptions,
  PayPaySecPosition,
  PayPaySecProvider,
  PayPaySecMarket,
} from './types'

export interface PayPaySecProviderRuntimeOptions {
  tradePassword?: string
}

const markets: PayPaySecMarket[] = ['japan', 'japan-etf', 'usa', 'usa-etf']
const accountType = (value: string | undefined) => {
  const parsed = Number(value)
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4) return parsed
  throw new PayPaySecError('accountType must be 1, 2, 3, or 4', 'INVALID_ARGUMENT')
}

const accountFor = (client: PayPaySecClient): Account => ({
  id: client.accountId,
  providerId: 'paypay-sec',
  kind: 'brokerage',
  name: 'PayPay Securities brokerage account',
})

const money = (value: string | undefined) =>
  value === undefined ? undefined : { currency: 'JPY', value }

const unitPrice = (total: string | undefined, quantity: string | undefined) => {
  const totalValue = Number(total)
  const quantityValue = Number(quantity)
  if (!Number.isFinite(totalValue) || !Number.isFinite(quantityValue) || quantityValue === 0) {
    return undefined
  }
  return money(String(totalValue / quantityValue))
}

const acquisitionTotal = (position: PayPaySecPosition) => {
  if (position.acquisitionAmount !== undefined) return position.acquisitionAmount
  const marketValue = Number(position.securitiesValue)
  const profit = Number(position.grossProfit)
  return Number.isFinite(marketValue) && Number.isFinite(profit)
    ? String(marketValue - profit)
    : undefined
}

const occurredAt = (value: string | undefined) => {
  if (!value) return undefined
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value,
  )
  if (!match) return undefined
  const year = match[1]!
  const month = match[2]!
  const day = match[3]!
  const hour = match[4] ?? '00'
  const minute = match[5] ?? '00'
  const second = match[6] ?? '00'
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+09:00`
}

const orderFrom = (
  record: PayPaySecHistoryRecord,
  accountId: string,
): InvestmentOrder | undefined => {
  if (!record.brandId || !record.side) return undefined
  const statusText = record.status ?? Object.values(record.cells).join(' ')
  const status: InvestmentOrder['status'] = /約定|完了|成立/.test(statusText)
    ? 'executed'
    : /取消/.test(statusText)
      ? 'cancelled'
      : /失効/.test(statusText)
        ? 'expired'
        : /注文中|受付|未約定/.test(statusText)
          ? 'open'
          : 'unknown'
  return {
    id: record.id,
    accountId,
    instrumentId: record.brandId,
    instrumentName: record.instrumentName,
    side: record.side,
    status,
    quantity: record.quantity,
    executedQuantity: record.kind === 'settlement' ? record.quantity : undefined,
    price: money(record.price),
    amount: money(record.amount?.replace(/^-/, '')),
    accountType: record.accountType ? String(record.accountType) : undefined,
    orderedAt: occurredAt(record.occurredAt),
  }
}

const newestFirst = (left: PayPaySecHistoryRecord, right: PayPaySecHistoryRecord) =>
  (occurredAt(right.occurredAt) ?? '').localeCompare(occurredAt(left.occurredAt) ?? '')

const mergeOrderRecords = (
  trades: PayPaySecHistoryRecord[],
  settlements: PayPaySecHistoryRecord[],
) => {
  const merged = new Map<string, PayPaySecHistoryRecord>()
  for (const record of settlements) {
    if (record.side) merged.set(record.id, record)
  }
  for (const record of trades) {
    if (record.side && !merged.has(record.id)) merged.set(record.id, record)
  }
  return [...merged.values()].sort(newestFirst)
}

const transactionFrom = (
  record: PayPaySecHistoryRecord,
  accountId: string,
): Transaction | undefined => {
  const date = occurredAt(record.occurredAt)
  if (!record.brandId || !record.side || !date) return undefined
  return {
    id: record.id,
    accountId,
    kind: 'investment-trade',
    direction: record.side === 'buy' ? 'debit' : 'credit',
    status: 'posted',
    amount: record.amount
      ? { kind: 'money', money: { currency: 'JPY', value: record.amount } }
      : null,
    occurredAt: date,
    description: `${record.side} ${record.instrumentName ?? record.brandId}`,
    investment: {
      instrumentId: record.brandId,
      side: record.side,
      quantity: record.quantity,
    },
  }
}

export const createProvider = (
  client: PayPaySecClient,
  runtime: PayPaySecProviderRuntimeOptions = {},
): PayPaySecProvider => {
  const account = accountFor(client)
  const accountMatches = (accountId: string | undefined) => !accountId || accountId === account.id
  const instrumentIndex = new Map<
    string,
    { name: string; market: PayPaySecMarket; code?: string; imageURL?: string }
  >()
  const rememberInstruments = (
    instruments: Awaited<ReturnType<PayPaySecClient['market']['instruments']['list']>>,
  ) => {
    for (const instrument of instruments) {
      if (!instrumentIndex.has(instrument.brandId)) {
        instrumentIndex.set(instrument.brandId, instrument)
      }
    }
    return instruments
  }
  const listedInstrument = async (brandId: string) => {
    const cached = instrumentIndex.get(brandId)
    if (cached) return cached
    const results = await Promise.allSettled(
      markets.map((market) => client.market.instruments.list({ market })),
    )
    for (const result of results) {
      if (result.status === 'fulfilled') rememberInstruments(result.value)
    }
    return instrumentIndex.get(brandId)
  }

  return {
    descriptor: { id: 'paypay-sec', name: 'PayPay Securities' },
    accountId: account.id,
    capabilities: () => [
      'accounts:read',
      'balances:read',
      'transactions:read',
      'investments:read',
      'investments:trade',
    ],
    operations: () => [
      'accounts.list',
      'balances.list',
      'assets.valuation.get',
      'transactions.list',
      'history.list',
      'investments.positions.list',
      'investments.orders.list',
      'investments.orders.preview',
      'investments.orders.create',
      'investments.instruments.search',
      'investments.instruments.get',
    ],
    checkAvailability: async () => {
      try {
        await client.account.valuation()
        return { ok: true }
      } catch (message) {
        return { ok: false, message, reason: 'UNKNOWN' }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return { items: [account] } as Page<Account> as never
      if (name === 'balances.list') {
        const input = request as { accountId?: string }
        if (!accountMatches(input.accountId)) return [] as never
        const value = await client.account.valuation()
        const asOf = new Date().toISOString()
        const balances: Balance[] = [
          ['buying-power', value.buyableCash],
          ['withdrawable', value.withdrawableCash],
        ].flatMap(([type, amount]) =>
          amount === undefined
            ? []
            : [
                {
                  accountId: account.id,
                  type: type as Balance['type'],
                  amount: { kind: 'money', money: { currency: 'JPY', value: amount } },
                  asOf,
                },
              ],
        )
        return balances as never
      }
      if (name === 'assets.valuation.get') {
        const input = request as { accountId?: string }
        if (!accountMatches(input.accountId)) {
          throw new PayPaySecError('asset valuation account was not found', 'ACCOUNT_NOT_FOUND')
        }
        const value = await client.account.valuation()
        return {
          amount: { currency: 'JPY', value: value.assetsTotal },
          holdingsAmount: { currency: 'JPY', value: value.securitiesValueTotal },
          ...(value.buyableCash
            ? { cashAmount: { currency: 'JPY', value: value.buyableCash } }
            : {}),
          asOf: new Date().toISOString(),
        } as never
      }
      if (name === 'investments.positions.list') {
        const input = request as { accountId?: string; positionType?: 'cash' | 'margin' }
        if (!accountMatches(input.accountId) || input.positionType === 'margin') {
          return { items: [] } as never
        }
        const positions = (
          await Promise.all([
            client.portfolio.positions({ country: 'japan' }),
            client.portfolio.positions({ country: 'usa' }),
          ])
        ).flat()
        for (const position of positions) {
          if (!instrumentIndex.has(position.brandId)) {
            instrumentIndex.set(position.brandId, {
              name: position.name,
              market: position.country,
            })
          }
        }
        return {
          items: positions.map(
            (position): InvestmentPosition => ({
              id: position.id,
              accountId: account.id,
              instrumentId: position.brandId,
              instrumentName: position.name,
              quantity: position.quantity ?? '0',
              positionType: 'cash',
              marketValue: money(position.securitiesValue),
              unrealizedProfitLoss: money(position.grossProfit),
              averagePrice: unitPrice(acquisitionTotal(position), position.quantity),
              currentPrice: unitPrice(position.securitiesValue, position.quantity),
              market: position.country,
              accountType: position.accountType ? String(position.accountType) : undefined,
              subClientSeqNo: position.subClientSeqNo,
            }),
          ),
        } as Page<InvestmentPosition> as never
      }
      if (name === 'investments.orders.list' || name === 'transactions.list') {
        const input = request as { accountId?: string; from?: string; to?: string; status?: string }
        if (!accountMatches(input.accountId)) return { items: [] } as never
        if (input.from || input.to) {
          throw new PayPaySecError(
            'PayPay Securities date-range history is not available in the observed API',
            'UNSUPPORTED_OPERATION',
          )
        }
        if (name === 'investments.orders.list') {
          const [trades, settlements] = await Promise.all([
            client.history.trades(),
            client.history.settlements(),
          ])
          const records = mergeOrderRecords(trades, settlements)
          const orders = records.flatMap((value) => {
            const order = orderFrom(value, account.id)
            return order ? [order] : []
          })
          return {
            items: input.status ? orders.filter((order) => order.status === input.status) : orders,
          } as Page<InvestmentOrder> as never
        }
        const records = (await client.history.settlements()).filter((record) => record.side)
        return {
          items: records.flatMap((value) => {
            const transaction = transactionFrom(value, account.id)
            return transaction ? [transaction] : []
          }),
        } as Page<Transaction> as never
      }
      if (name === 'history.list') {
        const input = request as HistoryListRequest
        if (input.kinds?.some((kind) => kind !== 'transaction')) {
          throw new PayPaySecError(
            'PayPay Securities history.list supports transaction history only',
            'UNSUPPORTED_OPERATION',
          )
        }
        const transactions = await createProvider(client).invoke('transactions.list', {
          accountId: input.accountId,
          from: input.from,
          to: input.to,
        })
        return {
          items: transactions.items.map(
            (transaction): HistoryItem => ({
              kind: 'transaction',
              occurredAt: transaction.occurredAt,
              transaction,
            }),
          ),
        } as Page<HistoryItem> as never
      }
      if (name === 'investments.instruments.search') {
        const input = request as { query?: string; market?: string }
        const selectedMarkets = input.market
          ? markets.includes(input.market as PayPaySecMarket)
            ? [input.market as PayPaySecMarket]
            : []
          : markets
        if (!selectedMarkets.length) {
          throw new PayPaySecError('unsupported PayPay Securities market', 'INVALID_ARGUMENT')
        }
        const query = input.query?.trim().toLocaleLowerCase() ?? ''
        const instruments = (
          await Promise.all(
            selectedMarkets.map((market) =>
              client.market.instruments.list({ market }).then(rememberInstruments),
            ),
          )
        ).flat()
        return {
          items: instruments
            .filter(
              (item) =>
                !query ||
                item.name.toLocaleLowerCase().includes(query) ||
                item.code?.toLocaleLowerCase().includes(query) ||
                item.brandId.includes(query),
            )
            .map(
              (item): InvestmentInstrument => ({
                id: item.brandId,
                name: item.name,
                market: item.market,
                code: item.code,
                imageUrl: item.imageURL,
              }),
            ),
        } as Page<InvestmentInstrument> as never
      }
      if (name === 'investments.instruments.get') {
        const input = request as { instrumentId?: string }
        if (!input.instrumentId) {
          throw new PayPaySecError('instrumentId is required', 'INVALID_ARGUMENT')
        }
        const listed = await listedInstrument(input.instrumentId)
        const item = await client.market.instruments.detail({ brandId: input.instrumentId })
        return {
          id: item.brandId,
          name: item.name || listed?.name || item.brandId,
          market: listed?.market ?? '',
          code: item.code ?? listed?.code,
          price: money(item.price),
        } as InvestmentInstrument as never
      }
      if (name === 'investments.orders.preview') {
        const input = request as InvestmentOrderRequest
        if (!accountMatches(input.accountId)) {
          throw new PayPaySecError('order account was not found', 'ACCOUNT_NOT_FOUND')
        }
        if (!input.instrumentId) {
          throw new PayPaySecError('instrumentId is required', 'INVALID_ARGUMENT')
        }
        const amount = input.amount?.value ?? ''
        const preview =
          input.side === 'buy'
            ? await client.orders.buy.preview({
                brandId: input.instrumentId,
                accountType: accountType(input.accountType),
                amount,
              })
            : await client.orders.sell.preview({
                brandId: input.instrumentId,
                accountType: accountType(input.accountType),
                subClientSeqNo: input.subClientSeqNo ?? '',
                ...(input.sellAll ? { mode: 'all' as const } : { mode: 'amount' as const, amount }),
              })
        return {
          estimatedAmount: { currency: 'JPY', value: preview.amount },
          quantity: preview.quantity,
          price: { currency: 'JPY', value: preview.price },
          exchangeRate: preview.exchangeRate,
          expiresAt: preview.expiresAt,
          warnings: preview.warnings,
          confirmationToken: preview.confirmationId,
        } as InvestmentOrderPreview as never
      }
      if (name === 'investments.orders.create') {
        const input = request as InvestmentOrderCreateRequest
        if (input.allowTransaction !== true) {
          throw new PayPaySecError('allowTransaction: true is required', 'TRANSACTION_NOT_ALLOWED')
        }
        if (!runtime.tradePassword) {
          throw new PayPaySecError('trade password is not configured', 'MISSING_TRADE_PASSWORD')
        }
        // The client owns confirmation tickets and verifies their side. Try the buy
        // collection first only when it owns the ticket; INVALID_CONFIRMATION is safe.
        let receipt
        try {
          receipt = await client.orders.buy.submit({
            confirmationId: input.confirmationToken,
            tradePassword: runtime.tradePassword,
            allowTransaction: true,
          })
        } catch (cause) {
          if (!(cause instanceof PayPaySecError) || cause.code !== 'INVALID_CONFIRMATION')
            throw cause
          receipt = await client.orders.sell.submit({
            confirmationId: input.confirmationToken,
            tradePassword: runtime.tradePassword,
            allowTransaction: true,
          })
        }
        return {
          accountId: account.id,
          instrumentId: receipt.brandId,
          instrumentName: receipt.instrumentName,
          side: receipt.side,
          amount: { currency: 'JPY', value: receipt.amount },
          message: receipt.message,
        } as InvestmentOrderReceipt as never
      }
      throw new PayPaySecError(
        `unsupported PayPay Securities operation: ${name}`,
        'UNSUPPORTED_OPERATION',
      )
    },
    exportSession: () => client.session.export(),
    close: () => client.close(),
  }
}

export const connect = async (options: PayPaySecClientOptions = {}): Promise<PayPaySecProvider> =>
  createProvider(createPayPaySecClient(options))

/** Authenticates with a PayPay Securities passkey and returns the provider-neutral API. */
export const connectWithPasskey = async (
  options: LoginWithPasskeyOptions,
  clientOptions: PayPaySecPasskeyClientOptions = {},
  runtimeOptions: PayPaySecProviderRuntimeOptions = {},
): Promise<PayPaySecProvider> =>
  createProvider(await loginWithPasskey(options, clientOptions), runtimeOptions)
