import {
  MiniCustomEvent,
  MiniAudioContext,
  MiniAudioBuffer,
  MiniDOMParser,
  MiniDocumentFragment,
  MiniDocument,
  MiniElement,
  MiniEventTarget,
  MiniEvent,
  MiniFontFaceSet,
  MiniHTMLAnchorElement,
  MiniHTMLAudioElement,
  MiniHTMLCanvasElement,
  MiniHTMLFormElement,
  MiniHTMLFormControlsCollection,
  MiniHTMLIFrameElement,
  MiniHTMLImageElement,
  MiniHTMLMediaElement,
  MiniHTMLVideoElement,
  MiniHTMLScriptElement,
  MiniImageData,
  MiniMutationObserver,
  MiniNode,
  MiniOfflineAudioContext,
  MiniOffscreenCanvas,
  MiniCanvasRenderingContext2D,
  MiniWebGL2RenderingContext,
  MiniWebGLRenderingContext,
  MiniWindow,
  MiniXMLHttpRequest,
  createMiniWindow,
} from './browser-shim'
import { createTypeScriptIoBlackboxRuntime, type StarbucksIoBlackboxOptions } from './iovation'
import type { StarbucksIoBrowserEnvironment } from './iovation'
import {
  createStarbucksKxzHeaders,
  parseStarbucksKxzBootstrapInit,
  readStarbucksKxzHeaders,
} from './kxz-protocol'
import { createStarbucksPureKxzVm, type StarbucksPureVmRuntime } from './kxz-vm'
import { createStarbucksCurrentPureKxzVm } from './current-kxz-vm'
import { extractCurrentKxzRuntimeData, extractPinnedKxzRuntimeData } from './antibot-data'
import { createStarbucksQuickJsBrowserRuntime } from './quickjs-browser'

export interface StarbucksAntiBotScripts {
  /** The fetch/XHR instrumentation script (HAR entry 0002/0226). */
  instrumentation: string
  /** The inline seed/bootstrap script (HAR entry 0012/0236). */
  bootstrap: string
  /** The anti-bot script containing the WebAssembly helpers (HAR entry 0016/0240). */
  main: string
  /** Script element URLs used to populate `document.currentScript.src`. */
  scriptURLs?: Partial<Record<StarbucksKxzStage, string | URL>>
}

export interface StarbucksKxzRequest {
  url: string | URL
  method?: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
}

export interface StarbucksKxzRuntime {
  getHeaders(request: StarbucksKxzRequest): Promise<Record<string, string>>
  close(): void
}

export interface StarbucksKxzRuntimeOptions {
  pageURL: string | URL
  userAgent?: string
  verbose?: boolean
  /**
   * Optional already-created browser realm. When supplied, the VM observes
   * its native DOM/network/Web API values instead of the deterministic shim.
   * The realm is never populated by executing the vendor source.
   */
  browserEnvironment?: StarbucksIoBrowserEnvironment
}

export type StarbucksKxzStage = 'instrumentation' | 'bootstrap' | 'main'

export const STARBUCKS_KXZ_HEADER_SUFFIXES = ['a', 'b', 'c', 'd', 'f', 'z'] as const
export const STARBUCKS_KXZ_HEADER_PREFIX = 'KXZ2x4Fzkp-'
export const STARBUCKS_LOGIN_ANTI_BOT_FIELD_PREFIX = 'gQHuspkwZ2-'

export interface StarbucksIoBlackboxRuntime {
  getBlackbox(): Promise<string>
  close(): void
}

export interface StarbucksLoginFormValues {
  username: string
  password: string
  rememberMe?: boolean
  deviceFingerprint?: string
}

export interface StarbucksLoginFormOptions {
  /** URL of the login document. It is also used as the form's base URL. */
  pageURL: string | URL
  /** Browser dimensions used by the page's anti-bot code. */
  width?: number
  height?: number
  devicePixelRatio?: number
  userAgent?: string
  timeoutMs?: number
  /** Host fetch used by the QuickJS realm to load the page's iOvation WDP. */
  fetch?: typeof fetch
}

export interface StarbucksLoginFormData {
  action: string
  method: string
  fields: URLSearchParams
}

