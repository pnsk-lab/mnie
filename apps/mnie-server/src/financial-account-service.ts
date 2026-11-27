import { syncAccountOrdersUnlocked } from './account-sync'
import { withProfileLock } from './profile-lock'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db'
import type { ProviderRegistry } from './providers/registry'
import { PhysicalAccountGateway } from './physical-account-gateway'
import { PUBLIC_READ_METHODS } from './rpc/methods'
import {
  accountBalances,
  accountHistory,
  accountOrders,
  accountPositions,
  accountValuation,
} from './account-read-model'
import {
  getVirtualAccountTarget,
  listVirtualAccountAssets,
  reconcilePhysicalAccount,
} from './virtual-accounts'
import { assertAccountTrade, type AccountAccess } from './account-policy'
import {
  createCoordinatedOrder,
  changeCoordinatedOrder,
  publicOrder,
  storeOrderQuote,
} from './order-coordinator'
import {
  virtualOrders,
  virtualOrderQuotes,
  apiKeys,
  apiKeyVirtualAccounts,
  financialAccounts,
} from './db/schema'
import { ProviderMethodUnavailableError } from './providers/operations'
import { isTransactionOperation } from './security/trade-limits'
import { clearLegacyPhysicalSyncError, clearPhysicalSyncError } from './sync-errors'

