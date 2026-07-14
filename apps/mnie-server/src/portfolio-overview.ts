import type {
  FinancialProvider,
  OperationMap,
  PortfolioOverview,
  PortfolioOverviewComponent,
  PortfolioOverviewError,
  PortfolioValuation,
  ProfileDescriptor,
} from '@mnie/types'

export interface OverviewProfile {
  descriptor: ProfileDescriptor
  use(
    action: (provider: FinancialProvider<OperationMap>) => Promise<PortfolioOverviewComponent>,
  ): Promise<PortfolioOverviewComponent>
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const invokeOptional = async (
  provider: FinancialProvider<OperationMap>,
  profile: ProfileDescriptor,
  operation: string,
  input: Record<string, unknown>,
  errors: PortfolioOverviewError[],
) => {
  if (!provider.operations().includes(operation)) return undefined
  try {
    return await provider.invoke(operation, input)
  } catch (cause) {
    errors.push({
      profileId: profile.id,
      providerId: profile.provider.id,
      operation,
      message: messageOf(cause),
    })
    return undefined
  }
}

const loadComponent = async (
  item: OverviewProfile,
  errors: PortfolioOverviewError[],
): Promise<PortfolioOverviewComponent> => {
  try {
    return await item.use(async (provider) => {
      const accounts = await invokeOptional(provider, item.descriptor, 'accounts.list', {}, errors)
      const valuation = await invokeOptional(
        provider,
        item.descriptor,
        'assets.valuation.get',
        {},
        errors,
      )
      const balances = await invokeOptional(provider, item.descriptor, 'balances.list', {}, errors)
      const positions = await invokeOptional(
        provider,
        item.descriptor,
        'investments.positions.list',
        {},
        errors,
      )
      const orders = await invokeOptional(
        provider,
        item.descriptor,
        'investments.orders.list',
        {},
        errors,
      )
      return {
        profile: item.descriptor,
        accounts:
          accounts && typeof accounts === 'object' && 'items' in accounts
            ? ((accounts as { items: PortfolioOverviewComponent['accounts'] }).items ?? [])
            : [],
        ...(valuation ? { valuation: valuation as PortfolioOverviewComponent['valuation'] } : {}),
        ...(Array.isArray(balances)
          ? { balances: balances as NonNullable<PortfolioOverviewComponent['balances']> }
          : {}),
        ...(positions && typeof positions === 'object' && 'items' in positions
          ? {
              positions: (
                positions as { items: NonNullable<PortfolioOverviewComponent['positions']> }
              ).items,
            }
          : {}),
        ...(orders && typeof orders === 'object' && 'items' in orders
          ? {
              orders: (orders as { items: NonNullable<PortfolioOverviewComponent['orders']> })
                .items,
            }
          : {}),
      }
    })
  } catch (cause) {
    errors.push({
      profileId: item.descriptor.id,
      providerId: item.descriptor.provider.id,
      operation: 'provider.connect',
      message: messageOf(cause),
    })
    return { profile: item.descriptor, accounts: [] }
  }
}

export const loadPortfolioOverview = async (
  profiles: OverviewProfile[],
  concurrency = 3,
): Promise<PortfolioOverview> => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('portfolio overview concurrency must be a positive integer')
  }
  const errors: PortfolioOverviewError[] = []
  const components: PortfolioOverviewComponent[] = []
  for (let offset = 0; offset < profiles.length; offset += concurrency) {
    components.push(
      ...(await Promise.all(
        profiles
          .slice(offset, offset + concurrency)
          .map((profile) => loadComponent(profile, errors)),
      )),
    )
  }
  return { components, errors, asOf: new Date().toISOString() }
}

const balancePriority = ['current', 'available', 'withdrawable', 'buying-power'] as const
const balanceRank = (type: string) => {
  const rank = balancePriority.indexOf(type as (typeof balancePriority)[number])
  return rank < 0 ? Number.POSITIVE_INFINITY : rank
}

const valuationFromBalances = (component: PortfolioOverviewComponent) => {
  const byAccount = new Map<string, NonNullable<PortfolioOverviewComponent['balances']>[number]>()
  for (const balance of component.balances ?? []) {
    if (balance.amount.kind !== 'money') continue
    const current = byAccount.get(balance.accountId)
    if (!current || balanceRank(balance.type) < balanceRank(current.type)) {
      byAccount.set(balance.accountId, balance)
    }
  }
  const balances = [...byAccount.values()]
  const currency =
    balances[0]?.amount.kind === 'money' ? balances[0].amount.money.currency : undefined
  if (
    !currency ||
    balances.some((item) => item.amount.kind !== 'money' || item.amount.money.currency !== currency)
  ) {
    return undefined
  }
  return {
    amount: {
      currency,
      value: String(
        balances.reduce(
          (sum, item) => sum + (item.amount.kind === 'money' ? Number(item.amount.money.value) : 0),
          0,
        ),
      ),
    },
    asOf: balances.reduce((latest, item) => (item.asOf > latest ? item.asOf : latest), ''),
  }
}

export const portfolioValuationFromOverview = (
  overview: PortfolioOverview,
  baseCurrency: string,
): PortfolioValuation => {
  const missing: PortfolioOverviewError[] = []
  const components = overview.components.flatMap((component) => {
    const valuation = component.valuation ?? valuationFromBalances(component)
    if (!valuation) {
      missing.push({
        profileId: component.profile.id,
        providerId: component.profile.provider.id,
        operation: 'assets.valuation.get',
        message: 'provider did not advertise a usable valuation or monetary balance',
      })
      return []
    }
    if (valuation.amount.currency !== baseCurrency) {
      throw new Error('portfolio valuation requires an explicit currency conversion provider')
    }
    return [
      {
        profileId: component.profile.id,
        providerId: component.profile.provider.id,
        label: component.profile.label,
        originalAmount: valuation.amount,
        convertedAmount: valuation.amount,
        asOf: valuation.asOf,
      },
    ]
  })
  const errors = [...overview.errors, ...missing].map((item) => ({
    profileId: item.profileId,
    message: `${item.operation}: ${item.message}`,
  }))
  return {
    baseCurrency,
    total: {
      currency: baseCurrency,
      value: String(components.reduce((sum, item) => sum + Number(item.convertedAmount.value), 0)),
    },
    asOf: overview.asOf,
    completeness: errors.length ? 'partial' : 'complete',
    components,
    errors,
  }
}
