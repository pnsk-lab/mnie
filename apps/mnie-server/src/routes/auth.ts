import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppBindings } from '../context'
import { appState, passkeyChallenges, userPasskeys } from '../db/schema'
import { randomId } from '../security/crypto'
import {
  clearSessionCookie,
  createSession,
  setSessionCookie,
  verifySessionCookie,
} from '../security/sessions'
import { verifySetupPassword } from '../security/setup'

type PasskeyRow = typeof userPasskeys.$inferSelect

const getConfigured = async (db: AppBindings['Variables']['db']) => {
  const [row] = await db.select().from(appState).where(eq(appState.key, 'configured')).limit(1)
  return row?.value === 'true'
}

const saveChallenge = async (
  db: AppBindings['Variables']['db'],
  kind: 'registration' | 'authentication',
  challenge: string,
) => {
  const now = new Date()
  const id = randomId('chal')
  await db.insert(passkeyChallenges).values({
    id,
    kind,
    challenge,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
  })
  return id
}

const consumeChallenge = async (
  db: AppBindings['Variables']['db'],
  id: string,
  kind: 'registration' | 'authentication',
) => {
  const [row] = await db
    .select()
    .from(passkeyChallenges)
    .where(eq(passkeyChallenges.id, id))
    .limit(1)
  if (!row || row.kind !== kind || row.expiresAt < new Date()) throw new Error('challenge expired')
  await db.delete(passkeyChallenges).where(eq(passkeyChallenges.id, id))
  return row.challenge
}

const toCredentialDescriptor = (row: PasskeyRow) => ({
  id: row.credentialId,
  transports: row.transports?.filter(isAuthenticatorTransport),
})

const isAuthenticatorTransport = (value: string): value is AuthenticatorTransportFuture =>
  ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(value)

const passkeyForCredential = async (db: AppBindings['Variables']['db'], credentialId: string) => {
  const [row] = await db
    .select()
    .from(userPasskeys)
    .where(eq(userPasskeys.credentialId, credentialId))
    .limit(1)
  return row
}

const loopbackHosts = new Set(['localhost', '127.0.0.1'])

const expectedWebAuthnOrigins = (origin: string) => {
  const url = new URL(origin)
  if (!loopbackHosts.has(url.hostname)) return origin
  return [...loopbackHosts].map((hostname) => {
    const candidate = new URL(origin)
    candidate.hostname = hostname
    return candidate.origin
  })
}

const expectedWebAuthnRpIds = (rpId: string) =>
  loopbackHosts.has(rpId) ? [...loopbackHosts] : rpId

export const createAuthRoutes = () => {
  const app = new Hono<AppBindings>()

  app.get('/status', async (c) => {
    const db = c.get('db')
    return c.json({
      configured: await getConfigured(db),
      authenticated: await verifySessionCookie(c, db, c.get('config')),
    })
  })

  app.post('/setup/options', async (c) => {
    const db = c.get('db')
    if (await getConfigured(db)) return c.json({ error: 'already configured' }, 409)

    const { password } = await c.req.json<{ password?: string }>()
    if (!password || !verifySetupPassword(password)) {
      return c.json({ error: 'invalid setup password' }, 401)
    }

    const config = c.get('config')
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: 'owner',
      userDisplayName: 'Owner',
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    })
    const challengeId = await saveChallenge(db, 'registration', options.challenge)
    return c.json({ options, challengeId })
  })

  app.post('/setup/verify', async (c) => {
    const db = c.get('db')
    if (await getConfigured(db)) return c.json({ error: 'already configured' }, 409)

    const { challengeId, response } = await c.req.json<{
      challengeId?: string
      response?: unknown
    }>()
    if (!challengeId || !response) return c.json({ error: 'missing registration response' }, 400)

    const expectedChallenge = await consumeChallenge(db, challengeId, 'registration')
    const config = c.get('config')
    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: expectedWebAuthnOrigins(config.origin),
      expectedRPID: expectedWebAuthnRpIds(config.rpId),
      requireUserVerification: true,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'registration failed' }, 400)
    }

    const now = new Date()
    const credential = verification.registrationInfo.credential
    await db.insert(userPasskeys).values({
      id: randomId('upk'),
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: (response as { response?: { transports?: string[] } }).response?.transports,
      createdAt: now,
      updatedAt: now,
    })
    await db
      .insert(appState)
      .values({ key: 'configured', value: 'true', updatedAt: now })
      .onConflictDoUpdate({ target: appState.key, set: { value: 'true', updatedAt: now } })

    const session = await createSession(db)
    setSessionCookie(c, config, session.id, session.expiresAt)
    return c.json({ ok: true })
  })

  app.post('/login/options', async (c) => {
    const db = c.get('db')
    const rows = await db.select().from(userPasskeys)
    if (rows.length === 0) return c.json({ error: 'not configured' }, 409)

    const options = await generateAuthenticationOptions({
      rpID: c.get('config').rpId,
      allowCredentials: rows.map(toCredentialDescriptor),
      userVerification: 'required',
    })
    const challengeId = await saveChallenge(db, 'authentication', options.challenge)
    return c.json({ options, challengeId })
  })

  app.post('/login/verify', async (c) => {
    const db = c.get('db')
    const { challengeId, response } = await c.req.json<{
      challengeId?: string
      response?: { id?: string }
    }>()
    if (!challengeId || !response?.id)
      return c.json({ error: 'missing authentication response' }, 400)

    const passkey = await passkeyForCredential(db, response.id)
    if (!passkey) return c.json({ error: 'unknown passkey' }, 401)

    const expectedChallenge = await consumeChallenge(db, challengeId, 'authentication')
    const config = c.get('config')
    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: expectedWebAuthnOrigins(config.origin),
      expectedRPID: expectedWebAuthnRpIds(config.rpId),
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports?.filter(isAuthenticatorTransport),
      },
      requireUserVerification: true,
    })

    if (!verification.verified) return c.json({ error: 'authentication failed' }, 401)

    await db
      .update(userPasskeys)
      .set({ counter: verification.authenticationInfo.newCounter, updatedAt: new Date() })
      .where(eq(userPasskeys.id, passkey.id))

    const session = await createSession(db)
    setSessionCookie(c, config, session.id, session.expiresAt)
    return c.json({ ok: true })
  })

  app.post('/logout', async (c) => {
    await clearSessionCookie(c, c.get('db'), c.get('config'))
    return c.json({ ok: true })
  })

  return app
}
