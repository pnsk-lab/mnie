/**
 * TypeScript-only pieces of the KXZ wire protocol.
 *
 * The rotating WASM bundle is deliberately not interpreted here.  The seed
 * and the six request fields are ordinary URL/header data and can be handled
 * without evaluating vendor JavaScript.  Keeping this boundary explicit makes
 * it impossible for a caller to accidentally send a partial KXZ envelope.
 */

export const STARBUCKS_KXZ_SUFFIXES = ['a', 'b', 'c', 'd', 'f', 'z'] as const
export type StarbucksKxzSuffix = (typeof STARBUCKS_KXZ_SUFFIXES)[number]
export type StarbucksKxzHeaderValues = Readonly<Record<StarbucksKxzSuffix, string>>

export interface StarbucksKxzSeedParameters {
  url: string
  seed: string
  z: string
}

/**
 * The browser instrumentation does not decide whether a request is guarded
 * from the URL alone.  It applies a caller-supplied allow-list (the rotating
 * bundle carries the actual production entries).  Keep this contract
 * parameterised so the SDK never embeds a real service endpoint.
 */
export interface StarbucksKxzMatcherConfig {
  origins: readonly string[]
  paths: readonly string[]
  methods?: readonly string[]
}

export interface StarbucksKxzChunkConfig {
  headerNamePrefix: string
  headerChunkSize: number
}

/**
 * The instrumentation bundle exposes a small callback bus for every wrapped
 * browser primitive.  The latest non-null callback result wins; callback
 * failures are intentionally isolated just like the browser bundle.
 */
export interface StarbucksKxzHookBus<T = unknown> {
  readonly __callbacks: readonly ((value: T, previous: unknown) => unknown)[]
  register(callback: (value: T, previous: unknown) => unknown): void
  unregister(callback: (value: T, previous: unknown) => unknown): void
  notify(value: T): unknown
  __merge(other: StarbucksKxzHookBus<T> | null | undefined): void
}

export interface StarbucksKxzInvocation {
  args: readonly unknown[]
  thisObj: unknown
}

export interface StarbucksKxzInvocationHook {
  onBeforeInvoke: StarbucksKxzHookBus<StarbucksKxzInvocation>
  onAfterInvoke: StarbucksKxzHookBus<StarbucksKxzInvocation & { threw: boolean; result: unknown }>
  originals: { value: unknown }
}

export interface StarbucksKxzAccessorHook {
  onBeforeGet?: StarbucksKxzHookBus<{ thisObj: unknown }>
  onAfterGet?: StarbucksKxzHookBus<{ thisObj: unknown; threw: boolean; result: unknown }>
  onBeforeSet?: StarbucksKxzHookBus<{ thisObj: unknown; param: unknown }>
  onAfterSet?: StarbucksKxzHookBus<{
    thisObj: unknown
    param: unknown
    threw: boolean
    result: unknown
  }>
  originals: { get?: unknown; set?: unknown }
}

export interface StarbucksKxzInstrumented {
  CustomEvent: StarbucksKxzInvocationHook | null
  cancelBubble: StarbucksKxzAccessorHook | null
  fetch: StarbucksKxzInvocationHook | null
  formSubmit: StarbucksKxzInvocationHook | null
  functionBind: StarbucksKxzInvocationHook | null
  preventDefault: StarbucksKxzInvocationHook | null
  stopImmediatePropagation: StarbucksKxzInvocationHook | null
  stopPropagation: StarbucksKxzInvocationHook | null
  timeout: StarbucksKxzAccessorHook | null
  xhrAbort: StarbucksKxzInvocationHook | null
  xhrOpen: StarbucksKxzInvocationHook | null
  xhrSend: StarbucksKxzInvocationHook | null
}

