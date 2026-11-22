import type {
  Account,
  Balance,
  Capability,
  CommonMethods,
  FinancialProvider,
  MethodAvailability,
  MethodMap,
  MethodName,
  MethodRequest,
  MethodResponse,
  MnieClient,
  Page,
  PortfolioValuation,
  ProviderAvailability,
  PublicFinancialAccount,
  Transaction,
} from '@mnie/types'

/** Calls a method supported by the selected provider. */
export const invoke = <Methods extends MethodMap, Name extends MethodName<Methods>>(
  provider: FinancialProvider<Methods>,
  name: Name,
  request: MethodRequest<Methods, Name>,
): Promise<MethodResponse<Methods, Name>> => provider.invoke(name, request)

export const listAccounts = (
  provider: FinancialProvider<CommonMethods>,
  request: PageRequest = {},
) => provider.invoke('accounts.list', request) as Promise<Page<Account>>

type PageRequest = MethodRequest<CommonMethods, 'accounts.list'>

export const listBalances = (
  provider: FinancialProvider<CommonMethods>,
  request: MethodRequest<CommonMethods, 'balances.list'> = {},
) => provider.invoke('balances.list', request) as Promise<Balance[]>

export const listTransactions = (
  provider: FinancialProvider<CommonMethods>,
  request: MethodRequest<CommonMethods, 'transactions.list'>,
) => provider.invoke('transactions.list', request) as Promise<Page<Transaction>>

export const listTransferRecipients = (
  provider: FinancialProvider<CommonMethods>,
  request: MethodRequest<CommonMethods, 'transfers.recipients.list'> = {},
) => provider.invoke('transfers.recipients.list', request)

export const exportSession = (provider: FinancialProvider) => provider.exportSession()

export interface LocalClientAccount {
  account: PublicFinancialAccount
  provider: FinancialProvider<CommonMethods>
}

const stripPrefix = (method: string, prefix: string) => method.slice(prefix.length)

const PASSTHROUGH_WITHOUT_ACCOUNT = new Set([
  'accounts.list',
  'transfers.recipients.list',
  'investments.instruments.search',
  'investments.instruments.get',
  'pension.participant.get',
  'pension.assets.current.get',
  'pension.contribution.get',
  'pension.assets.history.list',
])

const checkedAt = () => new Date().toISOString()

const availabilityFor = async (
  provider: FinancialProvider<CommonMethods>,
  method: string,
  params?: unknown,
): Promise<MethodAvailability> => {
  if (provider.checkMethodAvailability) {
    return provider.checkMethodAvailability({ method, params })
  }
  const advertised = provider.methods() as readonly string[]
  if (!advertised.includes(method)) {
    return {
      available: false,
      reason: 'OPERATION_UNSUPPORTED',
      message: `unsupported method: ${method}`,
    }
  }
  return { available: true }
}

