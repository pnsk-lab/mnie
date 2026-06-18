import { eq, lt } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { sessions } from '../db/schema'
import { randomId } from './crypto'

const SESSION_DAYS = 30

export const createSession = async (db: Db) => {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const id = randomId('ses')
  await db.insert(sessions).values({ id, createdAt: now, expiresAt })
  return { id, expiresAt }
}

export const setSessionCookie = (c: Context, config: ServerConfig, id: string, expires: Date) => {
  setCookie(c, config.sessionCookieName, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.origin.startsWith('https://'),
    path: '/',
    expires,
  })
}

export const clearSessionCookie = async (c: Context, db: Db, config: ServerConfig) => {
  const id = getCookie(c, config.sessionCookieName)
  if (id) await db.delete(sessions).where(eq(sessions.id, id))
  deleteCookie(c, config.sessionCookieName, { path: '/' })
}

export const verifySessionCookie = async (c: Context, db: Db, config: ServerConfig) => {
  const id = getCookie(c, config.sessionCookieName)
  if (!id) return false
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
  return Boolean(session && session.expiresAt > new Date())
}

export const pruneSessions = async (db: Db) => {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
}
