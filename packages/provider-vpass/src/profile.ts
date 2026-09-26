import { randomUUID } from 'node:crypto'
import { decryptPayload } from './crypto'
import { FIELD_DELIMITER, type LoginIdKind, type LoginMethod } from './auth'
import { DEFAULT_VPASS_OS_VERSION, buildVpassUserAgent } from './constants'
import { VpassAuthError, VpassClient, VpassError, type VpassClientOptions } from './client'

/**
 * Session state and the data calls built on top of it.
 *
 * Two things make a VPass session reusable across runs. The login response
 * carries a token that stands in for the password on later logins, and the same
 * response seeds the member-site cookies that statement reads need. Export both
 * and a later process can resume without touching the password again.
 */

/** Positions in the decrypted auth response, which is `|`-delimited like the request. */
const RESPONSE_FIELDS = {
  token: 0,
  globalId: 1,
  externalId: 2,
  cardCode: 3,
  deviceId: 4,
  deviceToken: 5,
  cardCompanyCode: 7,
  issuedAt: 8,
  digest: 9,
} as const

export interface VpassSession {
  apiBaseURL: string
  webBaseURL: string
  appVersion: string
  /** Android release sent to the app API. Absent only in legacy saved sessions. */
  osVersion?: string
  /** Full Android app and WebView User-Agent. Absent only in legacy saved sessions. */
  userAgent?: string
  /** Authentication endpoint used to mint and rotate this session. */
  endpoint: 'Fauth' | 'Vauth'
  /** Push-registration flag paired with the device token. */
  push: boolean
  /** Device UUID. Generated on first connect and stable thereafter. */
  deviceId: string
  /** The app's FCM registration token. Empty when running without one. */
  deviceToken: string
  cardCompanyCode: string
  idKind: LoginIdKind
  /** Stands in for the password on subsequent logins. */
  token?: string
  globalId?: string
  externalId?: string
  cardCode?: string
  cookies: Record<string, string>
}

export interface VpassCard {
  globalId: string
  cardCode: string
  cardName: string
  cardCompanyCode: string
  /** Last four digits of the funding PAN, when the member site reports them. */
  last4?: string
  memberCode?: string
}

export interface VpassStatementEntry {
  /** Usage date, ISO `YYYY-MM-DD`. */
  usedOn: string
  merchant: string
  /** Yen. Negative for refunds and reversals. */
  amount: number
  /** Billing month, ISO `YYYY-MM`. */
  billedOn?: string
  /** Cardholder, for family cards. */
  holder?: string
  installments?: string
}

export interface VpassStatement {
  /** Billing period code as the member site names it, e.g. `202608`. */
  period: string
  cardName?: string
  entries: VpassStatementEntry[]
}

export interface ConnectOptions extends VpassClientOptions {
  /** VPass ID or the unified FA ID. Required unless resuming with `token`. */
  loginId?: string
  password?: string
  /** Which ID `loginId` is. Defaults to `vpass`. */
  idKind?: LoginIdKind
  /** A token from a previous session; skips the password. */
  token?: string
  /** Reuse a device identity. Generated when absent — keep it across runs. */
  deviceId?: string
  deviceToken?: string
  cardCompanyCode?: string
  push?: boolean
  cookies?: Record<string, string>
  endpoint?: 'Fauth' | 'Vauth'
}

const parseYen = (value: unknown): number => {
  if (typeof value !== 'string' || value.trim() === '') return 0
  const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new VpassError(`unparseable amount: ${value}`)
  return parsed
}

/** `26/06/30` and `26/08` are how the member site writes dates. */
const parseDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const full = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value)
  if (full) return `20${full[1]}-${full[2]}-${full[3]}`
  const month = /^(\d{2})\/(\d{2})$/.exec(value)
  if (month) return `20${month[1]}-${month[2]}`
  return undefined
}

export class VpassProfile {
  constructor(
    readonly client: VpassClient,
    readonly session: VpassSession,
  ) {}

  /** Cards on the account, from the member site's multi-card view. */
  async cards(): Promise<VpassCard[]> {
    const content = await this.client.callMember<{
      MulticardInformationResponseServiceBean?: { cardInfo?: Record<string, string>[] }
    }>('multicard/get_multicard_data/v1', { content: { inAppFlag: '1' } })

    const cards = content.MulticardInformationResponseServiceBean?.cardInfo
    if (!Array.isArray(cards)) throw new VpassError('multicard response had no cardInfo')

    return cards.map((card) => ({
      globalId: card.globalId ?? '',
      cardCode: card.cardIdentifyKey ?? card.globalId ?? '',
      cardName: card.cardName ?? 'VPass card',
      cardCompanyCode: card.cardCompanyCode ?? this.session.cardCompanyCode,
      last4: card.fpanSuffix || undefined,
      memberCode: card.memberCode || undefined,
    }))
  }

  /**
   * Billing periods the member site will serve, newest first.
   *
   * The list comes back from any statement read, so this asks for the default
   * period and keeps only the period list.
   */
  async statementPeriods(): Promise<string[]> {
    const bean = await this.#statementBean()
    const periods = bean.seikyuYMList
    if (!Array.isArray(periods)) return bean.seikyuYM ? [bean.seikyuYM] : []
    return periods.map((entry) => entry.value).filter((value): value is string => Boolean(value))
  }

