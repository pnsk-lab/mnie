import {
  createProvider as createMobileSuicaProvider,
  importSession as importMobileSuicaSession,
  exportSession as exportMobileSuicaSession,
} from '@mnie/provider-mobile-suica'
import type { AvailabilityCheckResult } from '@mnie/types'
import {
  createProvider as createSmbcDirectProvider,
  exportSession as exportSmbcDirectSession,
  importSession as importSmbcDirectSession,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import {
  createProvider as createPayPayBankProvider,
  exportSession as exportPayPayBankSession,
  importSession as importPayPayBankSession,
  login as loginPayPayBank,
  type PayPayBankSession,
} from '@mnie/provider-paypay-bank'
import type { ServerConfig } from './config'
import type { Db } from './db'
import { accountProfiles } from './db/schema'
import { readSecret, saveSecret } from './security/keyring'
import { connectSbi } from './rpc/sbi-session'
import type {
  StoredMobileSuicaSecret,
  StoredPayPayBankSecret,
  StoredSmbcDirectSecret,
} from './routes/admin'

export interface CachedAvailability {
  result: AvailabilityCheckResult
  checkedAt: Date
}

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause)
const serializableAvailability = (result: AvailabilityCheckResult): AvailabilityCheckResult =>
  result.ok ? result : { ...result, message: message(result.message) }
const timeoutMs = 20_000
const timed = async <T>(operation: Promise<T>, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} availability check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const checkProfileAvailability = async (
  db: Db,
  config: ServerConfig,
  profile: typeof accountProfiles.$inferSelect,
): Promise<AvailabilityCheckResult> => {
  try {
    if (profile.provider === 'sbisec') {
      const provider = await connectSbi(db, config, profile.id)
      return serializableAvailability(
        await timed(provider.checkAvailability(), `SBI Securities (${profile.label})`),
      )
    }
    if (profile.provider === 'smbc-direct') {
      const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
      if (!secret.session)
        return {
          ok: false,
          message:
            'SMBC Direct session is not available; reconnect and finish two-factor authentication',
          reason: '2FA_REQUIRED',
        }
      const smbcProfile = await importSmbcDirectSession(secret.session as SmbcDirectSession)
      const result = serializableAvailability(
        await timed(
          createSmbcDirectProvider(smbcProfile).checkAvailability(),
          `SMBC Direct (${profile.label})`,
        ),
      )
      if (result.ok)
        await saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportSmbcDirectSession(smbcProfile),
        } satisfies StoredSmbcDirectSecret)
      return result
    }
    if (profile.provider === 'mobilesuica') {
      const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
      if (!secret.session)
        return {
          ok: false,
          message: 'Mobile Suica session is not available; reconnect',
          reason: 'UNKNOWN',
        }
      const mobileProfile = await importMobileSuicaSession(secret.session)
      const result = serializableAvailability(
        await timed(
          createMobileSuicaProvider(mobileProfile).checkAvailability(),
          `Mobile Suica (${profile.label})`,
        ),
      )
      if (result.ok)
        await saveSecret(profile.keyringAccount, {
          ...secret,
          session: exportMobileSuicaSession(mobileProfile),
        } satisfies StoredMobileSuicaSecret)
      return result
    }
    const secret = await readSecret<StoredPayPayBankSecret>(profile.keyringAccount)
    const payPayBankProfile = secret.session
      ? await importPayPayBankSession(secret.session as PayPayBankSession)
      : await loginPayPayBank({
          branchNo: secret.branchNo,
          accountNo: secret.accountNo,
          password: secret.password,
        })
    const result = serializableAvailability(
      await timed(
        createPayPayBankProvider(payPayBankProfile).checkAvailability(),
        `PayPay Bank (${profile.label})`,
      ),
    )
    if (result.ok)
      await saveSecret(profile.keyringAccount, {
        ...secret,
        session: exportPayPayBankSession(payPayBankProfile),
      } satisfies StoredPayPayBankSecret)
    return result
  } catch (cause) {
    return { ok: false, message: message(cause), reason: 'UNKNOWN' }
  }
}

export const listProfiles = (db: Db) =>
  db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
