import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import {
  createProvider as createMobileSuicaProvider,
  importSession as importMobileSuicaSession,
  login as loginMobileSuica,
  exportSession as exportMobileSuicaSession,
  type MobileSuicaSession,
  type MobileSuicaProfile,
} from '../../../../packages/provider-mobile-suica/src'
import {
  createProvider as createSmbcDirectProvider,
  exportSession as exportSmbcDirectSession,
  importSession as importSmbcDirectSession,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import type { PlaintextStoredWebAuthnCredential } from '@mnie/provider-sbi-sec'
import type { AvailabilityCheckResult } from '@mnie/types'
import type { AppBindings } from '../context'
import type { CronSystem } from '../cron'
import { accountProfiles, sbiPasskeys } from '../db/schema'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKeySettings,
  type ApiKeySettings,
} from '../security/api-keys'
import { randomId } from '../security/crypto'
import { deleteSecret, saveSecret } from '../security/keyring'
import { readSecret } from '../security/keyring'
import { connectSbi } from '../rpc/sbi-session'
import { ensureInitialAssetValuations, latestAssetValuations } from '../assets'

export interface StoredSbiPasskeySecret {
  credential: PlaintextStoredWebAuthnCredential
  tradePassword?: string
  deviceId?: string
  session?: unknown
}

export interface StoredSmbcDirectSecret {
  user: string
  password: string
  accountItemCode?: string
  session?: unknown
}

export interface StoredPayPayBankSecret {
  branchNo: string
  accountNo: string
  password: string
  session?: unknown
}

export interface StoredMobileSuicaSecret {
  session?: MobileSuicaSession
  user?: string
  password?: string
}

interface PendingMobileSuicaLogin {
  label: string
  user: string
  password: string
  createProfile: boolean
  answer: (value: string) => void
  login: Promise<MobileSuicaProfile>
  id: string
  keyringAccount: string
}

const availabilityFailure = (message: unknown): AvailabilityCheckResult => ({ ok: false, message })

const availabilityMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause)

const serializableAvailability = async (availability: Promise<AvailabilityCheckResult>) => {
  const result = await availability
  return result.ok ? result : availabilityFailure(availabilityMessage(result.message))
}

const availabilityTimeoutMs = 20_000

const withAvailabilityTimeout = async <T>(operation: Promise<T>, label: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(`${label} availability check timed out after ${availabilityTimeoutMs}ms`),
            ),
          availabilityTimeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const requireOwnerSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('auth').type !== 'session') return c.json({ error: 'unauthorized' }, 401)
  await next()
}

