import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { fetchAssetValuation, saveAssetValuation } from '../assets'
import { checkProfileAvailability, listProfiles, type CachedAvailability } from '../availability'
import type { ProviderRegistry } from '../providers/registry'
import { runQueuedReconciliation } from '../reconciliation'

export interface CronJobStatus {
  id: string
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
  setAvailability(profileId: string, value: CachedAvailability): void
  close(): Promise<void>
}

const errorMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : String(cause || 'Provider background operation failed')

const runExclusive = async (status: CronJobStatus, operation: () => Promise<void>) => {
  if (status.running) return
  status.running = true
  status.lastRunAt = new Date()
  status.lastError = undefined
  try {
    await operation()
    status.lastSuccessAt = new Date()
  } catch (cause) {
    status.lastError = errorMessage(cause)
    console.error(`${status.label} failed:`, cause)
  } finally {
    status.running = false
  }
}

export const createCronSystem = (
  db: Db,
  _config: ServerConfig,
  providers: ProviderRegistry,
  options: { start?: boolean } = {},
): CronSystem => {
  const availabilityCache = new Map<string, CachedAvailability>()
  const availabilityStatus: CronJobStatus = {
    id: 'profile-availability',
    label: 'プロフィール利用可否確認',
    schedule: '*/10 * * * *',
    running: false,
  }
  const sessionStatus: CronJobStatus = {
    id: 'provider-sessions',
    label: 'プロバイダーセッション維持',
    schedule: '*/5 * * * *',
    running: false,
  }
  const assetStatus: CronJobStatus = {
    id: 'asset-valuations',
    label: '総資産価値の更新',
    schedule: '* * * * *',
    running: false,
  }
  const reconciliationStatus: CronJobStatus = {
    id: 'reconciliation',
    label: '取引照合',
    schedule: '* * * * *',
    running: false,
  }
  const lastSessionRuns = new Map<string, number>()
  const lastAssetRuns = new Map<string, number>()
  const activeRuns = new Set<Promise<void>>()
  let closed = false

  const refreshAvailability = async () => {
    for (const profile of await listProfiles(providers)) {
      const availability = await checkProfileAvailability(providers, profile)
      availabilityCache.set(profile.id, {
        result: availability.connection,
        operations: availability.operations,
        checkedAt: new Date(availability.checkedAt),
      })
    }
  }

  const maintainSessions = async () => {
    const errors: string[] = []
    for (const profile of await listProfiles(providers)) {
      const interval = providers.sessionRefreshIntervalMs(profile)
      if (!interval) continue
      const previous = lastSessionRuns.get(profile.id) ?? 0
      if (Date.now() - previous < interval) continue
      lastSessionRuns.set(profile.id, Date.now())
      try {
        const availability = await providers.availability(profile)
        availabilityCache.set(profile.id, {
          result: availability.connection,
          operations: availability.operations,
          checkedAt: new Date(availability.checkedAt),
        })
        if (!availability.connection.ok) {
          errors.push(`${profile.label}: ${errorMessage(availability.connection.message)}`)
        }
      } catch (cause) {
        errors.push(`${profile.label}: ${errorMessage(cause)}`)
      }
    }
    if (errors.length) throw new Error(errors.join('; '))
  }

  const updateAssets = async () => {
    const errors: string[] = []
    for (const profile of await listProfiles(providers)) {
      const availability = availabilityCache.get(profile.id)
      if (!availability?.result.ok) continue
      const interval = providers.assetRefreshIntervalMs(profile)
      const previous = lastAssetRuns.get(profile.id) ?? 0
      if (Date.now() - previous < interval) continue
      lastAssetRuns.set(profile.id, Date.now())
      try {
        const valuation = await fetchAssetValuation(providers, profile)
        await saveAssetValuation(db, profile, valuation)
      } catch (cause) {
        errors.push(`${profile.label}: ${errorMessage(cause)}`)
      }
    }
    if (errors.length) throw new Error(errors.join('; '))
  }

  const reconcile = async () => {
    while ((await runQueuedReconciliation(db)) !== null) {
      // Drain queued ranges before the next cron interval.
    }
  }

  const run = (status: CronJobStatus, operation: () => Promise<void>) => {
    if (closed) return
    const active = runExclusive(status, operation)
    activeRuns.add(active)
    void active.finally(() => activeRuns.delete(active))
  }
  const tasks =
    options.start === false
      ? []
      : [
          Bun.cron(availabilityStatus.schedule, () => run(availabilityStatus, refreshAvailability)),
          Bun.cron(sessionStatus.schedule, () => run(sessionStatus, maintainSessions)),
          Bun.cron(assetStatus.schedule, () => run(assetStatus, updateAssets)),
          Bun.cron(reconciliationStatus.schedule, () => run(reconciliationStatus, reconcile)),
        ]
  if (options.start !== false) {
    run(availabilityStatus, refreshAvailability)
    run(sessionStatus, maintainSessions)
    run(assetStatus, updateAssets)
    run(reconciliationStatus, reconcile)
  }

  return {
    jobs: () => [
      { ...sessionStatus },
      { ...availabilityStatus },
      { ...assetStatus },
      { ...reconciliationStatus },
    ],
    availability: (profileId) =>
      Object.fromEntries([...availabilityCache].filter(([id]) => !profileId || id === profileId)),
    setAvailability: (profileId, value) => availabilityCache.set(profileId, value),
    close: async () => {
      closed = true
      for (const task of tasks) task.stop()
      await Promise.allSettled(activeRuns)
    },
  }
}
