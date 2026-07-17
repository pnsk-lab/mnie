import {
  createStarbucksIoBlackboxRuntime,
  createStarbucksKxzRuntime,
  type StarbucksAntiBotScripts,
  type StarbucksIoBlackboxRuntime,
  type StarbucksKxzRuntime,
} from './anti-bot'
import type { StarbucksIoBlackboxSignals, StarbucksIoBrowserEnvironment } from './iovation'
import { parseStarbucksKxzSeedURL } from './kxz-protocol'

export interface StarbucksDynamicScriptLoaderOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  userAgent?: string
  /** Explicit page viewport values when no real browser realm is supplied. */
  width?: number
  height?: number
  colorDepth?: number
  referrer?: string
  language?: string
  languages?: string[]
  /** Browser realm used for canvas/WebGL/audio/event probes. */
  browserEnvironment?: StarbucksIoBrowserEnvironment
  /** Explicit browser/session values to merge into both collector namespaces. */
  signals?: StarbucksIoBlackboxSignals
  /** Namespace-specific browser/session values when IO and FP differ. */
  ioSignals?: StarbucksIoBlackboxSignals
  fpSignals?: StarbucksIoBlackboxSignals
  /** Fetch the remote TP WDP in addition to the local FP WDP (default: true). */
  fetchRemoteWdp?: boolean
  /** Explicit loader version used when composing the remote WDP URL. */
  loaderVersion?: string
}

const defaultUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'

const fetchText = async (
  requestFetch: typeof fetch,
  url: URL,
  options: StarbucksDynamicScriptLoaderOptions,
  operation: string,
) => {
  const headers = new Headers({
    accept: 'text/html,application/javascript,text/javascript;q=0.9,*/*;q=0.8',
    'user-agent': options.userAgent ?? defaultUserAgent,
  })
  const response = await requestFetch(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  })
  if (!response.ok) throw new Error(`${operation} failed: HTTP ${response.status}`)
  return response.text()
}

const absoluteURL = (value: string, base: URL) => {
  try {
    return new URL(value, base)
  } catch {
    return undefined
  }
}

const extractScriptSource = (html: string, base: URL) => {
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => absoluteURL(match[1] ?? '', base))
    .filter((value): value is URL => value !== undefined)
  const single = sources.find((url) => url.searchParams.has('single'))
  if (!single) throw new Error('app page did not expose the KXZ single script URL')
  return single
}