const noopConsole = {
  ...console,
  debug() {},
  info() {},
  log() {},
  warn() {},
}

const asRecord = (value: unknown) => value as Record<string, unknown>

type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

export const createTrackedTimers = () => {
  const handles = new Set<TimerHandle>()
  const trackedSetTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const handle = setTimeout(...args)
    handles.add(handle)
    return handle
  }) as typeof setTimeout
  const trackedClearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    handles.delete(handle as TimerHandle)
    clearTimeout(handle)
  }) as typeof clearTimeout
  const trackedSetInterval = ((...args: Parameters<typeof setInterval>) => {
    const handle = setInterval(...args)
    handles.add(handle)
    return handle
  }) as typeof setInterval
  const trackedClearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    handles.delete(handle as TimerHandle)
    clearInterval(handle)
  }) as typeof clearInterval
  return {
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
    close() {
      for (const handle of handles) {
        clearTimeout(handle)
        clearInterval(handle)
      }
      handles.clear()
    },
  }
}

const setWindowProperty = (window: Record<string, unknown>, name: string, value: unknown) => {
  try {
    Object.defineProperty(window, name, { configurable: true, value })
  } catch {
    window[name] = value
  }
}

export const installBrowserGlobals = (
  window: Record<string, unknown>,
  timers: ReturnType<typeof createTrackedTimers>,
) => {
  window.console = noopConsole
  window.Object = Object
  setWindowProperty(window, 'undefined', undefined)
  setWindowProperty(window, 'NaN', Number.NaN)
  setWindowProperty(window, 'Infinity', Number.POSITIVE_INFINITY)
  window.Array = Array
  window.String = String
  window.Number = Number
  window.Boolean = Boolean
  window.RegExp = RegExp
  setWindowProperty(
    window,
    'CSS',
    class CSS {
      static supports() {
        return false
      }

      static escape(value: string) {
        return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
      }
    },
  )
  window.Error = Error
  window.TypeError = TypeError
  window.ReferenceError = ReferenceError
  window.RangeError = RangeError
  window.Date = Date
  window.Math = Math
  window.JSON = JSON
  window.Promise = Promise
  window.Proxy = Proxy
  window.Reflect = Reflect
  window.crypto = globalThis.crypto
  window.performance = globalThis.performance
  window.URL = URL
  window.Blob = Blob
  // Bun/Node's Web Worker implementation supports `blob:` URLs and preserves
  // the browser message boundary without a VM context. KXZ uses this probe
  // path when the page exposes Worker.
  setWindowProperty(window, 'Worker', globalThis.Worker)
  window.FormData = FormData
  window.Request = Request
  window.Headers = Headers
  window.Response = Response
  setWindowProperty(window, 'Event', MiniEvent)
  setWindowProperty(window, 'EventTarget', MiniEventTarget)
  setWindowProperty(window, 'CustomEvent', MiniCustomEvent)
  setWindowProperty(window, 'MutationObserver', MiniMutationObserver)
  setWindowProperty(window, 'DOMParser', MiniDOMParser)
  setWindowProperty(window, 'Document', MiniDocument)
  setWindowProperty(window, 'DocumentFragment', MiniDocumentFragment)
  setWindowProperty(window, 'FontFaceSet', MiniFontFaceSet)
  setWindowProperty(window, 'Navigator', function Navigator() {})
  setWindowProperty(window, 'Window', MiniWindow)
  setWindowProperty(window, 'UIEvent', MiniEvent)
  setWindowProperty(window, 'SubmitEvent', MiniEvent)
  setWindowProperty(window, 'HTMLInputElement', MiniElement)
  setWindowProperty(window, 'HTMLButtonElement', MiniElement)
  setWindowProperty(window, 'HTMLDivElement', MiniElement)
  setWindowProperty(window, 'HTMLBodyElement', MiniElement)
  setWindowProperty(window, 'HTMLHeadElement', MiniElement)
  setWindowProperty(window, 'HTMLImageElement', MiniHTMLImageElement)
  setWindowProperty(window, 'HTMLStyleElement', MiniElement)
  setWindowProperty(window, 'HTMLLIElement', MiniElement)
  setWindowProperty(window, 'HTMLParagraphElement', MiniElement)
  setWindowProperty(window, 'HTMLUListElement', MiniElement)
  setWindowProperty(window, 'HTMLSpanElement', MiniElement)
  setWindowProperty(window, 'HTMLSelectElement', MiniElement)
  setWindowProperty(window, 'HTMLTextAreaElement', MiniElement)
  setWindowProperty(window, 'HTMLCanvasElement', MiniHTMLCanvasElement)
  setWindowProperty(window, 'OffscreenCanvas', MiniOffscreenCanvas)
  setWindowProperty(window, 'CanvasRenderingContext2D', MiniCanvasRenderingContext2D)
  setWindowProperty(window, 'WebGLRenderingContext', MiniWebGLRenderingContext)
  setWindowProperty(window, 'WebGL2RenderingContext', MiniWebGL2RenderingContext)
  setWindowProperty(window, 'ImageData', MiniImageData)
  setWindowProperty(window, 'HTMLMediaElement', MiniHTMLMediaElement)
  setWindowProperty(window, 'HTMLAudioElement', MiniHTMLAudioElement)
  setWindowProperty(window, 'HTMLVideoElement', MiniHTMLVideoElement)
  setWindowProperty(window, 'HTMLScriptElement', MiniHTMLScriptElement)
  setWindowProperty(window, 'HTMLElement', MiniElement)
  setWindowProperty(window, 'Element', MiniElement)
  setWindowProperty(window, 'Node', MiniNode)
  setWindowProperty(window, 'HTMLAnchorElement', MiniHTMLAnchorElement)
  setWindowProperty(window, 'HTMLFormElement', MiniHTMLFormElement)
  setWindowProperty(window, 'HTMLFormControlsCollection', MiniHTMLFormControlsCollection)
  setWindowProperty(window, 'HTMLIFrameElement', MiniHTMLIFrameElement)
  setWindowProperty(window, 'XMLHttpRequest', MiniXMLHttpRequest)
  setWindowProperty(window, 'AudioContext', MiniAudioContext)
  setWindowProperty(window, 'webkitAudioContext', MiniAudioContext)
  setWindowProperty(window, 'OfflineAudioContext', MiniOfflineAudioContext)
  setWindowProperty(window, 'webkitOfflineAudioContext', MiniOfflineAudioContext)
  setWindowProperty(window, 'AudioBuffer', MiniAudioBuffer)
  setWindowProperty(window, 'HTMLCollection', Array)
  setWindowProperty(window, 'NodeList', Array)
  setWindowProperty(window, 'NamedNodeMap', Map)
  window.TextEncoder = TextEncoder
  window.TextDecoder = TextDecoder
  window.Uint8Array = Uint8Array
  window.Uint32Array = Uint32Array
  window.Int8Array = Int8Array
  window.Int32Array = Int32Array
  window.Float32Array = Float32Array
  window.Float64Array = Float64Array
  window.ArrayBuffer = ArrayBuffer
  window.Function = Function
  window.Symbol = Symbol
  window.BigInt = BigInt
  window.Intl = Intl
  window.EvalError = EvalError
  window.AggregateError = AggregateError
  window.parseInt = Number.parseInt
  window.parseFloat = Number.parseFloat
  window.isNaN = Number.isNaN
  window.isFinite = Number.isFinite
  window.escape = globalThis.escape
  window.unescape = globalThis.unescape
  window.encodeURI = encodeURI
  window.decodeURI = decodeURI
  window.encodeURIComponent = encodeURIComponent
  window.decodeURIComponent = decodeURIComponent
  setWindowProperty(
    window,
    'Image',
    class Image extends MiniHTMLImageElement {
      constructor() {
        super(window.document as never)
      }
    },
  )
  setWindowProperty(
    window,
    'Audio',
    class Audio extends MiniHTMLAudioElement {
      constructor() {
        super(window.document as never)
      }
    },
  )
  setWindowProperty(window, 'Option', MiniElement)
  window.getComputedStyle = () => ({ getPropertyValue: () => '' })
  window.matchMedia = () => ({ matches: false, media: '', addListener() {}, removeListener() {} })
  window.requestAnimationFrame = (callback: (time: number) => unknown) =>
    timers.setTimeout(() => callback(Date.now()), 0)
  window.cancelAnimationFrame = (handle: unknown) => timers.clearTimeout(handle as never)
  window.queueMicrotask = queueMicrotask
  window.atob = atob
  window.btoa = btoa
  // Event handler IDL attributes are own properties in a browser realm. The
  // script assigns `window.onload`/`document.onreadystatechange` directly;
  // predeclare them so `with(scope)` writes to the shim object rather than to
  // the host process global.
  for (const type of [
    'load',
    'error',
    'beforeunload',
    'unload',
    'readystatechange',
    'DOMContentLoaded',
    'submit',
    'message',
  ]) {
    setWindowProperty(window, `on${type}`, null)
    setWindowProperty(window.document as unknown as Record<string, unknown>, `on${type}`, null)
  }
  window.localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
    clear() {},
    length: 0,
  }
  window.sessionStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
    clear() {},
    length: 0,
  }
  window.indexedDB = undefined
  window.open = () => null
  window.addEventListener = (window.addEventListener as MiniWindow['addEventListener']).bind(window)
  window.removeEventListener = (
    window.removeEventListener as MiniWindow['removeEventListener']
  ).bind(window)
  window.dispatchEvent = (window.dispatchEvent as MiniWindow['dispatchEvent']).bind(window)
  window.setTimeout = timers.setTimeout
  window.clearTimeout = timers.clearTimeout
  window.setInterval = timers.setInterval
  window.clearInterval = timers.clearInterval
}

