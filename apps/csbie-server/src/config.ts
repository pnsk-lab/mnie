import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type ServerConfig = {
  port: number
  databasePath: string
  corsOrigin: string
  sessionCookieName: string
  rpName: string
  rpId: string
  origin: string
  authBaseUrl?: string
  mtsBaseUrl?: string
  izanagiBaseUrl?: string
}

const optionalUrl = (value: string | undefined) => {
  if (!value) return undefined
  return new URL(value).toString()
}

export const loadConfig = (): ServerConfig => {
  const port = Number(process.env.PORT ?? process.env.CSBIE_SERVER_PORT ?? 8787)
  const databasePath = resolve(process.env.CSBIE_DATABASE_PATH ?? './data/csbie.sqlite')
  mkdirSync(dirname(databasePath), { recursive: true })

  const origin = process.env.CSBIE_ORIGIN ?? `http://localhost:${port}`
  const rpId = process.env.CSBIE_RP_ID ?? new URL(origin).hostname

  return {
    port,
    databasePath,
    corsOrigin: process.env.CSBIE_CORS_ORIGIN ?? origin,
    sessionCookieName: process.env.CSBIE_SESSION_COOKIE ?? 'csbie_session',
    rpName: process.env.CSBIE_RP_NAME ?? 'CSBIE',
    rpId,
    origin,
    authBaseUrl: optionalUrl(process.env.SBI_AUTH_BASE_URL),
    mtsBaseUrl: optionalUrl(process.env.SBI_MTS_BASE_URL),
    izanagiBaseUrl: optionalUrl(process.env.SBI_IZANAGI_BASE_URL),
  }
}
