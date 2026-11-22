import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten'
import { STARBUCKS_BROWSER_SHIM_SOURCE } from './browser-shim-bundle'

export const STARBUCKS_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'

/** Options for the isolated QuickJS browser realm. */
export interface StarbucksQuickJsBrowserOptions {
  pageURL: string | URL
  userAgent?: string
  html?: string
  /** Host fetch used to load the iOvation scripts referenced by the page. */
  fetch?: typeof fetch
}

export interface StarbucksQuickJsBrowserRuntime {
  /** Evaluate source inside the isolated realm and return its JSON-safe value. */
  evaluate(source: string, filename?: string): unknown
  /** Run queued timer callbacks and QuickJS promise jobs. */
  drainJobs(maxJobs?: number): number
  /** Read the current form controls without serializing disabled controls. */
  readFormFields(): Record<string, string>
  close(): void
}

const URL_SETUP = String.raw`
(() => {
  class URLSearchParams {
    constructor(value = '') {
      this._pairs = []
      if (value instanceof URLSearchParams) this._pairs = value._pairs.map((pair) => [...pair])
      else if (typeof value === 'object' && value !== null && value[Symbol.iterator]) {
        for (const pair of value) if (pair && pair.length >= 2) this.append(pair[0], pair[1])
      } else {
        const text = String(value).replace(/^\?/, '')
        for (const pair of text.split('&')) {
          if (!pair) continue
          const index = pair.indexOf('=')
          const key = index < 0 ? pair : pair.slice(0, index)
          const val = index < 0 ? '' : pair.slice(index + 1)
          this.append(decodeURIComponent(key.replace(/\+/g, ' ')), decodeURIComponent(val.replace(/\+/g, ' ')))
        }
      }
    }
    append(name, value) { this._pairs.push([String(name), String(value)]) }
    delete(name) { this._pairs = this._pairs.filter(([key]) => key !== String(name)) }
    get(name) { return this._pairs.find(([key]) => key === String(name))?.[1] ?? null }
    getAll(name) { return this._pairs.filter(([key]) => key === String(name)).map((pair) => pair[1]) }
    has(name) { return this._pairs.some(([key]) => key === String(name)) }
    set(name, value) { this.delete(name); this.append(name, value) }
    sort() { this._pairs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) }
    toString() { return this._pairs.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') }
    forEach(callback, thisArg) { for (const [key, value] of this._pairs) callback.call(thisArg, value, key, this) }
    keys() { return this._pairs.map(([key]) => key)[Symbol.iterator]() }
    values() { return this._pairs.map(([, value]) => value)[Symbol.iterator]() }
    entries() { return this._pairs[Symbol.iterator]() }
    [Symbol.iterator]() { return this.entries() }
  }
  class URL {
    constructor(value, base) {
      const raw = String(value)
      let resolved = raw
      if (base !== undefined && !/^[a-z][a-z\d+.-]*:/i.test(raw)) {
        const parent = new URL(base)
        if (raw === '') resolved = parent.href
        else if (raw.startsWith('//')) resolved = parent.protocol + raw
        else if (raw.startsWith('/')) resolved = parent.origin + raw
        else resolved = parent.href.replace(/[^/]*([?#].*)?$/, '') + raw
      }
      const match = resolved.match(/^([a-z][a-z\d+.-]*:)?\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?(#.*)?$/i)
      if (!match) {
        this.href = resolved
        this.protocol = ''
        this.host = ''
        this.hostname = ''
        this.port = ''
        this.origin = 'null'
        this.pathname = resolved || '/'
        this.search = ''
        this.hash = ''
      } else {
        this.protocol = (match[1] || '').toLowerCase()
        this.host = match[2] || ''
        this.hostname = this.host.replace(/:\d+$/, '')
        this.port = this.host.slice(this.hostname.length).replace(/^:/, '')
        this.origin = this.protocol && this.host ? this.protocol + '//' + this.host : 'null'
        this.pathname = match[3] || '/'
        this.search = match[4] || ''
        this.hash = match[5] || ''
        this.href = this.origin === 'null' ? resolved : this.origin + this.pathname + this.search + this.hash
      }
      this.searchParams = new URLSearchParams(this.search)
    }
    toString() { return this.href }
    toJSON() { return this.href }
  }
  const TextEncoderImpl = typeof TextEncoder === 'undefined' ? class TextEncoder { encode(value) { const text = unescape(encodeURIComponent(String(value))); const bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); return bytes } } : TextEncoder
  const TextDecoderImpl = typeof TextDecoder === 'undefined' ? class TextDecoder { decode(value) { let text = ''; for (const byte of value || []) text += String.fromCharCode(byte); return decodeURIComponent(escape(text)) } } : TextDecoder
  globalThis.URLSearchParams = URLSearchParams
  globalThis.URL = URL
  if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoderImpl
  if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoderImpl
})()
`