  /** One billing period's statement. Omit `period` for the current one. */
  async statement(period?: string): Promise<VpassStatement> {
    const bean = await this.#statementBean(period)
    const rows = Array.isArray(bean.meisaiList) ? bean.meisaiList : []

    const entries: VpassStatementEntry[] = []
    for (const row of rows) {
      const usedOn = parseDate(row.riyouDate)
      // Statements carry spacer and subtotal rows that have no usage date.
      // They are presentation, not transactions, so they are dropped.
      if (!usedOn) continue
      entries.push({
        usedOn,
        merchant: (row.kmName ?? '').trim(),
        amount: parseYen(row.riyouKin),
        billedOn: parseDate(row.shiharaiDate),
        holder: row.zokugara?.trim() || undefined,
        installments: row.bunkatsuYaku && row.bunkatsuYaku !== '0' ? row.bunkatsuYaku : undefined,
      })
    }

    return { period: bean.seikyuYM ?? period ?? '', cardName: bean.cardName, entries }
  }

  /** Cheap authenticated call, used to tell a live session from an expired one. */
  async continueSession(): Promise<void> {
    await this.client.callMember('spapp/top/v1', { content: { subMeisaiCount: 1 } })
  }

  async logout(): Promise<void> {
    // The app API has fa/logout, but it is scoped to the unified ID and returns
    // an error for sessions that never linked one. Dropping the cookies ends
    // the session for our purposes either way.
    this.client.jar.import({})
  }

  async #statementBean(period?: string): Promise<{
    meisaiList?: Record<string, string>[]
    seikyuYMList?: { name?: string; value?: string }[]
    seikyuYM?: string
    cardName?: string
  }> {
    const content: Record<string, unknown> = { p03: '1' }
    if (period) content.p01 = period
    const payload = await this.client.callMember<{
      CustomizedMeisaiAnsDisplayServiceBean?: {
        meisaiList?: Record<string, string>[]
        seikyuYMList?: { name?: string; value?: string }[]
        seikyuYM?: string
        cardName?: string
      }
    }>('web_meisai/web_meisai_top/v1', { content })

    const bean = payload.CustomizedMeisaiAnsDisplayServiceBean
    if (!bean) throw new VpassError('statement response had no meisai bean')
    return bean
  }
}

/**
 * Logs in and returns a usable profile.
 *
 * Pass `token` to resume without the password. The token is single-use in
 * practice — each successful login mints a new one — so read
 * `profile.session.token` afterwards and persist that for next time.
 */
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const connect = async (options: ConnectOptions): Promise<VpassProfile> => {
  const idKind = options.idKind ?? 'vpass'
  const endpoint = options.endpoint ?? 'Fauth'
  const deviceId = options.deviceId ?? randomUUID()
  if (!canonicalUuid.test(deviceId)) {
    throw new VpassAuthError('deviceId must be a canonical UUID')
  }
  if (endpoint === 'Vauth' && idKind === 'fa') {
    throw new VpassAuthError('Vauth does not support an FA ID')
  }
  const osVersion = options.osVersion ?? DEFAULT_VPASS_OS_VERSION
  const userAgent = options.userAgent ?? buildVpassUserAgent(options.appVersion)
  const client = new VpassClient({ ...options, osVersion, userAgent })
  if (options.cookies) client.jar.import(options.cookies)

  const method: LoginMethod = options.token
    ? { mode: 'token', token: options.token, idKind }
    : (() => {
        if (!options.loginId || !options.password) {
          throw new VpassAuthError('connect needs loginId and password, or a token')
        }
        return {
          mode: 'credential',
          loginId: options.loginId,
          password: options.password,
          idKind,
        } as const
      })()

  const session: VpassSession = {
    apiBaseURL: String(options.apiBaseURL),
    webBaseURL: String(options.webBaseURL),
    appVersion: options.appVersion,
    osVersion,
    userAgent,
    endpoint,
    push: options.push ?? false,
    deviceId,
    deviceToken: options.deviceToken ?? '',
    cardCompanyCode: options.cardCompanyCode ?? '001',
    idKind,
    cookies: {},
  }

  const data = await client.authenticate(method, {
    deviceId: session.deviceId,
    deviceToken: session.deviceToken,
    cardCompanyCode: session.cardCompanyCode,
    push: session.push,
    endpoint: session.endpoint,
  })

  if (typeof data.login_token !== 'string') {
    throw new VpassAuthError('auth response carried no login_token')
  }

  const fields = decryptPayload(data.login_token).split(FIELD_DELIMITER)
  if (fields.length <= RESPONSE_FIELDS.digest) {
    throw new VpassAuthError(`auth response had ${fields.length} fields, expected at least 10`)
  }

  session.token = fields[RESPONSE_FIELDS.token]
  session.globalId = fields[RESPONSE_FIELDS.globalId]
  session.externalId = fields[RESPONSE_FIELDS.externalId]
  session.cardCode = fields[RESPONSE_FIELDS.cardCode]
  session.cardCompanyCode = fields[RESPONSE_FIELDS.cardCompanyCode] || session.cardCompanyCode
  session.cookies = client.jar.export()

  return new VpassProfile(client, session)
}

/** Reconnects using an exported session, falling back to nothing else. */
export const resume = async (
  session: VpassSession,
  overrides: Partial<ConnectOptions> = {},
): Promise<VpassProfile> => {
  if (!session.token) throw new VpassAuthError('session has no token to resume with')
  const appVersion = overrides.appVersion ?? session.appVersion
  const useDefaultUserAgent =
    overrides.appVersion !== undefined && overrides.userAgent === undefined
  return connect({
    apiBaseURL: session.apiBaseURL,
    webBaseURL: session.webBaseURL,
    appVersion,
    osVersion: session.osVersion,
    userAgent: useDefaultUserAgent ? buildVpassUserAgent(appVersion) : session.userAgent,
    endpoint: session.endpoint ?? 'Fauth',
    push: session.push ?? false,
    deviceId: session.deviceId,
    deviceToken: session.deviceToken,
    cardCompanyCode: session.cardCompanyCode,
    idKind: session.idKind,
    token: session.token,
    cookies: session.cookies,
    ...overrides,
  })
}