/**
 * Header runtime backed by the statically extracted KXZ VM.  The VM exposes
 * the same final exchange object as the browser bundle; this adapter consumes
 * that object directly and never evaluates vendor source or instantiates a
 * WebAssembly module through the host API.
 */
class PureKxzRuntime implements StarbucksKxzRuntime {
  #queue = Promise.resolve()

  constructor(
    private readonly detail: Record<string, unknown>,
    private readonly closeRuntime: () => void,
  ) {}

  getHeaders(request: StarbucksKxzRequest) {
    const operation = this.#queue.then(() => {
      const shouldHook = this.detail.shouldHook
      if (typeof shouldHook !== 'function') throw new Error('KXZ pure VM did not expose shouldHook')
      if (
        !Reflect.apply(shouldHook, this.detail, [
          { url: String(request.url), method: request.method ?? 'GET' },
        ])
      )
        throw new Error(`KXZ pure VM rejected request ${String(request.url)}`)
      const getEncodedData = this.detail.getEncodedData
      if (typeof getEncodedData !== 'function')
        throw new Error('KXZ pure VM did not expose getEncodedData')
      const encoded = Reflect.apply(getEncodedData, this.detail, [])
      if (!encoded || typeof encoded !== 'object')
        throw new Error('KXZ pure VM returned an invalid encoded data object')
      const values = encoded as Record<string, unknown>
      const headers = {
        a: values.a,
        b: values.b,
        c: values.c,
        d: values.d,
        f: values.f,
        z: values.z,
      }
      for (const [suffix, value] of Object.entries(headers))
        if (typeof value !== 'string' || value.length === 0)
          throw new Error(`KXZ pure VM returned an invalid ${suffix} value`)
      const chunk = this.detail.chunk
      const config = this.detail.config
      const wire = new Headers()
      if (
        typeof chunk === 'function' &&
        config &&
        typeof config === 'object' &&
        typeof (config as Record<string, unknown>).headerChunkSize === 'number' &&
        typeof (config as Record<string, unknown>).headerNamePrefix === 'string'
      ) {
        for (const [suffix, value] of Object.entries(headers)) {
          const chunked = Reflect.apply(chunk, this.detail, [
            `${(config as Record<string, unknown>).headerNamePrefix}${suffix}`,
            value,
            (config as Record<string, unknown>).headerChunkSize,
          ])
          if (!chunked || typeof chunked !== 'object')
            throw new Error(`KXZ pure VM returned invalid ${suffix} chunks`)
          for (const [name, chunkValue] of Object.entries(chunked)) {
            if (typeof chunkValue !== 'string' || chunkValue.length === 0)
              throw new Error(`KXZ pure VM returned an invalid ${name} chunk`)
            wire.set(name, chunkValue)
          }
        }
      } else {
        for (const [suffix, value] of Object.entries(headers))
          wire.set(`KXZ2x4Fzkp-${suffix}`, value as string)
      }
      return createStarbucksKxzHeaders(readStarbucksKxzHeaders(wire))
    })
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  close() {
    this.closeRuntime()
  }
}

