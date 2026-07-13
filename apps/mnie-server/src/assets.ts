import { desc, eq } from 'drizzle-orm'
import type { AssetValuation } from '@mnie/types'
import type { Db } from './db'
import { accountProfiles, assetValuations } from './db/schema'
import type { ProviderRegistry } from './providers/registry'

type Profile = typeof accountProfiles.$inferSelect
type Money = { kind?: string; money?: { currency?: string; value?: string } }
interface AssetValuationResult {
  value: number
  currency: string
  holdingsValue?: number
  cashValue?: number
}

const readMoney = (amount: unknown) => {
  const money = (amount as Money | undefined)?.money
  const value = Number(money?.value)
  if (!money?.currency || !Number.isFinite(value))
    throw new Error('Provider returned invalid money')
  return { value, currency: money.currency }
}

export const fetchAssetValuation = async (
  providers: ProviderRegistry,
  profile: Profile,
): Promise<AssetValuationResult> => {
  return providers.use(profile, async ({ provider }) => {
    if (provider.operations().includes('assets.valuation.get')) {
      const result = (await provider.invoke('assets.valuation.get', {})) as AssetValuation
      const value = Number(result.amount.value)
      const holdingsValue = Number(result.holdingsAmount?.value)
      const cashValue = Number(result.cashAmount?.value)
      if (!Number.isFinite(value)) throw new Error('Provider returned an invalid asset valuation')
      return {
        value,
        currency: result.amount.currency,
        ...(Number.isFinite(holdingsValue) ? { holdingsValue } : {}),
        ...(Number.isFinite(cashValue) ? { cashValue } : {}),
      }
    }

    if (provider.operations().includes('balances.list')) {
      const balances = (await provider.invoke('balances.list', {})) as Array<{ amount: unknown }>
      if (!balances.length) throw new Error('Provider did not return a balance')
      return readMoney(balances[0]?.amount)
    }

    if (!provider.operations().includes('transactions.list')) {
      throw new Error('Provider does not expose an asset valuation operation')
    }
    const transactions = (await provider.invoke('transactions.list', {})) as {
      items?: Array<{ occurredAt?: string; balanceAfter?: unknown }>
    }
    const latest = [...(transactions.items ?? [])]
      .filter((item) => item.balanceAfter)
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0]
    if (!latest) throw new Error('Provider did not return a balance')
    return readMoney(latest.balanceAfter)
  })
}

export const saveAssetValuation = async (
  db: Db,
  profile: Profile,
  result: Awaited<ReturnType<typeof fetchAssetValuation>>,
) => {
  const capturedAt = new Date()
  await db.insert(assetValuations).values({
    profileId: profile.id,
    provider: profile.provider,
    value: result.value,
    holdingsValue: result.holdingsValue,
    cashValue: result.cashValue,
    currency: result.currency,
    capturedAt,
  })
  return { profileId: profile.id, provider: profile.provider, ...result, capturedAt }
}

export const latestAssetValuations = async (db: Db) => {
  const profiles = await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  return Promise.all(
    profiles.map(async (profile) => {
      const [latest] = await db
        .select()
        .from(assetValuations)
        .where(eq(assetValuations.profileId, profile.id))
        .orderBy(desc(assetValuations.capturedAt))
        .limit(1)
      return latest
    }),
  ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => Boolean(row)))
}

export const ensureInitialAssetValuations = async (db: Db, providers: ProviderRegistry) => {
  const profiles = await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  const existing = await latestAssetValuations(db)
  const existingProfileIds = new Set(existing.map((row) => row.profileId))

  const results = await Promise.allSettled(
    profiles
      .filter((profile) => !existingProfileIds.has(profile.id))
      .map(async (profile) => {
        try {
          const valuation = await fetchAssetValuation(providers, profile)
          await saveAssetValuation(db, profile, valuation)
        } catch (cause) {
          throw new Error(`Initial asset valuation failed for ${profile.label}`, { cause })
        }
      }),
  )

  for (const result of results) {
    if (result.status === 'rejected') console.error(result.reason)
  }
}
