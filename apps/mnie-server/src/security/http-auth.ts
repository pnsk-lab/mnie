import { eq } from 'drizzle-orm'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { sessions } from '../db/schema'
import { verifyApiKey } from './api-keys'
import type { AuthContext } from '../context'

const readCookie = (header: string | null, name: string) => {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

const readQueryApiKey = (request: Request) => {
  const key = new URL(request.url).searchParams.get('key')?.trim()
  return key || undefined
}

const apiKeyAuth = async (db: Db, token: string) => {
  const apiKey = await verifyApiKey(db, token)
  return apiKey
    ? ({
        type: 'apiKey',
        authenticated: true,
        apiKeyId: apiKey.id,
        scopes: apiKey.scopes?.length ? apiKey.scopes : ['read', 'write', 'trade', 'mcp'],
      } satisfies AuthContext)
    : ({ type: 'none', authenticated: false } satisfies AuthContext)
}

export const authenticateRequest = async (db: Db, config: ServerConfig, request: Request) => {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    return apiKeyAuth(db, authorization.slice('Bearer '.length))
  }

  const queryApiKey = readQueryApiKey(request)
  if (queryApiKey) {
    return apiKeyAuth(db, queryApiKey)
  }

  const sessionId = readCookie(request.headers.get('cookie'), config.sessionCookieName)
  if (!sessionId) return { type: 'none', authenticated: false } satisfies AuthContext
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session || session.expiresAt <= new Date()) {
    return { type: 'none', authenticated: false } satisfies AuthContext
  }
  return { type: 'session', authenticated: true, sessionId } satisfies AuthContext
}