/**
 * Creates a runtime for the captured anti-bot scripts without a Node VM
 * dependency. The browser realm is the local TypeScript shim.
 *
 * The scripts are caller-supplied on purpose: the seed, origin and script
 * version change over time and must never be hardcoded into the SDK.
 */
export const createStarbucksKxzRuntime = async (
  scripts: StarbucksAntiBotScripts,
  options: StarbucksKxzRuntimeOptions,
): Promise<StarbucksKxzRuntime> => {
  const page =
    options.browserEnvironment ??
    (createMiniWindow(String(options.pageURL)) as unknown as Record<string, unknown>)
  const pageDocument = page.document as Record<string, unknown> | undefined
  if (!options.browserEnvironment && pageDocument) pageDocument.defaultView = page
  const window = asRecord(page)
  const timers = createTrackedTimers()

  if (!options.browserEnvironment) installBrowserGlobals(window, timers)
  window.console = options.verbose ? console : noopConsole
  if (options.userAgent)
    setWindowProperty(window.navigator as Record<string, unknown>, 'userAgent', options.userAgent)

  // Parse the fetched source into an in-memory contract. Vendor JavaScript is
  // never evaluated by this VM.
  setWindowProperty(window, 'window', page)
  setWindowProperty(window, 'self', page)
  setWindowProperty(window, 'globalThis', page)
  setWindowProperty(window, 'global', page)
  let pureRuntime: StarbucksPureVmRuntime | undefined
  try {
    const bootstrapInit = parseStarbucksKxzBootstrapInit(scripts.bootstrap)
    let runtime: StarbucksPureVmRuntime
    try {
      const data = extractCurrentKxzRuntimeData(
        scripts.main,
        scripts.instrumentation,
        scripts.bootstrap,
      )
      runtime = createStarbucksCurrentPureKxzVm(window, { bootstrapInit, data })
    } catch (currentError) {
      try {
        const data = extractPinnedKxzRuntimeData(scripts)
        runtime = createStarbucksPureKxzVm(window, { bootstrapInit, data })
      } catch (pinnedError) {
        throw new Error(
          `KXZ bundle could not be parsed into a supported runtime contract: ${
            pinnedError instanceof Error ? pinnedError.message : String(currentError)
          }`,
          { cause: pinnedError },
        )
      }
    }
    pureRuntime = runtime
    runtime.run()
    const exchangeEvent = runtime
      .events()
      .find(
        (event) =>
          event.detail &&
          typeof event.detail === 'object' &&
          'getEncodedData' in event.detail &&
          'shouldHook' in event.detail &&
          'config' in event.detail,
      )
    if (!exchangeEvent || !exchangeEvent.detail || typeof exchangeEvent.detail !== 'object')
      throw new Error('KXZ pure VM did not produce the final exchange contract')
    return new PureKxzRuntime(asRecord(exchangeEvent.detail), () => {
      runtime.close()
      timers.close()
      ;(asRecord(page).close as (() => void) | undefined)?.()
    })
  } catch (error) {
    pureRuntime?.close()
    timers.close()
    ;(asRecord(page).close as (() => void) | undefined)?.()
    throw error
  }
}