const createStarbucksKxzHookBus = <T>(): StarbucksKxzHookBus<T> => {
  const callbacks: ((value: T, previous: unknown) => unknown)[] = []
  return {
    get __callbacks() {
      return callbacks
    },
    register(callback) {
      callbacks.push(callback)
    },
    unregister(callback) {
      const index = callbacks.indexOf(callback)
      if (index >= 0) callbacks[index] = null as never
    },
    notify(value) {
      let result: unknown
      for (const callback of callbacks.slice().reverse()) {
        if (!callback) continue
        try {
          const candidate = callback(value, result)
          if (candidate != null) result = candidate
        } catch {
          // A single instrumentation hook must not prevent the remaining bus.
        }
      }
      return result
    },
    __merge(other) {
      if (other) callbacks.push(...other.__callbacks)
    },
  }
}

const lookupPropertyDescriptor = (
  object: object,
  property: string,
): PropertyDescriptor | undefined => {
  for (let current: object | null = object; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor) return descriptor
  }
  return undefined
}

/**
 * Builds the static `instrumented` payload consumed by the KXZ exchange
 * function.  It only inspects descriptors and stores originals; it does not
 * patch or execute any vendor code.
 */
export const createStarbucksKxzInstrumented = (
  browser: Record<string, unknown>,
): StarbucksKxzInstrumented => {
  const wrap = (value: unknown): StarbucksKxzInvocationHook | null =>
    typeof value === 'function'
      ? {
          onBeforeInvoke: createStarbucksKxzHookBus(),
          onAfterInvoke: createStarbucksKxzHookBus(),
          originals: { value },
        }
      : null
  const accessor = (object: unknown, property: string): StarbucksKxzAccessorHook | null => {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) return null
    const descriptor = lookupPropertyDescriptor(object, property)
    if (!descriptor || (!descriptor.get && !descriptor.set)) return null
    const result: StarbucksKxzAccessorHook = { originals: {} }
    if (descriptor.get) {
      result.onBeforeGet = createStarbucksKxzHookBus()
      result.onAfterGet = createStarbucksKxzHookBus()
      result.originals.get = descriptor.get
    }
    if (descriptor.set) {
      result.onBeforeSet = createStarbucksKxzHookBus()
      result.onAfterSet = createStarbucksKxzHookBus()
      result.originals.set = descriptor.set
    }
    return result
  }
  const eventPrototype = browser.Event
  const xhrPrototype = browser.XMLHttpRequest
  const formPrototype = browser.HTMLFormElement
  const functionPrototype = browser.Function
  const event = eventPrototype && (eventPrototype as any).prototype
  const xhr = xhrPrototype && (xhrPrototype as any).prototype
  const form = formPrototype && (formPrototype as any).prototype
  const fn = functionPrototype && (functionPrototype as any).prototype
  return {
    CustomEvent: wrap(browser.CustomEvent),
    cancelBubble: accessor(event, 'cancelBubble'),
    fetch: wrap(browser.fetch),
    formSubmit: wrap(form?.submit),
    functionBind: wrap(fn?.bind),
    preventDefault: wrap(event?.preventDefault),
    stopImmediatePropagation: wrap(event?.stopImmediatePropagation),
    stopPropagation: wrap(event?.stopPropagation),
    timeout: accessor(xhr, 'timeout'),
    xhrAbort: wrap(xhr?.abort),
    xhrOpen: wrap(xhr?.open),
    xhrSend: wrap(xhr?.send),
  }
}

export interface StarbucksKxzRequestLike {
  url: string | URL
  method?: string
}

/**
 * Arguments passed by the rotating bootstrap to `event.detail.init(...)`.
 *
 * The bootstrap response is deliberately parsed as source text rather than
 * executed.  Only the literal subset used by the KXZ loader is accepted:
 * strings, numbers, booleans, null/undefined, arrays, and a guarded fallback
 * expression (`... || <literal>`).  The bootstrap's outer `a` argument is
 * represented as `undefined`; any other identifier/expression is rejected
 * instead of being evaluated.
 */