const extractURLFromScript = (source: string, base: URL, predicate: (url: URL) => boolean) => {
  const candidates = [...source.matchAll(/["'](https?:\/\/[^"'\\]+|\/[^"'\\]+)["']/g)]
    .map((match) => absoluteURL(match[1] ?? '', base))
    .filter((value): value is URL => value !== undefined && predicate(value))
  const result = candidates[0]
  if (!result) throw new Error('KXZ loader did not expose the next script URL')
  return result
}

/** Downloads the current KXZ script chain from the app page. */
export const fetchStarbucksKxzScripts = async (
  appURL: string | URL,
  options: StarbucksDynamicScriptLoaderOptions = {},
): Promise<StarbucksAntiBotScripts> => {
  const requestFetch = options.fetch ?? fetch
  const appPageURL = new URL(appURL)
  const appHTML = await fetchText(requestFetch, appPageURL, options, 'app page')
  const singleURL = extractScriptSource(appHTML, appPageURL)
  const instrumentation = await fetchText(requestFetch, singleURL, options, 'KXZ instrumentation')
  const asyncURL = extractURLFromScript(
    instrumentation,
    singleURL,
    (url) => url.pathname === singleURL.pathname && url.searchParams.has('async'),
  )
  const bootstrap = await fetchText(requestFetch, asyncURL, options, 'KXZ bootstrap')
  const mainURL = extractURLFromScript(
    bootstrap,
    asyncURL,
    (url) =>
      url.pathname === asyncURL.pathname &&
      url.searchParams.has('seed') &&
      url.searchParams.has('KXZ2x4Fzkp--z'),
  )
  parseStarbucksKxzSeedURL(mainURL)
  const main = await fetchText(requestFetch, mainURL, options, 'KXZ main')
  return {
    instrumentation,
    bootstrap,
    main,
    scriptURLs: {
      instrumentation: singleURL,
      bootstrap: asyncURL,
      main: mainURL,
    },
  }
}

/** Downloads and instantiates the current KXZ runtime without a HAR file. */
export const createStarbucksKxzRuntimeFromApp = async (
  appURL: string | URL,
  options: StarbucksDynamicScriptLoaderOptions = {},
): Promise<StarbucksKxzRuntime> => {
  const scripts = await fetchStarbucksKxzScripts(appURL, options)
  return createStarbucksKxzRuntime(scripts, {
    pageURL: new URL(appURL).href,
    userAgent: options.userAgent,
    browserEnvironment: options.browserEnvironment,
  })
}

const extractIoVersion = (html: string) => {
  const match = html.match(/"loader"\s*:\s*\{[^}]*"version"\s*:\s*"([^"]+)"/s)
  if (!match?.[1]) throw new Error('login page did not expose the iOvation version')
  return match[1]
}

const extractIoStaticVersion = (script: string) => {
  const match = script.match(/(?:\.staticVer|\bstaticVer)\s*=\s*["']([^"']+)["']/)
  if (!match?.[1]) throw new Error('iOvation static WDP did not expose a staticVer value')
  return match[1]
}

const extractIoLoaderVersionFromScript = (script: string) =>
  script.match(/(?:loaderVer|loader_version)\s*[:=]\s*["']([^"']+)["']/)?.[1]

const extractIoLoaderVersionFromHtml = (html: string) =>
  html.match(/\bloaderVer\s*=\s*["']([^"']+)["']/)?.[1]

const decodeBase64 = (value: string) => {
  try {
    return Buffer.from(value, 'base64').toString()
  } catch {
    return ''
  }
}

const extractIoCollectorWdpURL = (script: string, namespace: string) => {
  const origins = [...script.matchAll(/\b(?:[A-Za-z_$][\w$]*\.)?decode\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => decodeBase64(match[1] ?? ''))
    .filter((value) => {
      try {
        const url = new URL(value)
        return /^https?:$/.test(url.protocol) && url.pathname === '/'
      } catch {
        return false
      }
    })
  const origin = origins[0]
  if (!origin) throw new Error('iOvation static WDP did not expose a remote collector origin')
  return new URL(`/${namespace}/wdp.js`, origin)
}

const decodeIoDynamicLiteral = (value: string) => {
  try {
    return Buffer.from(value, 'base64').toString()
  } catch {
    throw new Error('iOvation dynamic WDP exposed an invalid encoded literal')
  }
}

const extractIoLogoURL = (dynamicScript: string, baseURL?: string | URL) => {
  const host = dynamicScript.match(/contentServerHost\s*=\s*d\(\s*["']([^"']*)["']\s*\)/)?.[1]
  const path = dynamicScript.match(/ctokenScriptPath\s*=\s*d\(\s*["']([^"']+)["']\s*\)/)?.[1]
  if (host === undefined || !path)
    throw new Error('iOvation dynamic WDP did not expose the logo URL')
  const decodedHost = decodeIoDynamicLiteral(host)
  const decodedPath = decodeIoDynamicLiteral(path)
  if (!decodedHost && !baseURL)
    throw new Error('iOvation dynamic WDP exposed a relative logo URL without a base URL')
  const base = decodedHost
    ? `${decodedHost.replace(/\/$/, '')}/`
    : new URL(baseURL as string | URL).href
  return new URL(decodedPath, base)
}

/** Downloads the current iOvation static WDP script from the login page. */
export const fetchStarbucksIoBlackboxScript = async (
  loginURL: string | URL,
  options: StarbucksDynamicScriptLoaderOptions = {},
) => {
  const requestFetch = options.fetch ?? fetch
  const pageURL = new URL(loginURL)
  if (pageURL.pathname === '/') pageURL.pathname = '/login'
  const html = await fetchText(requestFetch, pageURL, options, 'login page')
  const version = extractIoVersion(html)
  const scriptURL = new URL(`/iojs/${version}/static_wdp.js`, pageURL)
  return fetchText(requestFetch, scriptURL, options, 'iOvation static WDP')
}

/** Downloads the literal dyn_wdp.js registration script for TS parsing. */
export const fetchStarbucksIoDynamicScript = async (
  loginURL: string | URL,
  staticScript: string,
  options: StarbucksDynamicScriptLoaderOptions = {},
) => {
  const requestFetch = options.fetch ?? fetch
  const pageURL = new URL(loginURL)
  const version = extractIoStaticVersion(staticScript)
  const scriptURL = new URL(`/iojs/${version}/dyn_wdp.js`, pageURL)
  return fetchText(requestFetch, scriptURL, options, 'iOvation dynamic WDP')
}

/** Downloads the remote TP WDP source referenced by the static collector. */
export const fetchStarbucksIoRemoteWdpScript = async (
  staticScript: string,
  namespace: string,
  options: StarbucksDynamicScriptLoaderOptions = {},
) => {
  const requestFetch = options.fetch ?? fetch
  const scriptURL = extractIoCollectorWdpURL(staticScript, namespace)
  const loaderVersion = options.loaderVersion ?? extractIoLoaderVersionFromScript(staticScript)
  if (loaderVersion) scriptURL.searchParams.set('loaderVer', loaderVersion)
  return fetchText(requestFetch, scriptURL, options, 'iOvation remote WDP')
}

/** Downloads the per-session logo.js token registration for pure TS parsing. */
export const fetchStarbucksIoLogoScript = async (
  dynamicScript: string,
  options: StarbucksDynamicScriptLoaderOptions = {},
  baseURL?: string | URL,
) => {
  const requestFetch = options.fetch ?? fetch
  return fetchText(requestFetch, extractIoLogoURL(dynamicScript, baseURL), options, 'iOvation logo')
}

/** Downloads and instantiates the current iOvation runtime without a HAR file. */
export const createStarbucksIoBlackboxRuntimeFromLogin = async (
  loginURL: string | URL,
  options: StarbucksDynamicScriptLoaderOptions = {},
): Promise<StarbucksIoBlackboxRuntime> => {
  const requestFetch = options.fetch ?? fetch
  const pageURL = new URL(loginURL)
  if (pageURL.pathname === '/') pageURL.pathname = '/login'
  const html = await fetchText(requestFetch, pageURL, options, 'login page')
  const alias = extractIoVersion(html)
  const staticURL = new URL(`/iojs/${alias}/static_wdp.js`, pageURL)
  const script = await fetchText(requestFetch, staticURL, options, 'iOvation static WDP')
  const dynamicScript = await fetchStarbucksIoDynamicScript(pageURL, script, options)
  const logoScript = await fetchStarbucksIoLogoScript(dynamicScript, options, pageURL)
  const loaderVersion =
    options.loaderVersion ??
    extractIoLoaderVersionFromHtml(html) ??
    extractIoLoaderVersionFromScript(script)
  const common = {
    pageURL: pageURL.href,
    userAgent: options.userAgent,
    width: options.width,
    height: options.height,
    colorDepth: options.colorDepth,
    referrer: options.referrer,
    language: options.language,
    languages: options.languages,
    loaderVersion,
    alias,
    intent: 'form',
    browserEnvironment: options.browserEnvironment,
  } as const
  const fpRuntime = await createStarbucksIoBlackboxRuntime(script, {
    ...common,
    namespace: 'FP',
    dynamicScript,
    logoScript,
    signals: { ...options.signals, ...options.fpSignals, BBNS: 'FP' },
  })
  if (options.fetchRemoteWdp === false) return fpRuntime

  let ioRuntime: StarbucksIoBlackboxRuntime
  try {
    const remoteScript = await fetchStarbucksIoRemoteWdpScript(script, alias, {
      ...options,
      loaderVersion,
    })
    const remoteLogoScript = await fetchStarbucksIoLogoScript(
      remoteScript,
      options,
      extractIoCollectorWdpURL(script, alias),
    )
    ioRuntime = await createStarbucksIoBlackboxRuntime(remoteScript, {
      ...common,
      namespace: 'IO',
      dynamicScript: remoteScript,
      logoScript: remoteLogoScript,
      signals: { ...options.signals, ...options.ioSignals, BBNS: 'IO' },
    })
  } catch (error) {
    fpRuntime.close()
    throw error
  }
  let cached: Promise<string> | undefined
  let closed = false
  return {
    async getBlackbox() {
      if (closed) throw new Error('iOvation runtime is closed')
      cached ??= Promise.all([ioRuntime.getBlackbox(), fpRuntime.getBlackbox()]).then(
        ([io, fp]) => `${io};${fp}`,
      )
      return cached
    },
    close() {
      closed = true
      ioRuntime.close()
      fpRuntime.close()
    },
  }
}
