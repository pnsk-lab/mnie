import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { PlaintextStoredWebAuthnCredential } from '@repo/client-sbi'
import type { AppBindings } from '../context'
import { sbiPasskeys } from '../db/schema'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKeySettings,
  type ApiKeySettings,
} from '../security/api-keys'
import { randomId } from '../security/crypto'
import { deleteSecret, saveSecret } from '../security/keyring'

export type StoredSbiPasskeySecret = {
  credential: PlaintextStoredWebAuthnCredential
  tradePassword?: string
  deviceId?: string
}

const requireOwnerSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('auth').type !== 'session') return c.json({ error: 'unauthorized' }, 401)
  await next()
}

export const createAdminRoutes = () => {
  const app = new Hono<AppBindings>()
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
    return c.json({ ok: true })
  })

  return app
}
