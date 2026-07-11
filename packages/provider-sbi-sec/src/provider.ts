import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  InvestmentOperations,
  InvestmentOrder,
  InvestmentPosition,
  Page,
  Transaction,
} from '@mnie/types'
import type { SbiClientMethods } from './methods/types'
import { loginWithPasskey } from './session'
import type { LoginWithPasskeyOptions, SbiClientOptions } from './types'

export type SbiSecOperations = CommonOperations &
  Pick<InvestmentOperations, 'investments.orders.list' | 'investments.positions.list'>

const money = (value: { currency: string; value: number | null } | undefined) =>
  value?.value == null ? undefined : { currency: value.currency, value: String(value.value) }

const signedMoney = (value: { value: number | null } | undefined, currency: string | undefined) =>
  value?.value == null || !currency ? undefined : { currency, value: String(value.value) }

/**
 * Adapts SBI Securities' transport implementation to the provider-neutral
 * financial API. SBI-specific methods deliberately remain internal here.
 */
export const createProvider = (client: SbiClientMethods): FinancialProvider<SbiSecOperations> => {
  const profile = client.session.profile
  const account = async (): Promise<Account> => {
    const value = await profile()
    const number = value.accountNumber ?? value.userId ?? 'primary'
    return {
      id: number,
      providerId: 'sbi-sec',
      kind: 'brokerage',
      name: 'SBI Securities brokerage account',
      ...(value.accountNumber ? { maskedNumber: `***${value.accountNumber.slice(-4)}` } : {}),
    }
  }
  return {
    descriptor: { id: 'sbi-sec', name: 'SBI Securities' },
    accountId: 'primary',
    capabilities: () => ['accounts:read', 'balances:read', 'transactions:read', 'investments:read'],
    operations: () => [
      'accounts.list',
      'balances.list',
      'transactions.list',
      'investments.positions.list',
      'investments.orders.list',
    ],
    checkAvailability: async () => {
      try {
        await client.account.assets.current()
        return { ok: true }
      } catch (message) {
        return { ok: false, message }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return { items: [await account()] } as Page<Account> as never
      const currentAccount = await account()
      if (name === 'balances.list') {
        const input = request as { accountId?: string }
        if (input.accountId && input.accountId !== currentAccount.id) return [] as never
        const power = await client.account.power.buyingPower()
        const asOf = new Date().toISOString()
        const balances: Balance[] = [
          ['buying-power', power.cashBuyingPower],
          ['withdrawable', power.withdrawableAmount],
          ['collateral', power.collateralValue],
        ].flatMap(([type, value]) => {
          const valueMoney = money(value as { currency: string; value: number | null } | undefined)
          return valueMoney
            ? [
                {
                  accountId: currentAccount.id,
                  type: type as Balance['type'],
                  amount: { kind: 'money', money: valueMoney },
                  asOf,
                },
              ]
            : []
        })
        return balances as never
      }
      if (name === 'investments.positions.list') {
        const input = request as { accountId?: string; positionType?: 'cash' | 'margin' }
        if (input.accountId && input.accountId !== currentAccount.id) return { items: [] } as never
        const positionType = input.positionType
        const [cash, margin] = await Promise.all([
          positionType === 'margin' ? Promise.resolve(undefined) : client.account.positions.cash(),
          positionType === 'cash' ? Promise.resolve(undefined) : client.account.positions.margin(),
        ])
        const positions: InvestmentPosition[] = [
          ...(cash?.positions ?? []).map((position) => ({
            id: `cash:${position.issue.code}:${position.issue.market ?? ''}`,
            accountId: currentAccount.id,
            instrumentId: position.issue.code,
            instrumentName: position.issue.name,
            quantity: String(position.quantity ?? 0),
            positionType: 'cash' as const,
            marketValue: money(position.marketValue),
            unrealizedProfitLoss: signedMoney(position.profitLoss, position.marketValue?.currency),
          })),
          ...(margin?.positions ?? []).map((position) => ({
            id: position.id ?? `margin:${position.issue.code}:${position.side}`,
            accountId: currentAccount.id,
            instrumentId: position.issue.code,
            instrumentName: position.issue.name,
            quantity: String(position.quantity ?? 0),
            positionType: 'margin' as const,
            side: position.side === 'buy' ? ('long' as const) : ('short' as const),
            marketValue: money(position.marketValue),
            unrealizedProfitLoss: signedMoney(position.profitLoss, position.marketValue?.currency),
          })),
        ]
        return { items: positions } as Page<InvestmentPosition> as never
      }
      if (name === 'investments.orders.list' || name === 'transactions.list') {
        const input = request as { accountId?: string; from?: string; status?: string; to?: string }
        if (input.accountId && input.accountId !== currentAccount.id) return { items: [] } as never
        if (input.from || input.to) {
          throw new Error("SBI Securities currently provides today's execution history only")
        }
        const executions = await client.orders.inquiry.executionsToday()
        const orders: InvestmentOrder[] = executions.orders.map((order) => ({
          id: order.id,
          accountId: currentAccount.id,
          instrumentId: order.issue.code,
          instrumentName: order.issue.name,
          side: order.side,
          status: order.status,
          quantity: order.quantity == null ? undefined : String(order.quantity),
          executedQuantity:
            order.executedQuantity == null ? undefined : String(order.executedQuantity),
          price: money(order.executedPrice ?? order.price),
          orderedAt: order.orderedAt,
        }))
        if (name === 'investments.orders.list') {
          return {
            items: input.status ? orders.filter((order) => order.status === input.status) : orders,
          } as Page<InvestmentOrder> as never
        }
        const transactions: Transaction[] = orders.map((order) => ({
          id: order.id,
          accountId: currentAccount.id,
          kind: 'investment-trade',
          direction: order.side === 'buy' ? 'debit' : 'credit',
          status: order.status === 'executed' ? 'posted' : 'pending',
          amount: order.price ? { kind: 'money', money: order.price } : null,
          occurredAt: order.orderedAt ?? new Date().toISOString(),
          description: `${order.side} ${order.instrumentName ?? order.instrumentId}`,
          investment: {
            instrumentId: order.instrumentId,
            side: order.side,
            quantity: order.executedQuantity ?? order.quantity,
            unitPrice: order.price,
          },
        }))
        return { items: transactions } as Page<Transaction> as never
      }
      throw new Error(`unsupported SBI Securities operation: ${name}`)
    },
    exportSession: () => client.session.export(),
    close: async () => {},
  }
}

/** Authenticates with an SBI passkey and returns the provider-neutral API. */
export const connectWithPasskey = async (
  options: LoginWithPasskeyOptions,
  clientOptions: SbiClientOptions = {},
): Promise<FinancialProvider<SbiSecOperations>> =>
  createProvider(await loginWithPasskey(options, clientOptions))
