import { eq } from 'drizzle-orm'
import { createBitwardenAuthManager } from '@mnie/auth-bitwarden'
import { ensureInitialAssetValuations, latestAssetValuations } from '../assets'
import type { CronSystem } from '../cron'
import type { Db } from '../db'
import { accountProfiles, authManagers } from '../db/schema'
import { forceSyncHistory, syncHistorySinceLastCoverage } from '../history'
import type { StoredBitwardenAuthManagerSecret } from '../providers/credentials'
import type { StoredPayPaySecSecret } from '../providers/credentials'
import type { ProviderRegistry } from '../providers/registry'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKeySettings,
  type ApiKeySettings,
} from '../security/api-keys'
import { randomId } from '../security/crypto'
import { deleteSecret, readSecret, saveSecret } from '../security/keyring'
import { ADMIN_OPERATIONS } from './admin-operations'
import { discoverPhysicalAccounts, syncInitialUnallocatedAssets } from '../physical-accounts'
import {
  bindApiKeyToVirtualAccount,
  updateVirtualAccount,
  revokeAccountAccess,
  approvePhysicalAccountReconciliation,
  createVirtualAccount,
  ensureDefaultVirtualAccounts,
  initializeVirtualAccounts,
  listVirtualAccountInitializations,
  listManagedVirtualAccounts,
  transferVirtualAsset,
  transferVirtualAssets,
} from '../virtual-accounts'

export { ADMIN_OPERATIONS } from './admin-operations'