export const parseStarbucksKxzBootstrapInit = (source: string): readonly unknown[] => {
  const marker = '.init('
  let callStart = -1
  let searchFrom = 0
  while (true) {
    const index = source.indexOf(marker, searchFrom)
    if (index < 0) break
    const before = source.slice(Math.max(0, index - 32), index)
    if (/\bdetail\s*$/.test(before)) {
      callStart = index + marker.length
      break
    }
    searchFrom = index + marker.length
  }
  if (callStart < 0) throw new Error('KXZ bootstrap did not expose detail.init(...)')

  const splitTopLevel = (value: string, separator: string) => {
    const parts: string[] = []
    let start = 0
    let depth = 0
    let quote: string | undefined
    let escaped = false
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '[' || character === '(' || character === '{') depth++
      else if (character === ']' || character === ')' || character === '}') depth--
      else if (depth === 0 && value.startsWith(separator, index)) {
        parts.push(value.slice(start, index))
        start = index + separator.length
        index += separator.length - 1
      }
    }
    parts.push(value.slice(start))
    return parts
  }

  const close = (() => {
    let depth = 0
    let quote: string | undefined
    let escaped = false
    for (let index = callStart; index < source.length; index++) {
      const character = source[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '(' || character === '[' || character === '{') depth++
      else if (character === ')' || character === ']' || character === '}') {
        if (character === ')' && depth === 0) return index
        depth--
      }
    }
    return -1
  })()
  if (close < 0) throw new Error('KXZ bootstrap detail.init(...) is unterminated')

  const unquote = (value: string) => {
    const quote = value[0]
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote)
      throw new Error('KXZ bootstrap contains an invalid string literal')
    let result = ''
    let escaped = false
    for (let index = 1; index < value.length - 1; index++) {
      const character = value[index]!
      if (!escaped) {
        if (character === '\\') escaped = true
        else result += character
        continue
      }
      escaped = false
      if (character === 'n') result += '\n'
      else if (character === 'r') result += '\r'
      else if (character === 't') result += '\t'
      else if (character === 'b') result += '\b'
      else if (character === 'f') result += '\f'
      else if (character === 'v') result += '\v'
      else if (character === '0') result += '\0'
      else if (character === 'x') {
        const hex = value.slice(index + 1, index + 3)
        if (!/^[0-9a-f]{2}$/i.test(hex))
          throw new Error('KXZ bootstrap contains an invalid hex escape')
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 2
      } else if (character === 'u') {
        const hex = value.slice(index + 1, index + 5)
        if (!/^[0-9a-f]{4}$/i.test(hex))
          throw new Error('KXZ bootstrap contains an invalid unicode escape')
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
      } else result += character
    }
    return result
  }

  const parseLiteral = (raw: string): unknown => {
    const value = raw.trim()
    if (!value) throw new Error('KXZ bootstrap contains an empty init argument')
    const alternatives = splitTopLevel(value, '||').map((part) => part.trim())
    if (alternatives.length > 1) return parseLiteral(alternatives.at(-1)!)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      return unquote(value)
    if (value === 'null') return null
    if (value === 'undefined' || value === 'void 0') return undefined
    if (value === 'true') return true
    if (value === 'false') return false
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value)
    if (value.startsWith('[') && value.endsWith(']')) {
      const content = value.slice(1, -1).trim()
      if (!content) return []
      return splitTopLevel(content, ',').map(parseLiteral)
    }
    if (value === 'a') return undefined
    throw new Error(`KXZ bootstrap contains unsupported init expression: ${value.slice(0, 64)}`)
  }

  return splitTopLevel(source.slice(callStart, close), ',').map(parseLiteral)
}

export interface StarbucksLoginCompletionEventOptions {
  nonce?: string
  src?: string | null
}

/**
 * Parses the literal completion event appended to the login anti-bot bundle.
 * The event is intentionally parsed as data: evaluating the inline bundle is
 * not required to discover its type or its nine-element payload.
 */