export const createLocalClient = (entries: LocalClientAccount[]): MnieClient => {
  const providers = new Map<string, LocalClientAccount>(
    entries.map((entry) => [entry.account.id, entry]),
  )
  if (providers.size !== entries.length) throw new Error('account IDs must be unique')

  const requireEntry = (accountId: string) => {
    const entry = providers.get(accountId)
    if (!entry) throw new Error(`account not found: ${accountId}`)
    return entry
  }

  const portfolioValuation = async (request: {
    baseCurrency: string
    profiles?: string[]
    accounts?: string[]
    profileIds?: string[]
  }): Promise<PortfolioValuation> => {
    const selectedIds = request.accounts ?? request.profiles ?? request.profileIds
    const selected = selectedIds ? selectedIds.map((id) => requireEntry(id)) : entries
    const settled = await Promise.allSettled(
      selected.map(async ({ account, provider }) => ({
        account,
        providerDescriptor: provider.descriptor,
        valuation: await provider.invoke('assets.valuation.get', {}),
      })),
    )
    const components = settled.flatMap((item) => {
      if (item.status === 'rejected') return []
      const { account, providerDescriptor, valuation } = item.value
      if (valuation.amount.currency !== request.baseCurrency) {
        throw new Error(`currency conversion is required for ${valuation.amount.currency}`)
      }
      return [
        {
          profileId: account.id,
          providerId: providerDescriptor.id,
          label: account.label,
          originalAmount: valuation.amount,
          convertedAmount: valuation.amount,
          asOf: valuation.asOf,
        },
      ]
    })
    const errors = settled.flatMap((item, index) =>
      item.status === 'rejected'
        ? [
            {
              profileId: selected[index]!.account.id,
              message: item.reason instanceof Error ? item.reason.message : String(item.reason),
            },
          ]
        : [],
    )
    const total = components.reduce((sum, item) => sum + Number(item.convertedAmount.value), 0)
    return {
      baseCurrency: request.baseCurrency,
      total: { currency: request.baseCurrency, value: String(total) },
      asOf: new Date().toISOString(),
      completeness: errors.length ? 'partial' : 'complete',
      components,
      errors,
    }
  }

  const accountAvailability = async (
    accountId: string,
    method?: string,
    params?: Record<string, unknown>,
  ): Promise<ProviderAvailability> => {
    const { provider } = requireEntry(accountId)
    const connection = await provider.checkAvailability()
    if (!method) {
      const advertised = provider.methods() as readonly string[]
      const methods: Record<string, MethodAvailability> = {}
      for (const name of advertised) methods[`account.${name}`] = { available: true }
      return { connection, methods, checkedAt: checkedAt() }
    }
    const name = method.startsWith('account.') ? stripPrefix(method, 'account.') : method
    return {
      connection,
      methods: { [`account.${name}`]: await availabilityFor(provider, name, params) },
      checkedAt: checkedAt(),
    }
  }

  const dispatchAccountMethod = async (method: string, params: Record<string, unknown>) => {
    const { account: accountId, ...rest } = params
    if (typeof accountId !== 'string' || !accountId) throw new Error('account is required')
    const { provider } = requireEntry(accountId)
    if (method === 'account.operations') {
      return (provider.methods() as readonly string[]).map((name) => `account.${name}`)
    }
    if (method === 'account.capabilities') return provider.capabilities()
    if (method === 'account.availability') {
      const { method: nested, params: nestedParams } = rest as {
        method?: string
        params?: Record<string, unknown>
      }
      return accountAvailability(accountId, nested, nestedParams)
    }
    if (!method.startsWith('account.')) throw new Error(`unsupported method: ${method}`)
    const name = stripPrefix(method, 'account.')
    const advertised = provider.methods() as readonly string[]
    if (!advertised.includes(name)) throw new Error(`unsupported method: ${method}`)
    const providerParams = PASSTHROUGH_WITHOUT_ACCOUNT.has(name)
      ? rest
      : { ...rest, account: (rest as { account?: string }).account ?? provider.accountId }
    return (provider as FinancialProvider<MethodMap>).invoke(name, providerParams)
  }

  const dispatchProfileMethod = async (method: string, params: Record<string, unknown>) => {
    const { profile: profileId, ...rest } = params
    if (typeof profileId !== 'string' || !profileId) throw new Error('profile is required')
    // Local profiles map 1:1 onto entries by virtual account id; fall back to
    // provider-native account id or descriptor id when they differ.
    const entry =
      providers.get(profileId) ??
      entries.find(
        (candidate) =>
          candidate.provider.accountId === profileId ||
          candidate.provider.descriptor.id === profileId,
      )
    if (!entry) throw new Error(`profile not found: ${profileId}`)
    if (method === 'profile.operations') {
      return (entry.provider.methods() as readonly string[]).map((name) => `profile.${name}`)
    }
    if (method === 'profile.capabilities') return entry.provider.capabilities()
    if (method === 'profile.availability') {
      const { method: nested, params: nestedParams } = rest as {
        method?: string
        params?: Record<string, unknown>
      }
      const connection = await entry.provider.checkAvailability()
      if (!nested) return { connection, methods: {}, checkedAt: checkedAt() }
      const name = nested.startsWith('profile.') ? stripPrefix(nested, 'profile.') : nested
      return {
        connection,
        methods: { [`profile.${name}`]: await availabilityFor(entry.provider, name, nestedParams) },
        checkedAt: checkedAt(),
      }
    }
    if (!method.startsWith('profile.')) throw new Error(`unsupported method: ${method}`)
    const name = stripPrefix(method, 'profile.')
    const { account: _account, ...providerParams } = rest as { account?: string } & Record<
      string,
      unknown
    >
    return (entry.provider as FinancialProvider<MethodMap>).invoke(name, providerParams)
  }

  const call = (async (method: string, params?: Record<string, unknown>) => {
    const input = params ?? {}
    if (method === 'rpc.methods') return methods()
    if (method === 'portfolio.accounts.list') {
      return { accounts: entries.map((entry) => entry.account) }
    }
    if (method === 'portfolio.accounts.get') {
      const accountId = (input as { account?: string }).account
      if (!accountId) throw new Error('account is required')
      return { account: requireEntry(accountId).account }
    }
    if (method === 'portfolio.valuation.get') {
      return portfolioValuation(input as { baseCurrency: string })
    }
    if (method === 'portfolio.history.list') {
      throw new Error('local client portfolio.history.list requires a persistent history store')
    }
    if (method.startsWith('account.')) return dispatchAccountMethod(method, input)
    if (method.startsWith('profile.')) return dispatchProfileMethod(method, input)
    if (method.startsWith('portfolio.') || method.startsWith('admin.')) {
      throw new Error(`unsupported local method: ${method}`)
    }
    throw new Error(`unsupported method: ${method}`)
  }) as MnieClient['call']

  const methods = async (): Promise<readonly string[]> => {
    const providerMethods = new Set<string>()
    for (const { provider } of entries) {
      for (const name of provider.methods() as readonly string[]) providerMethods.add(name)
    }
    return [
      'rpc.methods',
      'portfolio.accounts.list',
      'portfolio.accounts.get',
      'portfolio.valuation.get',
      'portfolio.history.list',
      'account.operations',
      'account.capabilities',
      'account.availability',
      'profile.operations',
      'profile.capabilities',
      'profile.availability',
      ...[...providerMethods].map((name) => `account.${name}`),
    ]
  }

  const scopedProxy = (
    selector: { account: string } | { profile: string },
    namespace: 'account' | 'profile',
  ): FinancialProvider<MethodMap> =>
    new Proxy({} as FinancialProvider<MethodMap>, {
      get(_target, property) {
        const id = 'account' in selector ? selector.account : selector.profile
        if (property === 'descriptor') {
          if (namespace === 'account') return requireEntry(id).provider.descriptor
          const entry =
            providers.get(id) ??
            entries.find(
              (candidate) =>
                candidate.provider.accountId === id || candidate.provider.descriptor.id === id,
            )
          if (!entry) throw new Error(`profile not found: ${id}`)
          return entry.provider.descriptor
        }
        if (property === 'accountId') return id
        if (property === 'capabilities') {
          return async (): Promise<readonly Capability[]> =>
            (await call(
              `${namespace}.capabilities` as never,
              selector as never,
            )) as readonly Capability[]
        }
        if (property === 'methods') {
          return async () => {
            const names = (await call(
              `${namespace}.operations` as never,
              selector as never,
            )) as readonly string[]
            return names.map((name) =>
              name.startsWith(`${namespace}.`) ? stripPrefix(name, `${namespace}.`) : name,
            )
          }
        }
        if (property === 'invoke')
          return (name: string, request: unknown) =>
            call(`${namespace}.${name}`, {
              ...(typeof request === 'object' && request !== null
                ? (request as Record<string, unknown>)
                : {}),
              ...(namespace === 'account' ? { account: id } : { profile: id }),
            })
        if (property === 'checkAvailability')
          return async () =>
            (
              (await call(
                `${namespace}.availability` as never,
                selector as never,
              )) as ProviderAvailability
            ).connection
        if (property === 'checkMethodAvailability')
          return async (request: { method: string; params?: unknown }) => {
            const wireMethod = request.method.startsWith(`${namespace}.`)
              ? request.method
              : `${namespace}.${request.method}`
            const availability = (await call(`${namespace}.availability`, {
              ...(namespace === 'account' ? { account: id } : { profile: id }),
              method: wireMethod,
              params: (request.params ?? {}) as Record<string, unknown>,
            })) as ProviderAvailability
            const result = availability.methods[wireMethod]
            if (!result) throw new Error('method availability was not returned')
            return result
          }
        if (property === 'exportSession')
          return () => {
            throw new Error('local client sessions cannot be exported through a proxy')
          }
        if (property === 'close') return () => {}
        return undefined
      },
    })

  return {
    methods,
    call,
    accounts: async () => entries.map((entry) => entry.account),
    account: (accountId) => scopedProxy({ account: accountId }, 'account'),
    profile: (profileId) => scopedProxy({ profile: profileId }, 'profile'),
    connectProfile: async () => {
      throw new Error('local client does not support profile connections')
    },
    completeProfileConnection: async () => {
      throw new Error('local client does not support profile connections')
    },
    syncProfile: async () => {
      throw new Error('local client does not support profile connections')
    },
    close: async () => {
      await Promise.all(entries.map(({ provider }) => provider.close()))
    },
  }
}

export type * from '@mnie/types'