const COMMON_SETUP = String.raw`
(() => {
  const shim = globalThis.__browserShim
  const pageURL = String(globalThis.__starbucksPageURL)
  const userAgent = String(globalThis.__starbucksUserAgent || '')
  const page = shim.createMiniWindow(pageURL)
  page.document.defaultView = page
  page.navigator.userAgent = userAgent
  page.navigator.userAgentData = { mobile: /Mobile/i.test(userAgent), platform: page.navigator.platform, brands: [], getHighEntropyValues: () => Promise.resolve({}) }
  page.navigator.vendor = 'Google Inc.'
  page.navigator.doNotTrack = null
  page.navigator.connection = { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false }
  page.navigator.mediaDevices = { enumerateDevices: () => Promise.resolve([]), getUserMedia: () => Promise.reject(new Error('getUserMedia is not available')) }
  page.navigator.permissions = { query: () => Promise.resolve({ state: 'prompt', onchange: null }) }
  page.navigator.storage = { estimate: () => Promise.resolve({ quota: 0, usage: 0 }) }
  page.navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 })
  page.process = { hrtime: { bigint: () => BigInt(Date.now()) * 1000000n } }
  page.crypto = {
    getRandomValues(array) { for (let i = 0; i < array.length; i++) array[i] = (Date.now() + i * 1103515245) & 255; return array },
    randomUUID() { return '00000000-0000-4000-8000-' + String(Date.now()).slice(-12).padStart(12, '0') },
    subtle: { digest() { return Promise.reject(new Error('crypto.subtle.digest requires a host bridge')) } },
  }
  page.screen = { width: 412, height: 915, availWidth: 412, availHeight: 915, colorDepth: 24, pixelDepth: 24, orientation: { type: 'portrait-primary', angle: 0 } }
  page.visualViewport = { width: 412, height: 915, scale: 1, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0 }
  page.scrollX = 0; page.scrollY = 0; page.pageXOffset = 0; page.pageYOffset = 0
  page.isSecureContext = /^https:$/i.test(page.location.protocol)
  page.chrome = { runtime: {} }
  page.URL = URL; page.URLSearchParams = URLSearchParams
  const storage = {
    _data: {},
    getItem(key) { return this._data[String(key)] ?? null },
    setItem(key, value) { this._data[String(key)] = String(value) },
    removeItem(key) { delete this._data[String(key)] },
    clear() { this._data = {} },
    key(index) { return Object.keys(this._data)[index] ?? null },
    get length() { return Object.keys(this._data).length },
  }
  page.localStorage = storage; page.sessionStorage = storage
  page.indexedDB = { open() { throw new Error('indexedDB requires a host bridge') } }
  page.CSS = { supports: () => false }
  page.getComputedStyle = (element) => ({ getPropertyValue: (name) => element?.style?.[name] ?? '', display: element?.style?.display ?? '' })
  page.matchMedia = (query) => ({ matches: false, media: String(query), onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } })
  page.requestAnimationFrame = (fn) => page.setTimeout(() => fn(page.performance.now()), 16)
  page.cancelAnimationFrame = page.clearTimeout
  page.open = () => { throw new Error('window.open requires a host bridge') }
  page.atob = (value) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
    let out = ''
    for (let i = 0; i < String(value).length;) { const a = alphabet.indexOf(value[i++]); const b = alphabet.indexOf(value[i++]); const c = alphabet.indexOf(value[i++]); const d = alphabet.indexOf(value[i++]); out += String.fromCharCode((a << 2) | (b >> 4)); if (c !== 64 && c >= 0) out += String.fromCharCode(((b & 15) << 4) | (c >> 2)); if (d !== 64 && d >= 0) out += String.fromCharCode(((c & 3) << 6) | d) }
    return out
  }
  page.btoa = (value) => { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='; let out = ''; for (let i = 0; i < value.length; i += 3) { const a = value.charCodeAt(i); const b = value.charCodeAt(i + 1); const c = value.charCodeAt(i + 2); const n = (a << 16) | ((b || 0) << 8) | (c || 0); out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (i + 1 < value.length ? alphabet[(n >> 6) & 63] : '=') + (i + 2 < value.length ? alphabet[n & 63] : '=') } return out }
  class Blob {
    constructor(parts = [], options = {}) { this.type = options.type || ''; this._text = parts.map((part) => typeof part === 'string' ? part : String(part)).join(''); this.size = this._text.length }
    text() { return Promise.resolve(this._text) }
    arrayBuffer() { const result = new ArrayBuffer(this._text.length); const bytes = new Uint8Array(result); for (let i = 0; i < bytes.length; i++) bytes[i] = this._text.charCodeAt(i) & 255; return Promise.resolve(result) }
  }
  const blobs = new Map(); let blobID = 0
  page.Blob = Blob
  page.URL.createObjectURL = (blob) => { const id = 'blob:starbucks-quickjs-' + (++blobID); blobs.set(id, blob); return id }
  page.URL.revokeObjectURL = (id) => blobs.delete(String(id))
  class Worker {
    constructor(url) { this.url = String(url); this.onmessage = null; this.onerror = null; this.onmessageerror = null; this._closed = false; if (!blobs.has(this.url)) throw new Error('Worker source is unavailable: ' + this.url) }
    postMessage() { if (this._closed) throw new Error('Worker has been terminated') }
    terminate() { this._closed = true }
    addEventListener(type, listener) { if (type === 'message') this.onmessage = listener }
    removeEventListener(type, listener) { if (type === 'message' && this.onmessage === listener) this.onmessage = null }
  }
  page.Worker = Worker
  page.WebAssembly = { Module() { throw new Error('WebAssembly requires a host bridge') }, Instance() { throw new Error('WebAssembly requires a host bridge') }, Memory() { throw new Error('WebAssembly requires a host bridge') }, Table() { throw new Error('WebAssembly requires a host bridge') }, compile() { return Promise.reject(new Error('WebAssembly requires a host bridge')) }, instantiate() { return Promise.reject(new Error('WebAssembly requires a host bridge')) } }
  class Headers {
    constructor(init) { this._map = new Map(); if (init instanceof Headers) init.forEach((v, k) => this.set(k, v)); else if (init) for (const [k, v] of Object.entries(init)) this.set(k, v) }
    append(k, v) { const key = String(k).toLowerCase(); this._map.set(key, this._map.has(key) ? this._map.get(key) + ', ' + String(v) : String(v)) }
    set(k, v) { this._map.set(String(k).toLowerCase(), String(v)) }
    get(k) { return this._map.get(String(k).toLowerCase()) ?? null }
    has(k) { return this._map.has(String(k).toLowerCase()) }
    delete(k) { this._map.delete(String(k).toLowerCase()) }
    forEach(callback, thisArg) { for (const [k, v] of this._map) callback.call(thisArg, v, k, this) }
    entries() { return this._map.entries() }
    [Symbol.iterator]() { return this.entries() }
  }
  class FormData { constructor() { this._pairs = [] } append(k, v) { this._pairs.push([String(k), v]) } set(k, v) { this.delete(k); this.append(k, v) } delete(k) { this._pairs = this._pairs.filter(([key]) => key !== String(k)) } get(k) { return this._pairs.find(([key]) => key === String(k))?.[1] ?? null } entries() { return this._pairs[Symbol.iterator]() } [Symbol.iterator]() { return this.entries() } }
  class Request { constructor(input, init = {}) { this.url = new URL(input, page.location.href).href; this.method = init.method || 'GET'; this.headers = new Headers(init.headers); this.body = init.body ?? null } }
  class Response { constructor(body = '', init = {}) { this.body = body; this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 300; this.headers = new Headers(init.headers); this.url = init.url || '' } text() { return Promise.resolve(String(this.body)) } json() { return this.text().then((value) => JSON.parse(value)) } arrayBuffer() { return new Blob([this.body]).arrayBuffer() } }
  page.Headers = Headers; page.FormData = FormData; page.Request = Request; page.Response = Response
  page.fetch = () => { throw new Error('fetch is not available in the QuickJS realm; provide a host browser bridge') }
  page.XMLHttpRequest = shim.MiniXMLHttpRequest
  page.DOMParser = shim.MiniDOMParser
  page.DocumentFragment = shim.MiniDocumentFragment
  page.MutationObserver = shim.MiniMutationObserver
  page.Event = shim.MiniEvent; page.CustomEvent = shim.MiniCustomEvent; page.EventTarget = shim.MiniEventTarget
  page.Node = shim.MiniNode; page.Element = shim.MiniElement; page.HTMLElement = shim.MiniElement; page.Document = shim.MiniDocument
  page.HTMLDocument = shim.MiniDocument; page.HTMLFormElement = shim.MiniHTMLFormElement; page.HTMLInputElement = shim.MiniElement; page.HTMLTextAreaElement = shim.MiniElement; page.HTMLSelectElement = shim.MiniElement; page.HTMLButtonElement = shim.MiniElement
  page.HTMLImageElement = shim.MiniHTMLImageElement; page.HTMLCanvasElement = shim.MiniHTMLCanvasElement; page.HTMLMediaElement = shim.MiniHTMLMediaElement; page.HTMLAudioElement = shim.MiniHTMLAudioElement; page.HTMLVideoElement = shim.MiniHTMLVideoElement; page.HTMLAnchorElement = shim.MiniHTMLAnchorElement; page.HTMLIFrameElement = shim.MiniHTMLIFrameElement; page.HTMLScriptElement = shim.MiniHTMLScriptElement
  page.CanvasRenderingContext2D = shim.MiniCanvasRenderingContext2D; page.WebGLRenderingContext = shim.MiniWebGLRenderingContext; page.WebGL2RenderingContext = shim.MiniWebGL2RenderingContext; page.OffscreenCanvas = shim.MiniOffscreenCanvas; page.ImageData = shim.MiniImageData; page.AudioContext = shim.MiniAudioContext; page.OfflineAudioContext = shim.MiniOfflineAudioContext; page.AudioBuffer = shim.MiniAudioBuffer
  page.Image = class Image extends shim.MiniHTMLImageElement { constructor() { super(page.document) } }
  page.Audio = class Audio extends shim.MiniHTMLAudioElement { constructor() { super(page.document) } }
  page.Option = class Option extends shim.MiniElement { constructor(text = '', value = '') { super(page.document, 'option'); this.textContent = String(text); this.value = String(value) } }
  page.HTMLCollection = Array; page.NodeList = Array; page.NamedNodeMap = Array; page.Window = shim.MiniWindow; page.Navigator = function Navigator() {}
  page.Function = Function
  page.Object = Object; page.Array = Array; page.String = String; page.Number = Number; page.Boolean = Boolean; page.RegExp = RegExp; page.Error = Error; page.TypeError = TypeError; page.ReferenceError = ReferenceError; page.RangeError = RangeError; page.Date = Date; page.Math = Math; page.JSON = JSON; page.Promise = Promise; page.Proxy = Proxy; page.Reflect = Reflect; page.ArrayBuffer = ArrayBuffer; page.Uint8Array = Uint8Array; page.Uint16Array = Uint16Array; page.Uint32Array = Uint32Array; page.Int8Array = Int8Array; page.Int16Array = Int16Array; page.Int32Array = Int32Array; page.Float32Array = Float32Array; page.Float64Array = Float64Array; page.BigInt = BigInt; page.Symbol = Symbol; page.parseInt = parseInt; page.parseFloat = parseFloat; page.isNaN = isNaN; page.isFinite = isFinite; page.encodeURIComponent = encodeURIComponent; page.decodeURIComponent = decodeURIComponent; page.encodeURI = encodeURI; page.decodeURI = decodeURI
  page.TextEncoder = TextEncoder; page.TextDecoder = TextDecoder
  page.performance.measureUserAgentSpecificMemory = () => Promise.reject(new Error('performance memory API unavailable'))
  page.getComputedStyle = page.getComputedStyle.bind(page); page.addEventListener = page.addEventListener.bind(page); page.removeEventListener = page.removeEventListener.bind(page); page.dispatchEvent = page.dispatchEvent.bind(page)
  globalThis.__starbucksPage = page
  // QuickJS owns the actual global object. Expose it as window so vendor
  // probes that check window === globalThis see the browser identity. DOM
  // event methods remain bound to the MiniWindow instance, which owns the
  // private EventTarget listener state.
  globalThis.window = globalThis; globalThis.self = globalThis; globalThis.global = globalThis; globalThis.top = globalThis; globalThis.parent = globalThis
  globalThis.document = page.document; globalThis.navigator = page.navigator; globalThis.location = page.location; globalThis.Event = page.Event; globalThis.CustomEvent = page.CustomEvent; globalThis.EventTarget = page.EventTarget; globalThis.Node = page.Node; globalThis.Element = page.Element; globalThis.HTMLElement = page.HTMLElement; globalThis.Document = page.Document; globalThis.HTMLDocument = page.HTMLDocument
  for (const name of ['screen','performance','crypto','localStorage','sessionStorage','indexedDB','CSS','chrome','visualViewport','innerWidth','innerHeight','outerWidth','outerHeight','devicePixelRatio','isSecureContext','process','URL','URLSearchParams','Blob','Worker','WebAssembly','Headers','FormData','Request','Response','XMLHttpRequest','DOMParser','DocumentFragment','MutationObserver','Image','Audio','Option','CanvasRenderingContext2D','WebGLRenderingContext','WebGL2RenderingContext','OffscreenCanvas','ImageData','AudioContext','OfflineAudioContext','AudioBuffer','HTMLFormElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLImageElement','HTMLCanvasElement','HTMLMediaElement','HTMLAudioElement','HTMLVideoElement','HTMLAnchorElement','HTMLIFrameElement','HTMLScriptElement','Function','Object','Array','String','Number','Boolean','RegExp','Error','TypeError','ReferenceError','RangeError','Date','Math','JSON','Promise','Proxy','Reflect','ArrayBuffer','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array','BigInt','Symbol','TextEncoder','TextDecoder','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI']) if (name in page) globalThis[name] = page[name]
  globalThis.addEventListener = page.addEventListener; globalThis.removeEventListener = page.removeEventListener; globalThis.dispatchEvent = page.dispatchEvent
  globalThis.URL = URL; globalThis.URLSearchParams = URLSearchParams; globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder
  globalThis.XMLHttpRequest = page.XMLHttpRequest; globalThis.Blob = Blob; globalThis.Worker = Worker; globalThis.WebAssembly = page.WebAssembly; globalThis.fetch = page.fetch; globalThis.Headers = Headers; globalThis.FormData = FormData; globalThis.Request = Request; globalThis.Response = Response; globalThis.DOMParser = page.DOMParser; globalThis.MutationObserver = page.MutationObserver; globalThis.Image = page.Image; globalThis.Audio = page.Audio; globalThis.Option = page.Option; globalThis.CSS = page.CSS; globalThis.getComputedStyle = page.getComputedStyle; globalThis.matchMedia = page.matchMedia; globalThis.requestAnimationFrame = page.requestAnimationFrame; globalThis.cancelAnimationFrame = page.cancelAnimationFrame; globalThis.visualViewport = page.visualViewport; globalThis.screen = page.screen; globalThis.crypto = page.crypto; globalThis.localStorage = storage; globalThis.sessionStorage = storage; globalThis.indexedDB = page.indexedDB; globalThis.process = page.process
  if (globalThis.__starbucksHtml) { page.document.write(String(globalThis.__starbucksHtml)); page.document.readyState = 'loading'; page.document.close(); page.document.currentScript = page.document.querySelectorAll('script').filter((element) => element.textContent.length > 100000).sort((a, b) => b.textContent.length - a.textContent.length)[0] || null }
  else {
    const form = page.document.createElement('form'); page.document.body.appendChild(form)
    for (const [name, type] of [['username', 'text'], ['password', 'password'], ['remember-me', 'checkbox'], ['ms2_devicefingerprint', 'hidden']] ) { const input = page.document.createElement('input'); input.name = name; input.type = type; form.appendChild(input) }
  }
  return page
})()
`

