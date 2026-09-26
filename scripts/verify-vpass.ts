import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  connect,
  createProvider,
  normalizeOrigin,
  resume,
  VpassError,
  type ConnectOptions,
  type FetchLike,
  type VpassProfile,
  type VpassSession,
} from '../packages/provider-vpass/src/index'

const help = `Usage: bun run verify:vpass [--resume] [--help]

Default: password login -> accounts/statements -> save -> resume -> session check.
--resume: load the saved session, then verify accounts/statements without a password.

Required: VPASS_API_BASE_URL, VPASS_WEB_BASE_URL, VPASS_APP_VERSION
Password login: VPASS_ID, VPASS_PASSWORD
Optional:
  VPASS_OS_VERSION        override the provider's Android release
  VPASS_USER_AGENT        override the full app + Android WebView User-Agent
  VPASS_DEVICE_ID         stable lowercase UUID (generated and saved when omitted)
  VPASS_ID_KIND           vpass (default) or fa
  VPASS_AUTH_ENDPOINT     Fauth (default) or Vauth
  VPASS_PUSH              0 (default) or 1
  VPASS_DEVICE_TOKEN      captured FCM token (default: empty)
  VPASS_VERIFY_FROM       usage date, YYYY-MM-DD (use together with TO)
  VPASS_VERIFY_TO         usage date, YYYY-MM-DD
  VPASS_SESSION_FILE      default: data/vpass/session.json

Session files contain secrets and are saved with mode 0600. Tokens rotate on
login: do not run this script concurrently with another user of the same token.
Output contains only stages, HTTP metadata and counts; no raw responses.
`

class VerificationError extends Error {}

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new VerificationError(`${name} is required`)
  return value
}

const optional = (name: string) => {
  const value = process.env[name]
  if (value === undefined) return undefined
  if (!value) throw new VerificationError(`${name} must not be empty`)
  return value
}

const optionalHeader = (name: string) => {
  const value = optional(name)
  if (value !== undefined && /[\r\n]/.test(value)) {
    throw new VerificationError(`${name} must be a single HTTP header value`)
  }
  return value
}

const date = (name: string) => {
  const value = process.env[name]
  if (value === undefined) return undefined
  const parsed = new Date(value)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new VerificationError(`${name} must be a valid YYYY-MM-DD date`)
  }
  return value
}

const origin = (name: string) => {
  const value = required(name)
  try {
    return normalizeOrigin(value, name)
  } catch {
    throw new VerificationError(`${name} must be an HTTPS origin without credentials or a path`)
  }
}