export const parseStarbucksLoginCompletionEvent = (
  source: string,
  options: StarbucksLoginCompletionEventOptions = {},
): { type: string; detail: readonly unknown[] } => {
  const eventMatch = source.match(/\bvar\s+isk\s*=\s*\[\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*\]/)
  if (!eventMatch?.[2])
    throw new Error('login anti-bot source did not expose completion event type')
  const unquote = (value: string) => {
    let result = ''
    let escaped = false
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!
      if (!escaped) {
        if (character === '\\') escaped = true
        else result += character
        continue
      }
      escaped = false
      if (character === 'n') result += '\n'
      else if (character === 'r') result += '\r'
      else if (character === 't') result += '\t'
      else if (character === 'b') result += '\b'
      else if (character === 'f') result += '\f'
      else if (character === 'v') result += '\v'
      else if (character === 'x') {
        const hex = value.slice(index + 1, index + 3)
        if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error('invalid login completion hex escape')
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 2
      } else if (character === 'u') {
        const hex = value.slice(index + 1, index + 5)
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error('invalid login completion unicode escape')
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
      } else result += character
    }
    return result
  }
  const splitTopLevel = (value: string, separator: string) => {
    const parts: string[] = []
    let start = 0
    let depth = 0
    let quote: string | undefined
    let escaped = false
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") quote = character
      else if ('([{'.includes(character)) depth++
      else if (')]}'.includes(character)) depth--
      else if (depth === 0 && value.startsWith(separator, index)) {
        parts.push(value.slice(start, index))
        start = index + separator.length
        index += separator.length - 1
      }
    }
    parts.push(value.slice(start))
    return parts
  }
  const parseExpression = (raw: string): unknown => {
    const value = raw.trim()
    if (!value) throw new Error('login completion payload contains an empty value')
    if (/^typeof\s+arguments\s*===\s*["']undefined["']\s*\?/.test(value)) return undefined
    if (value.startsWith('document.currentScript')) {
      if (/\.src\b/.test(value)) return options.src ?? null
      const fallback = splitTopLevel(value, '||').at(-1)?.trim()
      if (fallback && fallback !== value) return options.nonce ?? parseExpression(fallback)
      return options.nonce
    }
    const alternatives = splitTopLevel(value, '||').map((part) => part.trim())
    if (alternatives.length > 1) return parseExpression(alternatives.at(-1)!)
    if (value === 'null') return null
    if (value === 'undefined' || value === 'void 0') return undefined
    if (value === 'true') return true
    if (value === 'false') return false
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      return unquote(value.slice(1, -1))
    if (value.startsWith('[') && value.endsWith(']')) {
      const content = value.slice(1, -1).trim()
      return content ? splitTopLevel(content, ',').map(parseExpression) : []
    }
    throw new Error(`unsupported login completion expression: ${value.slice(0, 80)}`)
  }

  const suffixStart = source.lastIndexOf('}(document.createEvent')
  if (suffixStart < 0) throw new Error('login anti-bot source did not expose completion payload')
  const payloadStart = source.indexOf('[', suffixStart)
  if (payloadStart < 0) throw new Error('login completion payload is missing')
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let payloadEnd = -1
  for (let index = payloadStart; index < source.length; index++) {
    const character = source[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '[') depth++
    else if (character === ']' && --depth === 0) {
      payloadEnd = index
      break
    }
  }
  if (payloadEnd < 0) throw new Error('login completion payload is unterminated')
  const detail = parseExpression(source.slice(payloadStart, payloadEnd + 1))
  if (!Array.isArray(detail)) throw new Error('login completion payload is not an array')
  return { type: unquote(eventMatch[2]), detail }
}

export interface StarbucksLoginBootstrapEvent {
  type: string
  detail: readonly unknown[]
}

/**
 * Extracts the literal CustomEvent bridge emitted by the captured login
 * inline bundle.  The snippet is intentionally parsed, never executed; the
 * browser-only `document.currentScript` and `arguments` expressions are
 * represented by their literal fallback values.
 */
export const parseStarbucksLoginBootstrapEvent = (source: string): StarbucksLoginBootstrapEvent => {
  const type = source.match(/var\s+isk\s*=\s*\[\s*(["'])([^"']+)\1\s*\]/)?.[2]
  if (!type) throw new Error('login bootstrap did not expose its CustomEvent type')
  const marker = '}(document.createEvent("CustomEvent"),'
  const start = source.lastIndexOf(marker)
  if (start < 0) throw new Error('login bootstrap did not expose its event payload')
  const open = source.indexOf('[', start + marker.length)
  if (open < 0) throw new Error('login bootstrap event payload is missing')

  const splitTopLevel = (value: string, separator: string) => {
    const parts: string[] = []
    let start = 0
    let depth = 0
    let quote: string | undefined
    let escaped = false
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") quote = character
      else if (character === '[' || character === '(' || character === '{') depth++
      else if (character === ']' || character === ')' || character === '}') depth--
      else if (depth === 0 && value.startsWith(separator, index)) {
        parts.push(value.slice(start, index))
        start = index + separator.length
        index += separator.length - 1
      }
    }
    parts.push(value.slice(start))
    return parts
  }

  const close = (() => {
    let depth = 0
    let quote: string | undefined
    let escaped = false
    for (let index = open; index < source.length; index++) {
      const character = source[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") quote = character
      else if (character === '[' || character === '(' || character === '{') depth++
      else if (character === ']' || character === ')' || character === '}') {
        if (character === ']' && depth === 1) return index
        depth--
      }
    }
    return -1
  })()
  if (close < 0) throw new Error('login bootstrap event payload is unterminated')

  const parseString = (value: string) => {
    const quote = value[0]
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote)
      throw new Error('login bootstrap contains an invalid string literal')
    let result = ''
    let escaped = false
    for (let index = 1; index < value.length - 1; index++) {
      const character = value[index]!
      if (!escaped) {
        if (character === '\\') escaped = true
        else result += character
        continue
      }
      escaped = false
      if (character === 'n') result += '\n'
      else if (character === 'r') result += '\r'
      else if (character === 't') result += '\t'
      else if (character === 'x' || character === 'u') {
        const width = character === 'x' ? 2 : 4
        const hex = value.slice(index + 1, index + 1 + width)
        if (!new RegExp(`^[0-9a-f]{${width}}$`, 'i').test(hex))
          throw new Error('login bootstrap contains an invalid escape')
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += width
      } else result += character
    }
    return result
  }

  const parseLiteral = (raw: string): unknown => {
    const value = raw.trim()
    if (/^typeof\s+arguments\s*===/.test(value)) return undefined
    if (/^\(document\.currentScript\s*\|\|\{\}\)/.test(value) && /\.src\s*\|\|\s*null$/.test(value))
      return null
    const alternatives = splitTopLevel(value, '||').map((part) => part.trim())
    if (alternatives.length > 1) return parseLiteral(alternatives.at(-1)!)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      return parseString(value)
    if (value === 'void 0' || value === 'undefined') return undefined
    if (value === 'null') return null
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value)
    if (value.startsWith('[') && value.endsWith(']')) {
      const content = value.slice(1, -1).trim()
      return content ? splitTopLevel(content, ',').map(parseLiteral) : []
    }
    throw new Error(`login bootstrap contains unsupported event expression: ${value.slice(0, 64)}`)
  }

  return { type, detail: splitTopLevel(source.slice(open + 1, close), ',').map(parseLiteral) }
}

const prefix = 'KXZ2x4Fzkp-'

/** Returns true when a request satisfies the supplied KXZ matcher contract. */
export const matchesStarbucksKxzRequest = (
  request: StarbucksKxzRequestLike,
  config: StarbucksKxzMatcherConfig,
) => {
  const url = new URL(request.url)
  const method = (request.method ?? 'GET').toUpperCase()
  const methods = config.methods ?? ['POST']
  return (
    methods.some(
      (candidate) => candidate.toUpperCase() === 'ANY' || candidate.toUpperCase() === method,
    ) &&
    config.origins.some((origin) => new URL(origin).origin === url.origin) &&
    config.paths.includes(url.pathname)
  )
}

/**
 * Splits one encoded value at the browser header limit.  The caller owns the
 * wire names; this function deliberately only handles bytes/characters and
 * throws for invalid configuration instead of silently truncating data.
 */
export const splitStarbucksKxzHeaderValue = (value: string, chunkSize: number) => {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
    throw new Error('KXZ headerChunkSize must be a positive safe integer')
  const chunks: string[] = []
  for (let offset = 0; offset < value.length; offset += chunkSize)
    chunks.push(value.slice(offset, offset + chunkSize))
  return chunks.length ? chunks : ['']
}

/**
 * Applies the name/value chunking exposed by the KXZ event contract. The
 * first chunk keeps the base header name; subsequent chunks append a decimal
 * index directly (`name0`, `name1`, …), matching the captured browser code.
 */
export const chunkStarbucksKxzHeader = (
  name: string,
  value: string,
  config: StarbucksKxzChunkConfig,
) => {
  if (!name) throw new Error('KXZ header name must not be empty')
  const chunks = splitStarbucksKxzHeaderValue(value, config.headerChunkSize)
  if (chunks.length === 1) return { [name]: chunks[0]! }
  return Object.fromEntries(
    chunks.map((chunk, index) => [index === 0 ? name : `${name}${index - 1}`, chunk]),
  )
}

/** Extracts the rotating seed and z mode from the downloaded main-script URL. */
export const parseStarbucksKxzSeedURL = (value: string | URL): StarbucksKxzSeedParameters => {
  const url = new URL(value)
  const seed = url.searchParams.get('seed')
  const z = url.searchParams.get('KXZ2x4Fzkp--z')
  if (!seed) throw new Error('KXZ main URL did not contain a seed parameter')
  if (!z) throw new Error('KXZ main URL did not contain KXZ2x4Fzkp--z')
  return { url: url.href, seed, z }
}

/**
 * Converts captured lower-case header names into the exact names sent by the
 * Starbucks gateway.  A partial capture is an error: sending a made-up value
 * is not browser-compatible and is rejected by the service.
 */
export const createStarbucksKxzHeaders = (values: StarbucksKxzHeaderValues) => {
  const headers: Record<string, string> = {}
  for (const suffix of STARBUCKS_KXZ_SUFFIXES) {
    const value = values[suffix]
    if (typeof value !== 'string' || value.length === 0)
      throw new Error(`KXZ capture is missing header ${suffix}`)
    headers[`${prefix}${suffix}`] = value
  }
  return headers
}

/** Reads a Headers-like object and rejects duplicate or incomplete KXZ data. */
export const readStarbucksKxzHeaders = (
  input: Headers | Readonly<Record<string, string>>,
): StarbucksKxzHeaderValues => {
  const values = {} as Record<StarbucksKxzSuffix, string>
  const entries = input instanceof Headers ? [...input.entries()] : Object.entries(input)
  for (const [name, value] of entries) {
    const match = name.match(/^kxz2x4fzkp-([abcdfz])(\d*)$/i)
    if (!match) continue
    const suffix = match[1]?.toLowerCase() as StarbucksKxzSuffix
    const index = match[2] === '' ? -1 : Number(match[2])
    if (!Number.isSafeInteger(index) || (index < 0 && match[2] !== ''))
      throw new Error(`KXZ capture contains an invalid ${suffix} chunk index`)
    const chunks = (values as Record<string, unknown>)[`__chunks_${suffix}`] as
      | Map<number, string>
      | undefined
    const chunkMap = chunks ?? new Map<number, string>()
    ;(values as Record<string, unknown>)[`__chunks_${suffix}`] = chunkMap
    if (chunkMap.has(index) && chunkMap.get(index) !== value)
      throw new Error(`KXZ capture contains conflicting ${suffix} headers`)
    chunkMap.set(index, value)
  }
  for (const suffix of STARBUCKS_KXZ_SUFFIXES) {
    const chunkMap = (values as Record<string, unknown>)[`__chunks_${suffix}`] as
      | Map<number, string>
      | undefined
    if (!chunkMap || !chunkMap.has(-1)) throw new Error(`KXZ capture is missing header ${suffix}`)
    const indices = [...chunkMap.keys()].filter((index) => index >= 0).sort((a, b) => a - b)
    for (const [position, index] of indices.entries())
      if (index !== position) throw new Error(`KXZ capture contains a missing ${suffix} chunk`)
    values[suffix] = [...chunkMap.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, chunk]) => chunk)
      .join('')
    delete (values as Record<string, unknown>)[`__chunks_${suffix}`]
    if (!values[suffix]) throw new Error(`KXZ capture is missing header ${suffix}`)
  }
  return values
}