const errorMessage = (context: QuickJSContext, error: QuickJSHandle) => {
  const dumped = context.dump(error) as { message?: unknown } | unknown
  return String(
    typeof dumped === 'object' && dumped && 'message' in dumped ? dumped.message : dumped,
  )
}

export const createStarbucksQuickJsBrowserRuntime = async (
  options: StarbucksQuickJsBrowserOptions,
): Promise<StarbucksQuickJsBrowserRuntime> => {
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  const context = runtime.newContext()
  let closed = false
  const userAgent = options.userAgent ?? STARBUCKS_DEFAULT_USER_AGENT
  const timerHandles = new Map<number, { fn: QuickJSHandle; interval: boolean }>()
  const queue: number[] = []
  let timerID = 0

  const evalSetup = (source: string, filename: string) => {
    const result = context.evalCode(source, filename)
    if (result.error) {
      const message = errorMessage(context, result.error)
      result.error.dispose()
      throw new Error(message)
    }
    result.value.dispose()
  }
  const setGlobalString = (name: string, value: string) => {
    const handle = context.newString(value)
    context.setProp(context.global, name, handle)
    handle.dispose()
  }

  try {
    setGlobalString('__starbucksPageURL', new URL(options.pageURL).href)
    setGlobalString('__starbucksUserAgent', userAgent)
    if (options.html !== undefined) setGlobalString('__starbucksHtml', options.html)
    evalSetup(URL_SETUP, 'starbucks-quickjs-url.js')
    evalSetup(STARBUCKS_BROWSER_SHIM_SOURCE, 'starbucks-browser-shim.js')

    const setTimeoutHost = context.newFunction('__starbucksSetTimeout', (fn, _delay) => {
      if (!fn || (typeof fn !== 'object' && typeof fn !== 'function'))
        throw new TypeError('setTimeout callback must be callable')
      const id = ++timerID
      timerHandles.set(id, { fn: fn.dup(), interval: false })
      queue.push(id)
      return context.newNumber(id)
    })
    const setIntervalHost = context.newFunction('__starbucksSetInterval', (fn, _delay) => {
      if (!fn || (typeof fn !== 'object' && typeof fn !== 'function'))
        throw new TypeError('setInterval callback must be callable')
      const id = ++timerID
      timerHandles.set(id, { fn: fn.dup(), interval: true })
      queue.push(id)
      return context.newNumber(id)
    })
    const clearTimerHost = context.newFunction('__starbucksClearTimer', (id) => {
      const timer = timerHandles.get(Number(id))
      if (!timer) return
      timer.fn.dispose()
      timerHandles.delete(Number(id))
    })
    evalSetup(COMMON_SETUP, 'starbucks-quickjs-browser-setup.js')
    context.setProp(context.global, '__hostSetTimeout', setTimeoutHost)
    context.setProp(context.global, '__hostSetInterval', setIntervalHost)
    context.setProp(context.global, '__hostClearTimer', clearTimerHost)
    setTimeoutHost.dispose()
    setIntervalHost.dispose()
    clearTimerHost.dispose()
    evalSetup(
      `(() => { const page = globalThis.__starbucksPage; page.setTimeout = __hostSetTimeout; page.setInterval = __hostSetInterval; page.clearTimeout = __hostClearTimer; page.clearInterval = __hostClearTimer; page.queueMicrotask = (fn) => Promise.resolve().then(fn); globalThis.setTimeout = __hostSetTimeout; globalThis.setInterval = __hostSetInterval; globalThis.clearTimeout = __hostClearTimer; globalThis.clearInterval = __hostClearTimer; globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn) })()`,
      'starbucks-quickjs-timers.js',
    )
    if (options.html && options.fetch) {
      const inlineScripts = [
        ...options.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi),
      ].map((match) => match[1] ?? '')
      const ioLoader = inlineScripts.find((script) =>
        /io_global_object_name\s*=|static_wdp\.js/.test(script),
      )
      if (ioLoader) {
        const alias = ioLoader.match(/"version"\s*:\s*"([^"]+)"/)?.[1]
        if (!alias) throw new Error('iOvation loader did not expose its script alias')
        const pageURL = new URL(options.pageURL)
        const request = async (url: URL, operation: string) => {
          const response = await options.fetch!(url, {
            method: 'GET',
            headers: { 'user-agent': userAgent },
            redirect: 'error',
          })
          if (!response.ok) throw new Error(`${operation} failed: HTTP ${response.status}`)
          return response.text()
        }
        const staticURL = new URL(`/iojs/${alias}/static_wdp.js`, pageURL)
        const staticSource = await request(staticURL, 'iOvation static WDP')
        const staticVersion = staticSource.match(
          /(?:staticVer|staticVer\s*)\s*=\s*["']([^"']+)["']/,
        )?.[1]
        if (!staticVersion) throw new Error('iOvation static WDP did not expose staticVer')
        const dynamicURL = new URL(`/iojs/${staticVersion}/dyn_wdp.js`, pageURL)
        const dynamicSource = await request(dynamicURL, 'iOvation dynamic WDP')
        evalSetup(ioLoader, 'starbucks-iovation-loader.js')
        const appendLoadedScript = (url: URL, filename: string) =>
          evalSetup(
            `(() => { const script = document.createElement('script'); script.src = ${JSON.stringify(url.href)}; document.head.appendChild(script) })()`,
            filename,
          )
        appendLoadedScript(staticURL, 'starbucks-iovation-static-tag.js')
        appendLoadedScript(dynamicURL, 'starbucks-iovation-dynamic-tag.js')
        evalSetup(staticSource, 'starbucks-iovation-static.js')
        evalSetup(dynamicSource, 'starbucks-iovation-dynamic.js')
        // The page's static WDP references the remote IO collector through an
        // encoded origin. It is loaded as a separate script in Chrome and is
        // what lets the FP collector combine its value with the IO value.
        const remoteOrigin = [
          ...staticSource.matchAll(/\b(?:[A-Za-z_$][\w$]*\.)?decode\(\s*["']([^"']+)["']\s*\)/g),
        ]
          .map((match) => {
            try {
              return new URL(Buffer.from(match[1] ?? '', 'base64').toString())
            } catch {
              return undefined
            }
          })
          .find((url) => url?.protocol && url.pathname === '/')
        if (remoteOrigin) {
          const remoteURL = new URL(`/${alias}/wdp.js`, remoteOrigin)
          const remoteSource = await request(remoteURL, 'iOvation remote WDP')
          appendLoadedScript(remoteURL, 'starbucks-iovation-remote-tag.js')
          evalSetup(remoteSource, 'starbucks-iovation-remote-wdp.js')
          const remoteLogoEncoded = remoteSource.match(
            /ctokenScriptPath\s*=\s*d\(\s*["']([^"']+)["']\s*\)/,
          )?.[1]
          if (remoteLogoEncoded) {
            const remoteLogoPath = Buffer.from(remoteLogoEncoded, 'base64').toString()
            const remoteLogoSource = await request(
              new URL(remoteLogoPath, remoteOrigin),
              'iOvation remote logo',
            )
            evalSetup(remoteLogoSource, 'starbucks-iovation-remote-logo.js')
            const remoteVersionedLogoSource = await request(
              new URL(`/${staticVersion}/logo.js`, remoteOrigin),
              'iOvation remote versioned logo',
            )
            evalSetup(remoteVersionedLogoSource, 'starbucks-iovation-remote-versioned-logo.js')
          }
        }
        // The static collector inserts logo.js dynamically after the dynamic
        // registration callback. The QuickJS DOM deliberately does not fetch
        // arbitrary <script src> elements, so load the two URLs that the
        // browser requests explicitly and evaluate them in the same realm.
        const encodedLogoPath = dynamicSource.match(
          /ctokenScriptPath\s*=\s*d\(\s*["']([^"']+)["']\s*\)/,
        )?.[1]
        if (!encodedLogoPath) throw new Error('iOvation dynamic WDP did not expose the logo path')
        const logoPath = Buffer.from(encodedLogoPath, 'base64').toString()
        const logoSource = await request(new URL(logoPath, pageURL), 'iOvation logo')
        evalSetup(logoSource, 'starbucks-iovation-logo.js')
        const versionedLogoSource = await request(
          new URL(`/iojs/${staticVersion}/logo.js`, pageURL),
          'iOvation versioned logo',
        )
        evalSetup(versionedLogoSource, 'starbucks-iovation-versioned-logo.js')
      }
    }
  } catch (error) {
    throw error
  }

  const assertOpen = () => {
    if (closed) throw new Error('QuickJS browser runtime is closed')
  }
  const runOneTimer = () => {
    const id = queue.shift()
    if (id === undefined) return false
    const timer = timerHandles.get(id)
    if (!timer) return true
    const result = context.callFunction(timer.fn, context.undefined)
    if (result.error) {
      const message = errorMessage(context, result.error)
      result.error.dispose()
      if (!timer.interval) {
        timer.fn.dispose()
        timerHandles.delete(id)
      }
      throw new Error(message)
    }
    result.value.dispose()
    if (timer.interval) queue.push(id)
    else {
      timer.fn.dispose()
      timerHandles.delete(id)
    }
    return true
  }

  return {
    evaluate(source, filename = 'starbucks-quickjs-source.js') {
      assertOpen()
      // currentScript is only observable while the parser is evaluating a
      // script. Delayed callbacks see null, just like a browser.
      evalSetup(
        `document.currentScript = document.querySelectorAll('script').filter((element) => element.textContent.length > 100000).sort((a, b) => b.textContent.length - a.textContent.length)[0] || null`,
        'starbucks-quickjs-current-script.js',
      )
      const result = context.evalCode(source, filename)
      evalSetup('document.currentScript = null', 'starbucks-quickjs-clear-script.js')
      if (result.error) {
        const message = errorMessage(context, result.error)
        result.error.dispose()
        throw new Error(message)
      }
      const resultType = context.typeof(result.value)
      if (resultType === 'object') {
        const then = context.getProp(result.value, 'then')
        const isPromise = context.typeof(then) === 'function'
        then.dispose()
        if (isPromise) {
          result.value.dispose()
          return undefined
        }
      }
      const value = context.dump(result.value)
      result.value.dispose()
      return value
    },
    drainJobs(maxJobs = 1000) {
      assertOpen()
      let count = 0
      for (; count < maxJobs; count++) {
        const hadTimer = runOneTimer()
        const result = runtime.executePendingJobs()
        if (result.error) {
          const message = errorMessage(context, result.error)
          result.error.dispose()
          throw new Error(message)
        }
        const pending = result.value
        result.dispose()
        if (!hadTimer && pending <= 0 && queue.length === 0) break
      }
      return count
    },
    readFormFields() {
      assertOpen()
      const result = context.evalCode(
        `Object.fromEntries([...document.querySelectorAll('input,select,textarea')].filter((input) => input.name && !input.disabled && !(['checkbox','radio'].includes(input.type) && !input.checked)).map((input) => [input.name, String(input.value ?? '')]))`,
        'starbucks-quickjs-read-fields.js',
      )
      if (result.error) {
        const message = errorMessage(context, result.error)
        result.error.dispose()
        throw new Error(message)
      }
      const value = context.dump(result.value) as Record<string, string>
      result.value.dispose()
      return value
    },
    close() {
      if (closed) return
      closed = true
      for (const timer of timerHandles.values()) timer.fn.dispose()
      timerHandles.clear()
      queue.length = 0
      context.dispose()
      runtime.dispose()
    },
  }
}

export type { QuickJSContext, QuickJSRuntime }