const localOps = new Set([
  'accounts.list',
  'balances.list',
  'assets.valuation.get',
  'investments.positions.list',
  'investments.positions.get',
  'investments.orders.list',
  'investments.orders.get',
  'transactions.list',
  'history.list',
])
const writes = new Set([
  'investments.orders.preview',
  'investments.orders.create',
  'investments.orders.replace.preview',
  'investments.orders.replace',
  'investments.orders.cancel',
])
export class FinancialAccountService {
  readonly gateway: PhysicalAccountGateway
  #accountId?: string
  #quoteIds = new Set<string>()
  #invalidateQuotes() {
    if (this.#quoteIds.size)
      this.db
        .delete(virtualOrderQuotes)
        .where(inArray(virtualOrderQuotes.id, [...this.#quoteIds]))
        .run()
    this.#quoteIds.clear()
  }
  constructor(
    private readonly db: Db,
    providers: ProviderRegistry,
  ) {
    this.gateway = new PhysicalAccountGateway(providers)
  }
  close() {
    this.#invalidateQuotes()
    return this.gateway.close()
  }
  async connectProfile(profileId: string) {
    if (!profileId) throw new Error('profileId is required')
    const connection = await withProfileLock(profileId, () =>
      this.gateway.connect(profileId, false),
    )
    return {
      status: connection.status,
      providerId: connection.providerId,
      profileId,
      ...('interaction' in connection ? { interaction: connection.interaction } : {}),
    }
  }
  async completeProfileConnection(profileId: string, interactionId: string) {
    if (!profileId) throw new Error('profileId is required')
    const connection = await withProfileLock(profileId, () =>
      this.gateway.complete(profileId, interactionId),
    )
    return {
      status: connection.status,
      providerId: connection.providerId,
      profileId,
      ...('interaction' in connection ? { interaction: connection.interaction } : {}),
    }
  }
  async syncProfile(profileId: string) {
    if (!profileId) throw new Error('profileId is required')
    return withProfileLock(profileId, async () => {
      const physicals = this.db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.profileId, profileId))
        .all()
      const results: Array<{ physicalAccountId: string; locked: boolean }> = []
      for (const physical of physicals) {
        await this.gateway.snapshot(this.db, physical)
        clearPhysicalSyncError(this.db, physical.id, 'physical_assets')
        clearLegacyPhysicalSyncError(this.db, physical.id)
        const reconciliation = await reconcilePhysicalAccount(this.db, physical.id)
        results.push({ physicalAccountId: physical.id, locked: reconciliation.locked })
      }
      return { profileId, results }
    })
  }
  async #orderInput(
    target: Awaited<ReturnType<typeof getVirtualAccountTarget>>,
    input: Record<string, unknown>,
    access: AccountAccess,
  ) {
    const physicalInput = { ...input, account: target.providerAccountId }
    if (!input.positionId) return physicalInput
    const position = (await accountPositions(this.db, target.account.id, access)).find(
      (item) => item.id === input.positionId,
    )
    if (!position || position.instrumentId !== input.instrumentId)
      throw new Error('position not found')
    const snapshot = (await this.gateway.positionSnapshot(target.profileId, {
      account: target.providerAccountId,
      positionType: 'cash',
    })) as {
      items: Array<{
        id: string
        instrumentId: string
        venue?: string
        market?: string
        accountType?: string
      }>
    }
    const source = snapshot.items.find(
      (item) =>
        item.instrumentId === position.instrumentId &&
        (item.venue ?? item.market) === position.venue &&
        (item.accountType ?? 'unspecified') === (position.accountType ?? 'unspecified'),
    )
    if (!source) throw new Error('physical position is unavailable')
    return { ...physicalInput, positionId: source.id }
  }
  async dispatch(
    method: string,
    params: Record<string, unknown>,
    access: AccountAccess & { scopes?: string[]; adminAuthorized?: boolean },
  ) {
    if (
      method === 'admin.profiles.connect' ||
      method === 'admin.profiles.connection.complete' ||
      method === 'admin.profiles.sync'
    ) {
      if (!access.owner && !access.adminAuthorized)
        throw new Error(
          'owner session or explicit admin permission is required for connection lifecycle',
        )
      if (method === 'admin.profiles.connect')
        return this.connectProfile(String(params.profileId ?? ''))
      if (method === 'admin.profiles.sync') return this.syncProfile(String(params.profileId ?? ''))
      return this.completeProfileConnection(
        String(params.profileId ?? ''),
        String(params.interactionId ?? ''),
      )
    }
    if (!method.startsWith('account.')) throw new Error('account method not found')
    const op = method.slice('account.'.length)
    const accountId = String(params.account ?? '')
    if (!accountId) throw new Error('account is required')
    const target = await getVirtualAccountTarget(this.db, accountId, access)
    if (this.#accountId && this.#accountId !== accountId) this.#invalidateQuotes()
    this.#accountId = accountId
    const { account: _account, ...input } = params
    if (
      [
        'parentId',
        'physicalAccountId',
        'providerOrderId',
        'reservationId',
        'principal',
        'effects',
        'projectedAssetChanges',
        'state',
      ].some((key) => key in input)
    )
      throw new Error('internal order fields are not accepted')
    // The public account ID is the only accepted account selector.
    if ('accountId' in input) throw new Error('raw account IDs are not accepted')
    const physicalInput = { ...input, account: target.providerAccountId }
    const available = await this.gateway.methods(target.profileId)
    const forApiKey = access.owner && method === 'account.operations' && params.forApiKey === true
    const passthrough = available.filter(
      (name) =>
        !localOps.has(name) &&
        !writes.has(name) &&
        !isTransactionOperation(name) &&
        ((access.owner && !forApiKey) || PUBLIC_READ_METHODS.has(name)),
    )
    let operations = [
      ...new Set([...localOps, ...available.filter((name) => writes.has(name)), ...passthrough]),
    ].filter((name) => target.account.permissions.trade || !writes.has(name))
    if (access.apiKeyId) {
      const key = this.db.select().from(apiKeys).where(eq(apiKeys.id, access.apiKeyId)).get()
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()))
        throw new Error('API key is not active')
      const binding = this.db
        .select()
        .from(apiKeyVirtualAccounts)
        .where(
          and(
            eq(apiKeyVirtualAccounts.apiKeyId, access.apiKeyId),
            eq(apiKeyVirtualAccounts.virtualAccountId, accountId),
          ),
        )
        .get()
      if (!binding) throw new Error('account access is not granted')
      if (
        ['account.operations', 'account.capabilities', 'account.availability'].includes(method) &&
        binding.allowedMethods !== null &&
        !binding.allowedMethods.includes(method)
      )
        throw new Error('account method not found')
      if (binding.allowedMethods !== null)
        operations = operations.filter((name) =>
          binding.allowedMethods!.includes(`account.${name}`),
        )
    }
    const wire = (name: string) => `account.${name}`
    if (method === 'account.operations') return operations.map(wire)
    if (method === 'account.capabilities')
      return target.account.capabilities.filter(
        (capability) =>
          capability !== 'investments:trade' || operations.some((name) => writes.has(name)),
      )
    if (method === 'account.availability') {
      const requested = typeof params.method === 'string' ? params.method : undefined
      const methodParams =
        params.params && typeof params.params === 'object' && !Array.isArray(params.params)
          ? (params.params as Record<string, unknown>)
          : {}
      if (!requested) {
        let tradingReason: string | undefined
        try {
          await this.gateway.assertVirtualTrading(target.profileId)
        } catch (cause) {
          tradingReason =
            cause instanceof Error
              ? cause.message
              : 'provider does not support virtual-account trading'
        }
        return {
          connection: { ok: true },
          methods: Object.fromEntries(
            operations.map((name) => [
              wire(name),
              writes.has(name) && tradingReason
                ? { available: false, reason: 'PROVIDER_RESTRICTED', message: tradingReason }
                : { available: true },
            ]),
          ),
          checkedAt: new Date().toISOString(),
        }
      }
      const requestedOp = requested.startsWith('account.')
        ? requested.slice('account.'.length)
        : requested
      try {
        if (!operations.includes(requestedOp)) throw new Error('method is unavailable')
        if (writes.has(requestedOp)) {
          await this.gateway.assertVirtualTrading(target.profileId)
          const hasMethodParams = Object.keys(methodParams).length > 0
          assertAccountTrade(
            this.db,
            accountId,
            access,
            hasMethodParams ? methodParams : input,
            requestedOp,
            { allowVenueScopedWhenVenueOmitted: !hasMethodParams },
          )
        }
        const status = localOps.has(requestedOp)
          ? { available: true }
          : await this.gateway.methodAvailability(target.profileId, {
              method: requestedOp,
              params: Object.keys(methodParams).length
                ? { ...methodParams, account: target.providerAccountId }
                : undefined,
            })
        return {
          connection: { ok: true },
          methods: { [wire(requestedOp)]: status },
          checkedAt: new Date().toISOString(),
        }
      } catch (error) {
        return {
          connection: { ok: true },
          methods: {
            [wire(requestedOp)]: {
              available: false,
              reason: 'PROVIDER_RESTRICTED',
              message: error instanceof Error ? error.message : 'method unavailable',
            },
          },
          checkedAt: new Date().toISOString(),
        }
      }
    }
    if (!operations.includes(op)) throw new Error('account method not found')
    const transaction = isTransactionOperation(op, input)
    if (access.apiKeyId && !(access.scopes ?? []).includes(transaction ? 'trade' : 'read'))
      throw new Error(`missing OAuth scope: ${transaction ? 'trade' : 'read'}`)
    if (op === 'accounts.list')
      return {
        items: [
          {
            id: accountId,
            providerId: 'mnie',
            name: target.account.label,
            kind: target.physical.kind,
          },
        ],
      }
    if (op === 'balances.list') return accountBalances(this.db, accountId, access)
    if (op === 'assets.valuation.get') {
      const valuation = await accountValuation(this.db, access, {
        account: accountId,
        baseCurrency: input.baseCurrency,
      })
      return { amount: valuation.total, asOf: valuation.asOf }
    }
    if (op === 'investments.positions.list')
      return { items: await accountPositions(this.db, accountId, access) }
    if (op === 'investments.positions.get') {
      const position = (await accountPositions(this.db, accountId, access)).find(
        (item) =>
          item.instrumentId === input.instrumentId &&
          item.venue === input.venue &&
          (!input.accountType || item.accountType === input.accountType),
      )
      if (!position) throw new Error('position not found')
      return position
    }
    if (op === 'investments.orders.list')
      return {
        items: (await accountOrders(this.db, accountId, access)).filter(
          (order) => !input.status || order.status === input.status,
        ),
      }
    if (op === 'investments.orders.get') {
      const order = this.db
        .select()
        .from(virtualOrders)
        .where(
          and(
            eq(virtualOrders.id, String(input.orderId ?? '')),
            eq(virtualOrders.accountId, accountId),
          ),
        )
        .get()
      if (!order) throw new Error('order not found')
      return publicOrder(order)
    }
    if (op === 'history.list')
      return accountHistory(this.db, access, { ...input, account: accountId })
    if (op === 'transactions.list') {
      const history = await accountHistory(this.db, access, { ...input, account: accountId })
      return {
        items: history.items.flatMap((item) =>
          item.kind === 'transaction' ? [item.transaction] : [],
        ),
      }
    }
    if (writes.has(op))
      return withProfileLock(`financial:${target.physicalAccountId}`, async () => {
        await this.gateway.assertVirtualTrading(target.profileId)
        if (
          op === 'investments.orders.create' &&
          input.idempotencyKey &&
          this.db
            .select()
            .from(virtualOrders)
            .where(
              and(
                eq(virtualOrders.accountId, accountId),
                eq(virtualOrders.idempotencyKey, String(input.idempotencyKey)),
              ),
            )
            .get()
        ) {
          return createCoordinatedOrder(this.db, accountId, access, input, async () => {
            throw new Error('idempotent replay must not submit')
          })
        }
        const reconciliation = await syncAccountOrdersUnlocked(
          this.db,
          this.gateway,
          target.physicalAccountId,
        )
        if (reconciliation.locked) throw new Error('physical account requires reconciliation')
        if (op === 'investments.orders.preview' || op === 'investments.orders.replace.preview') {
          const parent = input.orderId
            ? this.db
                .select()
                .from(virtualOrders)
                .where(
                  and(
                    eq(virtualOrders.id, String(input.orderId)),
                    eq(virtualOrders.accountId, accountId),
                  ),
                )
                .get()
            : undefined
          assertAccountTrade(this.db, accountId, access, { ...parent?.request, ...input }, op)
          const availability = await this.gateway.methodAvailability(target.profileId, {
            method: op,
            params: physicalInput,
          })
          if (!availability.available) throw new ProviderMethodUnavailableError(op, availability)
          let previewInput: Record<string, unknown> = await this.#orderInput(target, input, access)
          if (op === 'investments.orders.replace.preview') {
            const parent = this.db
              .select()
              .from(virtualOrders)
              .where(
                and(
                  eq(virtualOrders.id, String(input.orderId ?? '')),
                  eq(virtualOrders.accountId, accountId),
                ),
              )
              .get()
            if (!parent?.providerOrderId || !['open', 'partially_filled'].includes(parent.state))
              throw new Error('order not found')
            previewInput = { ...physicalInput, orderId: parent.providerOrderId }
          }
          const preview = (await this.gateway.previewOrder(
            target.profileId,
            previewInput,
            op === 'investments.orders.replace.preview',
          )) as Record<string, unknown>
          const assets = await listVirtualAccountAssets(this.db, accountId, access)
          const changes = preview.projectedAssetChanges as
            | import('@mnie/types').FinancialAssetChange[]
            | undefined
          if (!changes?.length) throw new Error('provider cannot determine a safe reservation')
          // Balance eligibility is enforced atomically at submit. The preview remains account bound.
          const publicPreview = await storeOrderQuote(
            this.db,
            accountId,
            access,
            op,
            input,
            preview,
          )
          this.#quoteIds.add(publicPreview.quoteId)
          return { ...publicPreview, assets }
        }
        if (op === 'investments.orders.create') {
          const result = await createCoordinatedOrder(
            this.db,
            accountId,
            access,
            input,
            async (confirmed) =>
              this.gateway.placeOrder(
                target.profileId,
                await this.#orderInput(target, confirmed, access),
              ),
            async (confirmed) => {
              const availability = await this.gateway.methodAvailability(target.profileId, {
                method: op,
                params: { ...confirmed, account: target.providerAccountId },
              })
              if (!availability.available)
                throw new ProviderMethodUnavailableError(op, availability)
              return { transactionAmount: availability.transactionAmount }
            },
          )
          await reconcilePhysicalAccount(this.db, target.physicalAccountId)
          return result
        }
        if (op === 'investments.orders.cancel' || op === 'investments.orders.replace') {
          const action = op === 'investments.orders.cancel' ? 'cancel' : 'replace'
          const result = await changeCoordinatedOrder(
            this.db,
            accountId,
            access,
            action,
            input,
            (command) =>
              action === 'cancel'
                ? this.gateway.cancelOrder(target.profileId, {
                    ...command,
                    account: target.providerAccountId,
                  })
                : this.gateway.replaceOrder(target.profileId, {
                    ...command,
                    account: target.providerAccountId,
                  }),
            async (command) => {
              const availability = await this.gateway.methodAvailability(target.profileId, {
                method: op,
                params: { ...command, account: target.providerAccountId },
              })
              if (!availability.available)
                throw new ProviderMethodUnavailableError(op, availability)
              return { transactionAmount: availability.transactionAmount }
            },
          )
          await reconcilePhysicalAccount(this.db, target.physicalAccountId)
          return result
        }
        throw new Error('unsupported account method')
      })
    return this.gateway.invokeMethod(target.profileId, op, physicalInput)
  }
}