/**
 * Creates a TypeScript runtime for the captured TransUnion/iOvation WDP script.
 * The script is caller-supplied because its version and collector configuration
 * are vendor-controlled and change independently of the SDK.
 */
export const createStarbucksIoBlackboxRuntime = async (
  script: string,
  options: StarbucksIoBlackboxOptions,
): Promise<StarbucksIoBlackboxRuntime> => {
  return createTypeScriptIoBlackboxRuntime(script, options)
}

const extractLoginAntiBotScript = (html: string) => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1] ?? '',
  )
  const script = scripts
    .filter((value) => value.length > 100_000)
    .sort((left, right) => right.length - left.length)[0]
  if (!script || !/HTMLFormElement|Blob|submit/.test(script)) {
    throw new Error('login page did not contain a supported anti-bot script')
  }
  return script
}

const generateStarbucksLoginFormDataQuickJs = async (
  html: string,
  values: StarbucksLoginFormValues,
  options: StarbucksLoginFormOptions,
): Promise<StarbucksLoginFormData> => {
  const runtime = await createStarbucksQuickJsBrowserRuntime({
    pageURL: options.pageURL,
    userAgent: options.userAgent,
    html,
    fetch: options.fetch,
  })
  try {
    const source = extractLoginAntiBotScript(html)
    runtime.evaluate(source, 'starbucks-login-quickjs-inline.js')
    runtime.evaluate(
      `(() => {
        const form = document.querySelector('form')
        if (!form) throw new Error('login page did not contain a form')
        const setInput = (name, value) => {
          const input = form.querySelector('input[name="' + name + '"]')
          if (!input) return
          input.value = String(value ?? '')
          input.dispatchEvent(new Event('input', { bubbles: true, isTrusted: true }))
          input.dispatchEvent(new Event('change', { bubbles: true, isTrusted: true }))
        }
        document.readyState = 'interactive'
        document.dispatchEvent(new Event('readystatechange'))
        document.dispatchEvent(new Event('DOMContentLoaded'))
        document.readyState = 'complete'
        document.dispatchEvent(new Event('readystatechange'))
        window.dispatchEvent(new Event('load', { isTrusted: true }))
        setInput('username', ${JSON.stringify(values.username)})
        setInput('password', ${JSON.stringify(values.password)})
        ${values.deviceFingerprint === undefined ? '' : `setInput('ms2_devicefingerprint', ${JSON.stringify(values.deviceFingerprint)})`}
        const remember = form.querySelector('input[name="remember-me"]')
        if (remember) {
          remember.checked = ${Boolean(values.rememberMe)}
          remember.dispatchEvent(new Event('change', { bubbles: true, isTrusted: true }))
        }
        const submitter = form.querySelector('button[type="submit"],input[type="submit"]')
        if (!submitter) throw new Error('login page did not contain a submit control')
        submitter.click()
        return true
      })()`,
      'starbucks-login-quickjs-lifecycle.js',
    )
    const expected = new Set(
      STARBUCKS_KXZ_HEADER_SUFFIXES.map(
        (suffix) => `${STARBUCKS_LOGIN_ANTI_BOT_FIELD_PREFIX}${suffix}`,
      ),
    )
    const deadline = Date.now() + (options.timeoutMs ?? 5_000)
    let fields: Record<string, string> = {}
    while (Date.now() < deadline) {
      runtime.drainJobs(250)
      fields = runtime.readFormFields()
      if ([...expected].every((name) => name in fields)) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const generated = [...expected].filter((name) => name in fields)
    if (generated.length !== expected.size)
      throw new Error(
        `login QuickJS runtime did not produce all gQHuspkwZ2 hidden inputs (got ${generated.join(',') || 'none'})`,
      )
    const metadata = runtime.evaluate(
      `(() => { const form = document.querySelector('form'); return [String(form.action || location.href), String(form.method || 'get').toUpperCase()] })()`,
      'starbucks-login-quickjs-form.js',
    ) as [string, string]
    const fieldsData = new URLSearchParams()
    for (const [name, value] of Object.entries(fields)) fieldsData.append(name, value)
    return {
      action: metadata[0] ?? String(options.pageURL),
      method: metadata[1] ?? 'GET',
      fields: fieldsData,
    }
  } finally {
    runtime.close()
  }
}

/**
 * Executes the login page's rotating anti-bot script in QuickJS.
 * The source is supplied by the page and evaluated only inside its browser realm.
 */
export const generateStarbucksLoginFormData = async (
  html: string,
  values: StarbucksLoginFormValues,
  options: StarbucksLoginFormOptions,
): Promise<StarbucksLoginFormData> => {
  if (!values.username || !values.password)
    throw new Error('login username and password are required')
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('login anti-bot timeoutMs must be a positive finite number')
  return generateStarbucksLoginFormDataQuickJs(
    html,
    { ...values, deviceFingerprint: undefined },
    options,
  )
}
