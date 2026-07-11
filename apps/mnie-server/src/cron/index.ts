import { eq } from 'drizzle-orm'
import {
  continueSession as continueSmbcDirectSession,
  exportSession as exportSmbcDirectSession,
  importSession as importSmbcDirectSession,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import {
  createProvider as createMobileSuicaProvider,
  exportSession as exportMobileSuicaSession,
  importSession as importMobileSuicaSession,
} from '../../../../packages/provider-mobile-suica/src'
import type { Db } from '../db'
import { accountProfiles } from '../db/schema'
import type { StoredMobileSuicaSecret, StoredSmbcDirectSecret } from '../routes/admin'
import { readSecret, saveSecret } from '../security/keyring'
import { checkProfileAvailability, listProfiles, type CachedAvailability } from '../availability'
import type { ServerConfig } from '../config'
import { fetchAssetValuation, saveAssetValuation } from '../assets'

const smbcDirectSchedule = '*/5 * * * *'
const mobileSuicaSchedule = '*/5 * * * *'

export interface CronJobStatus {
  id: 'smbc-direct-session' | 'mobilesuica-session'
  label: string
  schedule: string
  running: boolean
  lastRunAt?: Date
  lastSuccessAt?: Date
  lastError?: string
}

export interface CronSystem {
  jobs(): CronJobStatus[]
  availability(profileId?: string): Record<string, CachedAvailability>
}

const assetSchedule = '* * * * *'

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Session maintenance failed'

export const createCronSystem = (db: Db, config: ServerConfig): CronSystem => {
  const status: CronJobStatus = {
    id: 'smbc-direct-session',
    label: 'SMBC Direct セッション維持',
    schedule: smbcDirectSchedule,
    running: false,
  }
  const mobileSuicaStatus: CronJobStatus = {
    id: 'mobilesuica-session',
    label: 'モバイル Suica セッション維持',
    schedule: mobileSuicaSchedule,
    running: false,
  }
  const availabilityCache = new Map<string, CachedAvailability>()
  const availabilityStatus: CronJobStatus = {
    id: 'profile-availability' as CronJobStatus['id'],
    label: 'プロフィール利用可否確認',
    schedule: '*/10 * * * *',
    running: false,
  }
  const runAvailability = async () => {
    if (availabilityStatus.running) return
    availabilityStatus.running = true
    availabilityStatus.lastRunAt = new Date()
    try {
      for (const profile of await listProfiles(db)) {
        availabilityCache.set(profile.id, {
          result: await checkProfileAvailability(db, config, profile),
          checkedAt: new Date(),
        })
      }
      availabilityStatus.lastSuccessAt = new Date()
    } catch (cause) {
      availabilityStatus.lastError = errorMessage(cause)
      console.error('Profile availability cron failed:', cause)
    } finally {
      availabilityStatus.running = false
    }
  }
  Bun.cron('*/10 * * * *', runAvailability)
  void runAvailability()

  const assetStatus: CronJobStatus = {
    id: 'asset-valuations' as CronJobStatus['id'],
    label: '総資産価値の更新',
    schedule: assetSchedule,
    running: false,
  }
  const lastAssetRuns = new Map<string, number>()
  const runAssets = async () => {
    if (assetStatus.running) return
    assetStatus.running = true
    assetStatus.lastRunAt = new Date()
    assetStatus.lastError = undefined
    const errors: string[] = []
    try {
      for (const profile of await listProfiles(db)) {
        const intervalMs = profile.provider === 'sbisec' ? 5 * 60_000 : 60 * 60_000
        const previous = lastAssetRuns.get(profile.id) ?? 0
        if (Date.now() - previous < intervalMs) continue
        lastAssetRuns.set(profile.id, Date.now())
        try {
          const valuation = await fetchAssetValuation(db, config, profile)
          await saveAssetValuation(db, profile, valuation)
        } catch (cause) {
          errors.push(`${profile.label}: ${errorMessage(cause)}`)
          console.error(`Asset valuation update failed for ${profile.id}:`, cause)
        }
      }
      if (errors.length) throw new Error(errors.join('; '))
      assetStatus.lastSuccessAt = new Date()
    } catch (cause) {
      assetStatus.lastError = errorMessage(cause)
    } finally {
      assetStatus.running = false
    }
  }
  Bun.cron(assetSchedule, runAssets)
  void runAssets()

  Bun.cron(smbcDirectSchedule, async () => {
    if (status.running) return
    status.running = true
    status.lastRunAt = new Date()
    status.lastError = undefined
    try {
      const profiles = await db
        .select()
        .from(accountProfiles)
        .where(eq(accountProfiles.provider, 'smbc-direct'))
      for (const profile of profiles) {
        const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
        if (!secret.session) continue
        const session = secret.session as SmbcDirectSession
        const smbcProfile = await importSmbcDirectSession(session)
        await continueSmbcDirectSession({ profile: smbcProfile })
        await saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportSmbcDirectSession(smbcProfile),
        } satisfies StoredSmbcDirectSecret)
        await db
          .update(accountProfiles)
          .set({ updatedAt: new Date() })
          .where(eq(accountProfiles.id, profile.id))
      }
      status.lastSuccessAt = new Date()
    } catch (cause) {
      status.lastError = errorMessage(cause)
      console.error('SMBC Direct session cron failed:', cause)
    } finally {
      status.running = false
    }
  })

  Bun.cron(mobileSuicaSchedule, async () => {
    if (mobileSuicaStatus.running) return
    mobileSuicaStatus.running = true
    mobileSuicaStatus.lastRunAt = new Date()
    mobileSuicaStatus.lastError = undefined
    try {
      const profiles = await db
        .select()
        .from(accountProfiles)
        .where(eq(accountProfiles.provider, 'mobilesuica'))
      for (const profile of profiles) {
        const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
        if (!secret.session) continue
        const mobileSuicaProfile = await importMobileSuicaSession(secret.session)
        await createMobileSuicaProvider(mobileSuicaProfile).invoke('transactions.list', {})
        await saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportMobileSuicaSession(mobileSuicaProfile),
        } satisfies StoredMobileSuicaSecret)
        await db
          .update(accountProfiles)
          .set({ updatedAt: new Date() })
          .where(eq(accountProfiles.id, profile.id))
      }
      mobileSuicaStatus.lastSuccessAt = new Date()
    } catch (cause) {
      mobileSuicaStatus.lastError = errorMessage(cause)
      console.error('Mobile Suica session cron failed:', cause)
    } finally {
      mobileSuicaStatus.running = false
    }
  })

  return {
    jobs: () => [
      { ...status },
      { ...mobileSuicaStatus },
      { ...availabilityStatus },
      { ...assetStatus },
    ],
    availability: (profileId) =>
      Object.fromEntries([...availabilityCache].filter(([id]) => !profileId || id === profileId)),
  }
}
