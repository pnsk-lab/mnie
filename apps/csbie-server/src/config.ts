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
  foreignStockBaseUrl?: string
  usStockBaseUrl?: string
  foreignStockRestUrl?: string
  foreignStockGraphqlBffUrl?: string
  foreignStockGraphqlIntUrl?: string
  mainSiteBaseUrl?: string
  mainSiteEtGatePath?: string
  mainSiteAssetsValuationsPath?: string
  mainSiteExchangeOrderInputPath?: string
  mainSiteExchangeOrderPasswordPath?: string
  mainSiteExchangeOrderConfirmPath?: string
  mainSiteExchangeOrderCompletePath?: string
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
    foreignStockBaseUrl: optionalUrl(process.env.SBI_FOREIGN_STOCK_BASE_URL),
    usStockBaseUrl: optionalUrl(process.env.SBI_US_STOCK_BASE_URL),
    foreignStockRestUrl: optionalUrl(process.env.SBI_FOREIGN_STOCK_REST_URL),
    foreignStockGraphqlBffUrl: optionalUrl(process.env.SBI_FOREIGN_STOCK_GRAPHQL_BFF_URL),
    foreignStockGraphqlIntUrl: optionalUrl(process.env.SBI_FOREIGN_STOCK_GRAPHQL_INT_URL),
    mainSiteBaseUrl: optionalUrl(process.env.SBI_MAIN_SITE_BASE_URL),
    mainSiteEtGatePath: process.env.SBI_MAIN_SITE_ET_GATE_PATH,
    mainSiteAssetsValuationsPath: process.env.SBI_MAIN_SITE_ASSETS_VALUATIONS_PATH,
    mainSiteExchangeOrderInputPath: process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_INPUT_PATH,
    mainSiteExchangeOrderPasswordPath: process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_PASSWORD_PATH,
    mainSiteExchangeOrderConfirmPath: process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_CONFIRM_PATH,
    mainSiteExchangeOrderCompletePath: process.env.SBI_MAIN_SITE_EXCHANGE_ORDER_COMPLETE_PATH,
  }
}
