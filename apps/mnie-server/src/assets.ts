import { desc, eq } from 'drizzle-orm'
import {
  createProvider as createSmbcProvider,
  exportSession as exportSmbcSession,
  importSession as importSmbcSession,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import {
  createProvider as createPayPayBankProvider,
  exportSession as exportPayPayBankSession,
  importSession as importPayPayBankSession,
  login as loginPayPayBank,
  type PayPayBankSession,
} from '@mnie/provider-paypay-bank'
import {
  createProvider as createMobileSuicaProvider,
  exportSession as exportMobileSuicaSession,
  importSession as importMobileSuicaSession,
} from '@mnie/provider-mobile-suica'
import type { ServerConfig } from './config'
import type { AssetValuation } from '@mnie/types'
import type { Db } from './db'
import { accountProfiles, assetValuations } from './db/schema'
import type {
  StoredMobileSuicaSecret,
  StoredPayPayBankSecret,
  StoredSmbcDirectSecret,
} from './routes/admin'
import { connectSbi } from './rpc/sbi-session'
import { readSecret, saveSecret } from './security/keyring'

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
  db: Db,
  config: ServerConfig,
  profile: Profile,
): Promise<AssetValuationResult> => {
  if (profile.provider === 'sbisec') {
    const result = (await (
      await connectSbi(db, config, profile.id)
    ).invoke('assets.valuation.get', {})) as AssetValuation
    const value = Number(result.amount.value)
    const holdingsValue = Number(result.holdingsAmount?.value)
    if (!Number.isFinite(value)) throw new Error('SBI provider returned an invalid asset valuation')
    return {
      value,
      currency: result.amount.currency,
      ...(Number.isFinite(holdingsValue)
        ? { holdingsValue, cashValue: Math.max(value - holdingsValue, 0) }
        : {}),
    }
  }

  if (profile.provider === 'smbc-direct') {
    const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
    if (!secret.session) throw new Error('SMBC Direct session is not available')
    const imported = await importSmbcSession(secret.session as SmbcDirectSession)
    const balances = (await createSmbcProvider(imported).invoke('balances.list', {})) as Array<{
      amount: unknown
    }>
    await saveSecret(profile.keyringAccount, {
      ...secret,
      session: exportSmbcSession(imported),
    } satisfies StoredSmbcDirectSecret)
    return readMoney(balances[0]?.amount)
  }

  if (profile.provider === 'paypay-bank') {
    const secret = await readSecret<StoredPayPayBankSecret>(profile.keyringAccount)
    const imported = secret.session
      ? await importPayPayBankSession(secret.session as PayPayBankSession)
      : await loginPayPayBank({
          branchNo: secret.branchNo,
          accountNo: secret.accountNo,
          password: secret.password,
        })
    const balances = (await createPayPayBankProvider(imported).invoke(
      'balances.list',
      {},
    )) as Array<{
      amount: unknown
    }>
    await saveSecret(profile.keyringAccount, {
      ...secret,
      session: exportPayPayBankSession(imported),
    } satisfies StoredPayPayBankSecret)
    return readMoney(balances[0]?.amount)
  }

  const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
  if (!secret.session) throw new Error('Mobile Suica session is not available')
  const imported = await importMobileSuicaSession(secret.session)
  const transactions = (await createMobileSuicaProvider(imported).invoke(
    'transactions.list',
    {},
  )) as { items?: Array<{ occurredAt?: string; balanceAfter?: unknown }> }
  await saveSecret(profile.keyringAccount, {
    ...secret,
    session: exportMobileSuicaSession(imported),
  } satisfies StoredMobileSuicaSecret)
  const latest = [...(transactions.items ?? [])]
    .filter((item) => item.balanceAfter)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0]
  if (!latest) throw new Error('Mobile Suica did not return a balance')
  return readMoney(latest.balanceAfter)
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

export const ensureInitialAssetValuations = async (db: Db, config: ServerConfig) => {
  const profiles = await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  const existing = await latestAssetValuations(db)
  const existingProfileIds = new Set(existing.map((row) => row.profileId))

  const results = await Promise.allSettled(
    profiles
      .filter((profile) => !existingProfileIds.has(profile.id))
      .map(async (profile) => {
        try {
          const valuation = await fetchAssetValuation(db, config, profile)
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