const pushFlag = () => {
  const value = process.env.VPASS_PUSH
  if (value === undefined) return false
  if (value !== '0' && value !== '1') throw new VerificationError('VPASS_PUSH must be 0 or 1')
  return value === '1'
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let stage = 'configuration'
let lastHttp: { path: string; httpStatus: number; json: boolean } | undefined
const report = (details: Record<string, unknown>) =>
  console.log(JSON.stringify({ stage, ...details }))

const transport: FetchLike = async (url, init) => {
  lastHttp = undefined
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  lastHttp = {
    path: url.pathname,
    httpStatus: response.status,
    json: (response.headers.get('content-type') ?? '').includes('json'),
  }
  report({ http: lastHttp })
  return response
}

const save = async (path: string, profile: VpassProfile) => {
  // Write immediately after authentication, before any statement request can fail.
  const session = { ...profile.session, cookies: profile.client.jar.export() }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(session, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

const load = async (path: string): Promise<VpassSession> => {
  const session = JSON.parse(await readFile(path, 'utf8')) as VpassSession
  if (
    !session ||
    ['apiBaseURL', 'webBaseURL', 'appVersion', 'deviceId', 'cardCompanyCode', 'token'].some(
      (key) =>
        typeof session[key as keyof VpassSession] !== 'string' ||
        !session[key as keyof VpassSession],
    ) ||
    !canonicalUuid.test(session.deviceId) ||
    typeof session.deviceToken !== 'string' ||
    !['vpass', 'fa'].includes(session.idKind) ||
    (session.endpoint !== undefined && !['Fauth', 'Vauth'].includes(session.endpoint)) ||
    (session.push !== undefined && typeof session.push !== 'boolean') ||
    (session.osVersion !== undefined && typeof session.osVersion !== 'string') ||
    (session.userAgent !== undefined && typeof session.userAgent !== 'string') ||
    !session.cookies ||
    typeof session.cookies !== 'object' ||
    Array.isArray(session.cookies) ||
    Object.values(session.cookies).some((value) => typeof value !== 'string')
  ) {
    throw new VerificationError('Invalid saved Vpass session')
  }
  return session
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(help)
    return
  }
  if (args.some((arg) => arg !== '--resume')) {
    throw new VerificationError('Unknown argument; use --help')
  }
  const resumeOnly = args.includes('--resume')
  const apiBaseURL = origin('VPASS_API_BASE_URL')
  const webBaseURL = origin('VPASS_WEB_BASE_URL')
  const configuredEndpoint = optional('VPASS_AUTH_ENDPOINT')
  const configuredIdKind = optional('VPASS_ID_KIND')
  if (
    configuredEndpoint !== undefined &&
    configuredEndpoint !== 'Fauth' &&
    configuredEndpoint !== 'Vauth'
  ) {
    throw new VerificationError('VPASS_AUTH_ENDPOINT must be Fauth or Vauth')
  }
  if (configuredIdKind !== undefined && configuredIdKind !== 'vpass' && configuredIdKind !== 'fa') {
    throw new VerificationError('VPASS_ID_KIND must be vpass or fa')
  }
  const endpoint = configuredEndpoint ?? 'Fauth'
  const idKind = configuredIdKind ?? 'vpass'
  if (!resumeOnly && endpoint === 'Vauth' && idKind === 'fa') {
    throw new VerificationError('VPASS_AUTH_ENDPOINT=Vauth does not support VPASS_ID_KIND=fa')
  }
  const from = date('VPASS_VERIFY_FROM')
  const to = date('VPASS_VERIFY_TO')
  if (Boolean(from) !== Boolean(to) || (from && to && from > to)) {
    throw new VerificationError('Set both VPASS_VERIFY_FROM and VPASS_VERIFY_TO, with FROM <= TO')
  }
  const sessionFile = optional('VPASS_SESSION_FILE') ?? 'data/vpass/session.json'
  const path = resolve(sessionFile)
  const appVersion = required('VPASS_APP_VERSION')
  const osVersion = optionalHeader('VPASS_OS_VERSION')
  const userAgent = optionalHeader('VPASS_USER_AGENT')
  const deviceId = optional('VPASS_DEVICE_ID')
  if (deviceId && !canonicalUuid.test(deviceId)) {
    throw new VerificationError('VPASS_DEVICE_ID must be a canonical lowercase UUID')
  }
  if (userAgent) {
    const expectedPrefix = `com.smbc_card.vpass.android_v${appVersion} `
    if (!userAgent.startsWith(expectedPrefix) || !userAgent.includes('Mozilla/5.0')) {
      throw new VerificationError(
        'VPASS_USER_AGENT must contain the current app prefix and a full WebView User-Agent',
      )
    }
  }
  const options: Partial<ConnectOptions> = {
    apiBaseURL,
    webBaseURL,
    fetch: transport,
    ...(configuredEndpoint ? { endpoint: configuredEndpoint } : {}),
    ...(configuredIdKind ? { idKind: configuredIdKind } : {}),
    ...(osVersion ? { osVersion } : {}),
    ...(userAgent ? { userAgent } : {}),
    appVersion,
  }
  const credentials = resumeOnly
    ? undefined
    : { loginId: required('VPASS_ID'), password: required('VPASS_PASSWORD') }
  const push = pushFlag()
  stage = 'session-file'
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  stage = resumeOnly ? 'resume' : 'connect'
  let profile: VpassProfile
  if (resumeOnly) {
    const saved = await load(path)
    if (saved.apiBaseURL !== apiBaseURL || saved.webBaseURL !== webBaseURL) {
      throw new VerificationError('Saved session origins do not match configured origins')
    }
    if ((saved.endpoint ?? 'Fauth') === 'Vauth' && saved.idKind === 'fa') {
      throw new VerificationError('Saved Vauth session cannot use an FA ID')
    }
    profile = await resume(saved, options)
  } else {
    profile = await connect({
      ...options,
      ...credentials,
      apiBaseURL,
      webBaseURL,
      appVersion,
      ...(osVersion ? { osVersion } : {}),
      ...(userAgent ? { userAgent } : {}),
      idKind,
      endpoint,
      push,
      deviceId,
      deviceToken: process.env.VPASS_DEVICE_TOKEN,
    })
  }
  await save(path, profile)
  report({ ok: true, sessionSaved: true })

  const provider = createProvider(profile)
  stage = 'accounts.list'
  const accounts = await provider.invoke('accounts.list', {})
  report({ ok: true, count: accounts.items.length })

  stage = 'transactions.list'
  const transactions = await provider.invoke('transactions.list', { from, to })
  await save(path, profile)
  report({
    ok: true,
    count: transactions.items.length,
    scope: from ? 'date-range' : 'latest-period',
  })

  if (!resumeOnly) {
    stage = 'resume'
    const saved = await load(path)
    profile = await resume(saved, options)
    await save(path, profile)
    report({ ok: true, sessionSaved: true, tokenRotated: saved.token !== profile.session.token })
  }
  stage = 'session-check'
  await profile.continueSession()
  await save(path, profile)
  report({ ok: true })
  stage = 'complete'
  report({ ok: true })
}

try {
  await main()
} catch (error) {
  // Provider errors can embed server responses. Do not print messages or stacks.
  console.error(
    JSON.stringify({
      stage,
      ok: false,
      error: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof VerificationError ? error.message : undefined,
      providerStatus: error instanceof VpassError ? error.providerStatus : undefined,
      providerType: error instanceof VpassError ? error.providerType : undefined,
      http: lastHttp,
    }),
  )
  process.exitCode = 1
}
