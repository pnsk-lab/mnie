import { createHash } from 'node:crypto'
import { arch, cpus, platform, release } from 'node:os'

export interface StarbucksNodeFingerprint {
  navigator: {
    userAgent: string
    appVersion: string
    appName: string
    platform: string
    oscpu: string
    hardwareConcurrency: number
    language: string
    languages: string[]
    plugins: string[]
    cookieEnabled: boolean
  }
  screen: {
    width: number
    height: number
    colorDepth: number
  }
  document: {
    url: string
    referrer: string
    readyState: string
  }
  capabilities: {
    canvas: false
    webgl: false
    offlineAudio: false
    webRtc: false
    webSocket: false
    localStorage: false
    indexedDb: false
    serviceWorker: false
  }
  runtime: {
    node: string
    platform: string
    release: string
    arch: string
    timezone: string
  }
}

export interface StarbucksNodeFingerprintOptions {
  url?: string
  referrer?: string
  userAgent?: string
  language?: string
  languages?: string[]
}

type NavigatorLike = Partial<StarbucksNodeFingerprint['navigator']> & {
  appVersion?: string
  appName?: string
  oscpu?: string
  plugins?: ArrayLike<unknown>
  cookieEnabled?: boolean
}

const navigatorValue = () =>
  (globalThis as typeof globalThis & { navigator?: NavigatorLike }).navigator ?? {}

const stringValue = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const numberValue = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const sortedValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortedValue(nested)]),
  )
}

export const collectStarbucksNodeFingerprint = (
  options: StarbucksNodeFingerprintOptions = {},
): StarbucksNodeFingerprint => {
  const nav = navigatorValue()
  const language = stringValue(options.language ?? nav.language, 'en-US')
  const languages = (options.languages ?? nav.languages ?? [language]).filter(
    (value): value is string => typeof value === 'string',
  )
  const userAgent = stringValue(
    options.userAgent ?? nav.userAgent,
    `Node.js/${process.versions.node}`,
  )

  return {
    navigator: {
      userAgent,
      appVersion: stringValue(nav.appVersion, userAgent),
      appName: stringValue(nav.appName, 'Netscape'),
      platform: stringValue(nav.platform, platform()),
      oscpu: stringValue(nav.oscpu, `${platform()} ${arch()}`),
      hardwareConcurrency: numberValue(nav.hardwareConcurrency, Math.max(1, cpus().length)),
      language,
      languages: [...new Set(languages)],
      plugins: Array.from(nav.plugins ?? [], (value) => String(value)),
      cookieEnabled: nav.cookieEnabled ?? false,
    },
    screen: { width: 0, height: 0, colorDepth: 0 },
    document: {
      url: options.url ?? '',
      referrer: options.referrer ?? '',
      readyState: 'complete',
    },
    capabilities: {
      canvas: false,
      webgl: false,
      offlineAudio: false,
      webRtc: false,
      webSocket: false,
      localStorage: false,
      indexedDb: false,
      serviceWorker: false,
    },
    runtime: {
      node: process.versions.node,
      platform: platform(),
      release: release(),
      arch: arch(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    },
  }
}

/**
 * Produces an opaque, deterministic Node fingerprint for local testing.
 * This is intentionally namespaced and is not an attempt to forge a browser's
 * vendor token; the captured browser scripts remain the source of truth for
 * real browser sessions.
 */
export const getStarbucksNodeFingerprint = (
  options: StarbucksNodeFingerprintOptions = {},
): string => {
  const payload = sortedValue(collectStarbucksNodeFingerprint(options))
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const digest = createHash('sha256').update(encoded).digest('base64url')
  return `node-v1.${digest}.${encoded}`
}
