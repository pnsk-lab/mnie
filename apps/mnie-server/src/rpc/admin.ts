import { eq } from 'drizzle-orm'
import { createBitwardenAuthManager } from '@mnie/auth-bitwarden'
import { captchaModelPath, createCaptchaSolver, type CaptchaSolver } from '@repo/capsolve-sp'
import { ensureInitialAssetValuations, latestAssetValuations } from '../assets'
import type { CronSystem } from '../cron'
import type { Db } from '../db'
import { accountProfiles, authManagers } from '../db/schema'
import { forceSyncHistory } from '../history'
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

export { ADMIN_OPERATIONS } from './admin-operations'

const requiredString = (input: Record<string, unknown>, key: string) => {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export class AdminRpcService {
  #captchaSolver?: Promise<CaptchaSolver>

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
              operations: value.operations,
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
          operations: availability.operations,
          checkedAt: new Date(availability.checkedAt),
        })
      }
      return {
        availability: Object.fromEntries(
          values.map(([id, value]) => [
            id,
            {
              ...value.connection,
              operations: value.operations,
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

  private solveCaptcha(image: Uint8Array) {
    this.#captchaSolver ??= createCaptchaSolver(captchaModelPath())
    return this.#captchaSolver.then((solver) => solver.solve(image))
  }

  private async startMobileSuicaLogin(input: Record<string, unknown>) {
    return this.providers.startMobileSuicaLogin(input, (image) => this.solveCaptcha(image))
  }

  private async completeMobileSuicaLogin(input: Record<string, unknown>) {
    const interactionId = requiredString(input, 'interactionId')
    return this.providers.completeMobileSuicaLogin(interactionId, requiredString(input, 'answer'))
  }
}
