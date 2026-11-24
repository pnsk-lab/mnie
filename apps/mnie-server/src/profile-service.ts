import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { apiKeys, apiKeyVirtualAccounts, financialAccounts, virtualAccounts } from './db/schema'
import type { ProviderRegistry } from './providers/registry'
import { PhysicalAccountGateway } from './physical-account-gateway'
import { PUBLIC_READ_METHODS } from './rpc/methods'
import type { AccountAccess } from './account-policy'
import { assertApiKeyMethodAllowed, isTransactionOperation } from './security/trade-limits'

export class ProfileRpcService {
  readonly gateway: PhysicalAccountGateway
  constructor(
    private readonly db: Db,
    providers: ProviderRegistry,
  ) {
    this.gateway = new PhysicalAccountGateway(providers)
  }
  close() {
    return this.gateway.close()
  }
  async #keyProfileIds(apiKeyId: string) {
    return new Set(
      this.db
        .select({ profileId: financialAccounts.profileId })
        .from(apiKeyVirtualAccounts)
        .innerJoin(virtualAccounts, eq(virtualAccounts.id, apiKeyVirtualAccounts.virtualAccountId))
        .innerJoin(financialAccounts, eq(financialAccounts.id, virtualAccounts.physicalAccountId))
        .where(eq(apiKeyVirtualAccounts.apiKeyId, apiKeyId))
        .all()
        .map((row) => row.profileId),
    )
  }
  async dispatch(
    method: string,
    params: Record<string, unknown>,
    access: AccountAccess & { scopes?: string[] },
  ) {
    if (!method.startsWith('profile.')) throw new Error('profile method not found')
    const op = method.slice('profile.'.length)
    const profileId = String(params.profile ?? '')
    if (!profileId) throw new Error('profile is required')
    const { profile: _profile, ...rest } = params
    const input =
      access.apiKeyId && 'account' in rest
        ? (Object.fromEntries(Object.entries(rest).filter(([key]) => key !== 'account')) as Record<
            string,
            unknown
          >)
        : rest
    if (access.apiKeyId) {
      const backed = await this.#keyProfileIds(access.apiKeyId)
      if (!backed.has(profileId)) throw new Error('profile is not accessible')
    }
    const advertised = await this.gateway.methods(profileId)
    const forApiKey = access.owner && method === 'profile.operations' && params.forApiKey === true
    let operations = advertised.filter(
      (name) =>
        !isTransactionOperation(name) &&
        ((access.owner && !forApiKey) || PUBLIC_READ_METHODS.has(name) || name === 'accounts.list'),
    )
    if (access.apiKeyId) {
      const key = this.db.select().from(apiKeys).where(eq(apiKeys.id, access.apiKeyId)).get()
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()))
        throw new Error('API key is not active')
      if (
        ['profile.operations', 'profile.capabilities', 'profile.availability'].includes(method) &&
        key.allowedMethods !== null &&
        !key.allowedMethods.includes(method)
      )
        throw new Error('profile method not found')
      if (key.allowedMethods !== null)
        operations = operations.filter((name) => key.allowedMethods!.includes(`profile.${name}`))
    }
    const wire = (name: string) => `profile.${name}`
    if (method === 'profile.operations') return operations.map(wire)
    if (method === 'profile.capabilities') return this.gateway.capabilities(profileId)
    if (method === 'profile.availability') {
      const requested = typeof params.method === 'string' ? params.method : undefined
      const methodParams =
        params.params && typeof params.params === 'object' && !Array.isArray(params.params)
          ? (params.params as Record<string, unknown>)
          : {}
      if (!requested) {
        return {
          connection: { ok: true },
          methods: Object.fromEntries(operations.map((name) => [wire(name), { available: true }])),
          checkedAt: new Date().toISOString(),
        }
      }
      const requestedOp = requested.startsWith('profile.')
        ? requested.slice('profile.'.length)
        : requested
      try {
        if (!operations.includes(requestedOp)) throw new Error('method is unavailable')
        const status = await this.gateway.methodAvailability(profileId, {
          method: requestedOp,
          params: methodParams,
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
    if (!operations.includes(op)) throw new Error('profile method not found')
    if (access.apiKeyId) await assertApiKeyMethodAllowed(this.db, access.apiKeyId, method)
    return this.gateway.invokeMethod(profileId, op, input)
  }
}