export const createAdminRoutes = (cronSystem: CronSystem) => {
  const app = new Hono<AppBindings>()
  const mobileSuicaLogins = new Map<string, PendingMobileSuicaLogin>()
  app.use('*', requireOwnerSession)

  app.get('/api-keys', async (c) => c.json({ apiKeys: await listApiKeys(c.get('db')) }))

  app.post('/api-keys', async (c) => {
    const { label, settings } = await c.req.json<{ label?: string; settings?: ApiKeySettings }>()
    if (!label?.trim()) return c.json({ error: 'label is required' }, 400)
    const key = await createApiKey(c.get('db'), label.trim(), settings)
    return c.json({ apiKey: key }, 201)
  })

  app.patch('/api-keys/:id/settings', async (c) => {
    const body = await c.req.json<ApiKeySettings>()
    await updateApiKeySettings(c.get('db'), c.req.param('id'), body)
    return c.json({ ok: true })
  })

  app.delete('/api-keys/:id', async (c) => {
    await revokeApiKey(c.get('db'), c.req.param('id'))
    return c.json({ ok: true })
  })

  app.get('/sbi-passkeys', async (c) => {
    const rows = await c.get('db').select().from(sbiPasskeys).orderBy(sbiPasskeys.createdAt)
    return c.json({
      passkeys: rows.map(({ keyringAccount: _keyringAccount, ...row }) => ({
        ...row,
        keyringAccount: undefined,
      })),
    })
  })

  app.get('/profiles', async (c) => {
    const rows = await c.get('db').select().from(accountProfiles).orderBy(accountProfiles.createdAt)
    return c.json({
      profiles: rows.map(({ keyringAccount: _keyringAccount, ...profile }) => profile),
    })
  })

  app.get('/asset-valuations/latest', async (c) => {
    await ensureInitialAssetValuations(c.get('db'), c.get('config'))
    return c.json({ valuations: await latestAssetValuations(c.get('db')) })
  })

  let availabilityRequest:
    | Promise<{ availability: Record<string, AvailabilityCheckResult> }>
    | undefined
  app.post('/profiles/availability', async (c) => {
    const body = await c.req.json<{ profileId?: string }>().catch(() => ({ profileId: undefined }))
    const cached = cronSystem.availability(body.profileId)
    return c.json({
      availability: Object.fromEntries(
        Object.entries(cached).map(([id, value]) => [
          id,
          { ...value.result, checkedAt: value.checkedAt.toISOString() },
        ]),
      ),
    })
  })

  app.post('/profiles/availability/live', async (c) => {
    if (availabilityRequest) return c.json(await availabilityRequest)

    availabilityRequest = (async () => {
      const db = c.get('db')
      const body = await c.req
        .json<{ profileId?: string }>()
        .catch(() => ({ profileId: undefined }))
      const profiles = (
        await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
      ).filter((profile) => !body.profileId || profile.id === body.profileId)
      const availability = await Promise.all(
        profiles.map(async (profile) => {
          try {
            if (profile.provider === 'sbisec') {
              return [
                profile.id,
                await withAvailabilityTimeout(
                  serializableAvailability(
                    (await connectSbi(db, c.get('config'), profile.id)).checkAvailability(),
                  ),
                  `SBI Securities (${profile.label})`,
                ),
              ] as const
            }

            if (profile.provider === 'smbc-direct') {
              const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
              if (!secret.session) {
                return [
                  profile.id,
                  availabilityFailure(
                    'SMBC Direct session is not available; reconnect and finish two-factor authentication',
                  ),
                ] as const
              }
              const smbcProfile = await importSmbcDirectSession(secret.session as SmbcDirectSession)
              const result = await withAvailabilityTimeout(
                serializableAvailability(createSmbcDirectProvider(smbcProfile).checkAvailability()),
                `SMBC Direct (${profile.label})`,
              )
              if (result.ok) {
                await saveSecret(profile.keyringAccount, {
                  ...secret,
                  session: exportSmbcDirectSession(smbcProfile),
                } satisfies StoredSmbcDirectSecret)
              }
              return [profile.id, result] as const
            }

            const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
            if (!secret.session) {
              return [
                profile.id,
                availabilityFailure('Mobile Suica session is not available; reconnect'),
              ] as const
            }
            const mobileSuicaProfile = await importMobileSuicaSession(secret.session)
            const result = await withAvailabilityTimeout(
              serializableAvailability(
                createMobileSuicaProvider(mobileSuicaProfile).checkAvailability(),
              ),
              `Mobile Suica (${profile.label})`,
            )
            if (result.ok) {
              await saveSecret(profile.keyringAccount, {
                ...secret,
                session: exportMobileSuicaSession(mobileSuicaProfile),
              } satisfies StoredMobileSuicaSecret)
            }
            return [profile.id, result] as const
          } catch (cause) {
            return [profile.id, availabilityFailure(availabilityMessage(cause))] as const
          }
        }),
      )
      return { availability: Object.fromEntries(availability) }
    })()

    try {
      return c.json(await availabilityRequest)
    } finally {
      availabilityRequest = undefined
    }
  })

  app.get('/cron-jobs', (c) => c.json({ jobs: cronSystem.jobs() }))

  app.post('/mobilesuica/captcha', async (c) => {
    const body = await c.req.json<{ label?: string; user?: string; password?: string }>()
    const baseURL = c.get('config').mobileSuicaBaseUrl
    if (!baseURL) return c.json({ error: 'MOBILE_SUICA_BASE_URL is required' }, 500)
    if (!body.label?.trim() || !body.user?.trim() || !body.password) {
      return c.json({ error: 'label, user and password are required' }, 400)
    }
    const profileLabel = body.label.trim()
    const profileUser = body.user.trim()
    const profilePassword = body.password

    let publishCaptcha: ((value: { id: string; imageDataUrl: string }) => void) | undefined
    let rejectCaptcha: ((reason?: unknown) => void) | undefined
    const captcha = new Promise<{ id: string; imageDataUrl: string }>((resolve, reject) => {
      publishCaptcha = resolve
      rejectCaptcha = reject
    })
    let loginPromise: PendingMobileSuicaLogin['login'] | undefined
    loginPromise = loginMobileSuica({
      baseURL,
      user: body.user.trim(),
      password: body.password,
      onCaptcha: async ({ image, contentType }) => {
        const id = randomId('mobilesuica')
        const answer = new Promise<string>((resolve) => {
          if (!loginPromise) throw new Error('Mobile Suica login was not initialized')
          mobileSuicaLogins.set(id, {
            label: profileLabel,
            user: profileUser,
            password: profilePassword,
            createProfile: true,
            answer: resolve,
            login: loginPromise,
            id: randomId('mobilesuica'),
            keyringAccount: `mobilesuica:${randomId('credential')}`,
          })
        })
        publishCaptcha?.({
          id,
          imageDataUrl: `data:${contentType};base64,${Buffer.from(image).toString('base64')}`,
        })
        return answer
      },
    })
    void loginPromise.catch(rejectCaptcha)
    const result = await captcha
    return c.json(result)
  })

  app.post('/mobilesuica/captcha/:id', async (c) => {
    const pending = mobileSuicaLogins.get(c.req.param('id'))
    if (!pending) return c.json({ error: 'CAPTCHA challenge not found or expired' }, 404)
    const body = await c.req.json<{ answer?: string }>()
    if (!body.answer?.trim()) return c.json({ error: 'answer is required' }, 400)
    mobileSuicaLogins.delete(c.req.param('id'))
    pending.answer(body.answer.trim())
    const profile = await pending.login
    const now = new Date()
    await saveSecret(pending.keyringAccount, {
      session: exportMobileSuicaSession(profile),
      user: pending.user,
      password: pending.password,
    } satisfies StoredMobileSuicaSecret)
    if (pending.createProfile) {
      await c.get('db').insert(accountProfiles).values({
        id: pending.id,
        provider: 'mobilesuica',
        label: pending.label,
        keyringAccount: pending.keyringAccount,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      await c
        .get('db')
        .update(accountProfiles)
        .set({ updatedAt: now })
        .where(eq(accountProfiles.id, pending.id))
    }
    return c.json({ profile: { id: pending.id } })
  })

  app.post('/mobilesuica/reauth/:profileId/captcha', async (c) => {
    const baseURL = c.get('config').mobileSuicaBaseUrl
    if (!baseURL) return c.json({ error: 'MOBILE_SUICA_BASE_URL is required' }, 500)
    const profile = await c.get('db').query.accountProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, c.req.param('profileId')),
    })
    if (!profile || profile.provider !== 'mobilesuica')
      return c.json({ error: 'profile not found' }, 404)
    const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
    if (!secret.user || !secret.password)
      return c.json({ error: 'Mobile Suica credentials are not stored' }, 409)
    let publishCaptcha: ((value: { id: string; imageDataUrl: string }) => void) | undefined
    const captcha = new Promise<{ id: string; imageDataUrl: string }>((resolve) => {
      publishCaptcha = resolve
    })
    let loginPromise: PendingMobileSuicaLogin['login'] | undefined
    loginPromise = loginMobileSuica({
      baseURL,
      user: secret.user,
      password: secret.password,
      onCaptcha: async ({ image, contentType }) => {
        const id = randomId('mobilesuica-reauth')
        const answer = new Promise<string>((resolve) => {
          mobileSuicaLogins.set(id, {
            label: profile.label,
            user: secret.user as string,
            password: secret.password as string,
            createProfile: false,
            answer: resolve,
            login: loginPromise as Promise<MobileSuicaProfile>,
            id: profile.id,
            keyringAccount: profile.keyringAccount,
          })
        })
        publishCaptcha?.({
          id,
          imageDataUrl: `data:${contentType};base64,${Buffer.from(image).toString('base64')}`,
        })
        return answer
      },
    })
    void loginPromise.catch(() => undefined)
    return c.json(await captcha)
  })

  app.post('/profiles/smbc-direct', async (c) => {
    const body = await c.req.json<{
      label?: string
      user?: string
      password?: string
      accountItemCode?: string
    }>()
    if (!body.label?.trim() || !body.user?.trim() || !body.password) {
      return c.json({ error: 'label, user, and password are required' }, 400)
    }
    if (!/^\d+-\d+$/.test(body.user.trim()))
      return c.json({ error: 'user must be <branch>-<account>' }, 400)
    const now = new Date()
    const id = randomId('smbc')
    const keyringAccount = `smbc-direct:${id}`
    await saveSecret(keyringAccount, {
      user: body.user.trim(),
      password: body.password,
      accountItemCode: body.accountItemCode?.trim() || undefined,
    } satisfies StoredSmbcDirectSecret)
    await c.get('db').insert(accountProfiles).values({
      id,
      provider: 'smbc-direct',
      label: body.label.trim(),
      keyringAccount,
      createdAt: now,
      updatedAt: now,
    })
    return c.json(
      {
        profile: {
          id,
          provider: 'smbc-direct',
          label: body.label.trim(),
          createdAt: now,
          updatedAt: now,
        },
      },
      201,
    )
  })

  app.post('/profiles/paypay-bank', async (c) => {
    const body = await c.req.json<{
      label?: string
      branchNo?: string
      accountNo?: string
      password?: string
    }>()
    if (
      !body.label?.trim() ||
      !body.branchNo?.trim() ||
      !body.accountNo?.trim() ||
      !body.password
    ) {
      return c.json({ error: 'label, branchNo, accountNo, and password are required' }, 400)
    }
    if (!/^\d{3}$/.test(body.branchNo.trim())) {
      return c.json({ error: 'branchNo must be three digits' }, 400)
    }
    if (!/^\d{7}$/.test(body.accountNo.trim())) {
      return c.json({ error: 'accountNo must be seven digits' }, 400)
    }
    if (!/^[\x20-\x7e]{1,32}$/.test(body.password)) {
      return c.json({ error: 'password must be 1–32 ASCII characters' }, 400)
    }
    const now = new Date()
    const id = randomId('paypay-bank')
    const keyringAccount = `paypay-bank:${id}`
    await saveSecret(keyringAccount, {
      branchNo: body.branchNo.trim(),
      accountNo: body.accountNo.trim(),
      password: body.password,
    } satisfies StoredPayPayBankSecret)
    await c.get('db').insert(accountProfiles).values({
      id,
      provider: 'paypay-bank',
      label: body.label.trim(),
      keyringAccount,
      createdAt: now,
      updatedAt: now,
    })
    return c.json(
      {
        profile: {
          id,
          provider: 'paypay-bank',
          label: body.label.trim(),
          createdAt: now,
          updatedAt: now,
        },
      },
      201,
    )
  })

  app.patch('/profiles/:id', async (c) => {
    const body = await c.req.json<{ label?: string }>()
    if (!body.label?.trim()) return c.json({ error: 'label is required' }, 400)
    const profile = await c.get('db').query.accountProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, c.req.param('id')),
    })
    if (!profile) return c.json({ error: 'profile not found' }, 404)
    const now = new Date()
    await c
      .get('db')
      .update(accountProfiles)
      .set({ label: body.label.trim(), updatedAt: now })
      .where(eq(accountProfiles.id, profile.id))
    if (profile.provider === 'sbisec') {
      await c
        .get('db')
        .update(sbiPasskeys)
        .set({ label: body.label.trim(), updatedAt: now })
        .where(eq(sbiPasskeys.id, profile.id))
    }
    return c.json({ profile: { ...profile, label: body.label.trim(), updatedAt: now } })
  })

  app.post('/sbi-passkeys', async (c) => {
    const body = await c.req.json<{
      label?: string
      credential?: PlaintextStoredWebAuthnCredential
      tradePassword?: string
      deviceId?: string
    }>()
    if (!body.label?.trim() || !body.credential) {
      return c.json({ error: 'label and credential are required' }, 400)
    }

    const now = new Date()
    const id = randomId('sbi')
    const keyringAccount = `sbi-passkey:${id}`
    await saveSecret(keyringAccount, {
      credential: body.credential,
      tradePassword: body.tradePassword,
      deviceId: body.deviceId,
    } satisfies StoredSbiPasskeySecret)
    await c.get('db').insert(sbiPasskeys).values({
      id,
      label: body.label.trim(),
      keyringAccount,
      createdAt: now,
      updatedAt: now,
    })
    await c.get('db').insert(accountProfiles).values({
      id,
      provider: 'sbisec',
      label: body.label.trim(),
      keyringAccount,
      createdAt: now,
      updatedAt: now,
    })

    return c.json(
      { passkey: { id, label: body.label.trim(), createdAt: now, updatedAt: now } },
      201,
    )
  })

  app.delete('/sbi-passkeys/:id', async (c) => {
    const db = c.get('db')
    const [row] = await db
      .select()
      .from(sbiPasskeys)
      .where(eq(sbiPasskeys.id, c.req.param('id')))
    if (!row) return c.json({ error: 'not found' }, 404)
    await deleteSecret(row.keyringAccount)
    await db.delete(sbiPasskeys).where(eq(sbiPasskeys.id, row.id))
    await db.delete(accountProfiles).where(eq(accountProfiles.id, row.id))
    return c.json({ ok: true })
  })

  app.delete('/profiles/:id', async (c) => {
    const db = c.get('db')
    const [row] = await db
      .select()
      .from(accountProfiles)
      .where(eq(accountProfiles.id, c.req.param('id')))
    if (!row) return c.json({ error: 'not found' }, 404)
    await deleteSecret(row.keyringAccount)
    await db.delete(accountProfiles).where(eq(accountProfiles.id, row.id))
    if (row.provider === 'sbisec') await db.delete(sbiPasskeys).where(eq(sbiPasskeys.id, row.id))
    return c.json({ ok: true })
  })

  return app
}