const requiredString = (input: Record<string, unknown>, key: string) => {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export class AdminRpcService {
  constructor(
    readonly db: Db,
    readonly providers: ProviderRegistry,
    readonly cron: CronSystem,
  ) {}

  operations() {
    return ADMIN_OPERATIONS
  }

  async invoke(operation: string, input: Record<string, unknown>) {
    if (operation === 'providers.list') return { providers: this.providers.definitions() }
    if (operation === 'apiKeys.list') return { apiKeys: await listApiKeys(this.db) }
    if (operation === 'apiKeys.create') {
      const apiKey = await createApiKey(
        this.db,
        requiredString(input, 'label'),
        input.settings as ApiKeySettings | undefined,
      )
      return { apiKey }
    }
    if (operation === 'apiKeys.update') {
      await updateApiKeySettings(
        this.db,
        requiredString(input, 'id'),
        input.settings as ApiKeySettings,
      )
      return { ok: true }
    }
    if (operation === 'apiKeys.revoke') {
      await revokeApiKey(this.db, requiredString(input, 'id'))
      return { ok: true }
    }
    if (operation === 'apiKeys.bind') {
      const role = requiredString(input, 'role')
      if (role !== 'read' && role !== 'trade') throw new Error('role must be read or trade')
      await bindApiKeyToVirtualAccount(
        this.db,
        requiredString(input, 'apiKeyId'),
        requiredString(input, 'accountId'),
        role,
      )
      return { ok: true }
    }

    if (
      ['accounts.update', 'accounts.freeze', 'accounts.unfreeze', 'accounts.close'].includes(
        operation,
      )
    ) {
      return updateVirtualAccount(this.db, requiredString(input, 'accountId'), {
        expectedVersion: Number(input.expectedVersion),
        label: optionalString(input.label),
        policy: input.policy as Record<string, unknown> | undefined,
        status: operation.endsWith('.freeze')
          ? 'frozen'
          : operation.endsWith('.unfreeze')
            ? 'active'
            : operation.endsWith('.close')
              ? 'closed'
              : undefined,
      })
    }
    if (operation === 'accountAccess.revoke')
      return revokeAccountAccess(
        this.db,
        requiredString(input, 'apiKeyId'),
        requiredString(input, 'accountId'),
      )
    if (operation === 'accountAccess.list') {
      const { apiKeyVirtualAccounts, apiKeys } = await import('../db/schema')
      return {
        items: await this.db
          .select({
            apiKeyId: apiKeys.id,
            label: apiKeys.label,
            role: apiKeyVirtualAccounts.role,
            lastUsedAt: apiKeys.lastUsedAt,
            revokedAt: apiKeys.revokedAt,
          })
          .from(apiKeyVirtualAccounts)
          .innerJoin(apiKeys, eq(apiKeys.id, apiKeyVirtualAccounts.apiKeyId))
          .where(eq(apiKeyVirtualAccounts.virtualAccountId, requiredString(input, 'accountId'))),
      }
    }
    if (operation === 'accounts.activity') {
      const { accountActivity } = await import('../account-read-model')
      return accountActivity(this.db, requiredString(input, 'accountId'), { owner: true })
    }
    if (operation === 'accounts.reconciliation.inspect') {
      const { inspectAccountReconciliation } = await import('../account-reconciliation')
      return inspectAccountReconciliation(this.db, requiredString(input, 'physicalAccountId'))
    }
    if (operation === 'accounts.orders.reconcile') {
      const { PhysicalAccountGateway } = await import('../physical-account-gateway')
      const { reconcileOrderReference } = await import('../account-reconciliation')
      const gateway = new PhysicalAccountGateway(this.providers)
      try {
        return await reconcileOrderReference(
          this.db,
          gateway,
          requiredString(input, 'orderId'),
          requiredString(input, 'providerOrderId'),
        )
      } finally {
        await gateway.close()
      }
    }
    if (operation === 'accounts.migrate') {
      const { PhysicalAccountGateway } = await import('../physical-account-gateway')
      const { migratePhysicalAccount } = await import('../account-migration')
      const gateway = new PhysicalAccountGateway(this.providers)
      try {
        return await migratePhysicalAccount(
          this.db,
          gateway,
          requiredString(input, 'physicalAccountId'),
        )
      } finally {
        await gateway.close()
      }
    }
    if (operation === 'accounts.create') {
      return {
        account: await createVirtualAccount(this.db, {
          physicalAccountId: requiredString(input, 'physicalAccountId'),
          label: requiredString(input, 'label'),
          allocations: Array.isArray(input.allocations)
            ? (input.allocations as Array<{
                fromAccountId: string
                assetKey: string
                amount: string
                expectedFromVersion: number
                reason: string
              }>)
            : undefined,
          color: optionalString(input.color),
          icon: optionalString(input.icon),
          policy:
            input.policy && typeof input.policy === 'object' && !Array.isArray(input.policy)
              ? (input.policy as Record<string, unknown>)
              : undefined,
        }),
      }
    }
    if (operation === 'accounts.initialize') {
      return initializeVirtualAccounts(this.db, requiredString(input, 'physicalAccountId'))
    }
    if (operation === 'accounts.initializations.list') {
      return { physicalAccountIds: await listVirtualAccountInitializations(this.db) }
    }
    if (operation === 'accounts.defaults.ensure') {
      await discoverPhysicalAccounts(this.db, this.providers)
      const defaults = await ensureDefaultVirtualAccounts(this.db)
      const assets = await syncInitialUnallocatedAssets(this.db, this.providers)
      return { ...defaults, ...assets }
    }
    if (operation === 'accounts.list') {
      const { listFinancialAccounts } = await import('../reconciliation')
      const [virtual, physical] = await Promise.all([
        listManagedVirtualAccounts(this.db),
        listFinancialAccounts(this.db),
      ])
      return {
        accounts: [
          ...physical.map((account) => ({ layer: 'physical' as const, ...account })),
          ...virtual.map((account) => ({ layer: 'virtual' as const, ...account })),
        ],
      }
    }
    if (operation === 'accounts.assets.transferBatch') {
      if (!Array.isArray(input.transfers)) throw new Error('transfers are required')
      return {
        transfers: transferVirtualAssets(
          this.db,
          input.transfers as Array<Parameters<typeof transferVirtualAsset>[1]>,
        ),
      }
    }
    if (operation === 'accounts.assets.transfer') {
      return transferVirtualAsset(this.db, {
        fromAccountId: requiredString(input, 'fromAccountId'),
        toAccountId: requiredString(input, 'toAccountId'),
        assetKey: requiredString(input, 'assetKey'),
        amount: requiredString(input, 'amount'),
        expectedFromVersion: Number(input.expectedFromVersion),
        expectedToVersion: Number(input.expectedToVersion),
        reason: requiredString(input, 'reason'),
      })
    }
    if (operation === 'accounts.reconciliation.approve') {
      return approvePhysicalAccountReconciliation(
        this.db,
        requiredString(input, 'physicalAccountId'),
      )
    }

    if (operation === 'authManagers.list') {
      const rows = await this.db.select().from(authManagers).orderBy(authManagers.createdAt)
      return {
        authManagers: rows.map(({ keyringAccount: _keyringAccount, ...manager }) => manager),
      }
    }
    if (operation === 'authManagers.create') return this.createAuthManager(input)
    if (operation === 'authManagers.delete') return this.deleteAuthManager(input)
    if (operation === 'authManagers.credentials.list') return this.authManagerCredentials(input)

    if (operation === 'profiles.list') {
      const rows = await this.providers.profiles()
      return {
        profiles: rows.map(({ keyringAccount: _keyringAccount, ...profile }) => {
          const descriptor = this.providers.descriptor({
            ...profile,
            keyringAccount: _keyringAccount,
          })
          return {
            ...profile,
            providerName: descriptor.provider.name,
            category: descriptor.category,
            defaultColor: descriptor.defaultColor,
          }
        }),
      }
    }
    if (operation === 'profiles.create') return this.createProfile(input)
    if (operation === 'profiles.update') return this.updateProfile(input)
    if (operation === 'profiles.delete') return this.deleteProfile(input)
    if (operation === 'profiles.availability.cached') {
      const profileId = optionalString(input.profileId)
      return {
        availability: Object.fromEntries(
          Object.entries(this.cron.availability(profileId)).map(([id, value]) => [
            id,
            {
              ...value.result,
              methods: value.methods,
              checkedAt: value.checkedAt.toISOString(),
            },
          ]),
        ),
      }
    }
    if (operation === 'profiles.availability.refresh') {
      const profileId = optionalString(input.profileId)
      const profiles = (await this.providers.profiles()).filter(
        (profile) => !profileId || profile.id === profileId,
      )
      const values = await Promise.all(
        profiles.map(
          async (profile) => [profile.id, await this.providers.availability(profile)] as const,
        ),
      )
      for (const [id, availability] of values) {
        this.cron.setAvailability(id, {
          result: availability.connection,
          methods: availability.methods,
          checkedAt: new Date(availability.checkedAt),
        })
      }
      return {
        availability: Object.fromEntries(
          values.map(([id, value]) => [
            id,
            {
              ...value.connection,
              methods: value.methods,
              checkedAt: value.checkedAt,
            },
          ]),
        ),
      }
    }

    if (operation === 'profiles.mobileSuica.login.start') {
      return this.startMobileSuicaLogin(input)
    }
    if (operation === 'profiles.mobileSuica.login.complete') {
      return this.completeMobileSuicaLogin(input)
    }
    if (operation === 'assets.valuations.latest') {
      await ensureInitialAssetValuations(this.db, this.providers)
      return { valuations: await latestAssetValuations(this.db) }
    }
    if (operation === 'history.sync') {
      return forceSyncHistory(this.db, this.providers, {
        profileId: requiredString(input, 'profileId'),
        from: requiredString(input, 'from'),
        to: requiredString(input, 'to'),
      })
    }
    if (operation === 'accounts.discover') {
      return discoverPhysicalAccounts(this.db, this.providers)
    }
    if (operation === 'history.sync.since-last') {
      return syncHistorySinceLastCoverage(
        this.db,
        this.providers,
        requiredString(input, 'profileId'),
      )
    }
    if (operation === 'jobs.list') return { jobs: this.cron.jobs() }

    throw new Error(`admin operation not found: ${operation}`)
  }

  private async createAuthManager(input: Record<string, unknown>) {
    const kind = String(input.kind ?? 'bitwarden')
    if (kind !== 'bitwarden') throw new Error(`unsupported auth manager: ${kind}`)
    const label = requiredString(input, 'label')
    const id = randomId('auth')
    const keyringAccount = `auth-manager:${id}`
    await saveSecret(keyringAccount, {
      dataPath: optionalString(input.dataPath),
    } satisfies StoredBitwardenAuthManagerSecret)
    const now = new Date()
    await this.db.insert(authManagers).values({
      id,
      kind,
      label,
      keyringAccount,
      createdAt: now,
      updatedAt: now,
    })
    return { authManager: { id, kind, label, createdAt: now, updatedAt: now } }
  }

  private async deleteAuthManager(input: Record<string, unknown>) {
    const id = requiredString(input, 'id')
    const [row] = await this.db.select().from(authManagers).where(eq(authManagers.id, id)).limit(1)
    if (!row) throw new Error('auth manager not found')
    await deleteSecret(row.keyringAccount)
    await this.db.delete(authManagers).where(eq(authManagers.id, row.id))
    return { ok: true }
  }

  private async authManagerCredentials(input: Record<string, unknown>) {
    const id = requiredString(input, 'id')
    const providerId = requiredString(input, 'providerId')
    const masterPassword = requiredString(input, 'masterPassword')
    const [row] = await this.db.select().from(authManagers).where(eq(authManagers.id, id)).limit(1)
    if (!row) throw new Error('auth manager not found')
    const secret = await readSecret<StoredBitwardenAuthManagerSecret>(row.keyringAccount)
    const manager = createBitwardenAuthManager({ ...secret, masterPassword })
    return {
      credentials: await manager.credentials({
        origin: this.providers.credentialOrigin(providerId),
      }),
    }
  }

  private async createProfile(input: Record<string, unknown>) {
    const providerId = requiredString(input, 'providerId')
    const label = requiredString(input, 'label')
    const credentials =
      input.credentials &&
      typeof input.credentials === 'object' &&
      !Array.isArray(input.credentials)
        ? (input.credentials as Record<string, unknown>)
        : {}
    const profile = await this.providers.createProfile({ providerId, label, credentials })
    return { profile }
  }

  private async updateProfile(input: Record<string, unknown>) {
    const id = requiredString(input, 'id')
    const label = requiredString(input, 'label')
    const color = requiredString(input, 'color').toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('color must be a hex color')
    const profile = await this.providers.profile(id)
    const tradePassword = optionalString(input.tradePassword)
    if (tradePassword) {
      if (profile.provider !== 'paypay-sec') {
        throw new Error('tradePassword can only be updated for PayPay Securities')
      }
      const secret = await readSecret<StoredPayPaySecSecret>(profile.keyringAccount)
      await saveSecret(profile.keyringAccount, { ...secret, tradePassword })
    }
    const now = new Date()
    await this.db
      .update(accountProfiles)
      .set({ label, color, updatedAt: now })
      .where(eq(accountProfiles.id, id))
    return { profile: { ...profile, label, color, updatedAt: now, keyringAccount: undefined } }
  }

  private async deleteProfile(input: Record<string, unknown>) {
    await this.providers.deleteProfile(requiredString(input, 'id'))
    return { ok: true }
  }

  private async startMobileSuicaLogin(input: Record<string, unknown>) {
    return this.providers.startMobileSuicaLogin(input)
  }

  private async completeMobileSuicaLogin(input: Record<string, unknown>) {
    const interactionId = requiredString(input, 'interactionId')
    return this.providers.completeMobileSuicaLogin(interactionId, requiredString(input, 'answer'))
  }
}
