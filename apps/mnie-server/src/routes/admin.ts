import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import {
  login as loginMobileSuica,
  exportSession as exportMobileSuicaSession,
  type MobileSuicaProfile,
} from '../../../../packages/provider-mobile-suica/src'
import type { PlaintextStoredWebAuthnCredential } from '@mnie/provider-sbi-sec'
import type { AppBindings } from '../context'
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

interface PendingMobileSuicaLogin {
  answer: (value: string) => void
  login: Promise<MobileSuicaProfile>
  id: string
  keyringAccount: string
}

const requireOwnerSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('auth').type !== 'session') return c.json({ error: 'unauthorized' }, 401)
  await next()
}

export const createAdminRoutes = () => {
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

  app.post('/mobilesuica/captcha', async (c) => {
    const body = await c.req.json<{ baseURL?: string; user?: string; password?: string }>()
    if (!body.baseURL || !body.user?.trim() || !body.password) {
      return c.json({ error: 'baseURL, user, and password are required' }, 400)
    }

    let publishCaptcha: ((value: { id: string; imageDataUrl: string }) => void) | undefined
    let rejectCaptcha: ((reason?: unknown) => void) | undefined
    const captcha = new Promise<{ id: string; imageDataUrl: string }>((resolve, reject) => {
      publishCaptcha = resolve
      rejectCaptcha = reject
    })
    let loginPromise: PendingMobileSuicaLogin['login'] | undefined
    loginPromise = loginMobileSuica({
      baseURL: body.baseURL,
      user: body.user.trim(),
      password: body.password,
      onCaptcha: async ({ image, contentType }) => {
        const id = randomId('mobilesuica')
        const answer = new Promise<string>((resolve) => {
          if (!loginPromise) throw new Error('Mobile Suica login was not initialized')
          mobileSuicaLogins.set(id, {
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
    try {
      const now = new Date()
      await saveSecret(pending.keyringAccount, { session: exportMobileSuicaSession(profile) })
      await c.get('db').insert(accountProfiles).values({
        id: pending.id,
        provider: 'mobilesuica',
        label: 'Mobile Suica',
        keyringAccount: pending.keyringAccount,
        createdAt: now,
        updatedAt: now,
      })
      return c.json({ usageHistory: await profile.getUsageHistory(), profile: { id: pending.id } })
    } finally {
      await profile.logout()
    }
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
