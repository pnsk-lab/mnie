import { arch, cpus, platform } from 'node:os'

/**
 * The part of the iOvation static collector that is observable by the
 * Starbucks login flow.  The vendor script stores collected values as a
 * length-prefixed list, encrypts that list with single-DES (represented by
 * OpenSSL as two-key DES-EDE with the same key twice), and prefixes the
 * base64 result with `0400`.
 *
 * This module deliberately does not evaluate the vendor JavaScript.  The
 * script is still downloaded by the dynamic loader so that a version/config
 * change is detected, but the current collector protocol is implemented here
 * directly in TypeScript.
 */

/**
 * Field names emitted by the current general5 WDP collector.
 *
 * The values are intentionally kept as strings: the vendor protocol records
 * the UTF-8 representation of every value and prefixes it with a four-hex
 * byte length.  Keeping the names in one union prevents a browser signal from
 * silently being renamed when it is passed to the TypeScript collector.
 */
export const STARBUCKS_IO_BLACKBOX_FIELD_NAMES = [
  'CTOKEN',
  'BBSZ',
  'LSTOKEN',
  'SVRTIME',
  'JSTOKEN',
  'JSTIME',
  'INTLOC',
  'STVER',
  'LDVER',
  'BBNS',
  'TZON',
  'UAGT',
  'JRES',
  'JCLDPT',
  'JENBL',
  'JBRNM',
  'JBRVR',
  'JBROS',
  'JPLGNS',
  'JLANG',
  'JLANGS',
  'JBRCM',
  'NPLAT',
  'APVER',
  'OSCPU',
  'CCUR',
  'JREFRR',
  'BBOUT',
  'JSSRC',
  'WSTRIP',
  'WSERR',
  'LSERROR',
  'HACCLNG',
  'DID',
  'ALIAS',
  'REMAD',
  'HCCTRL',
  'HXCCLIP',
  'HXFWDFR',
  'HPRGMA',
  'FPREMAD',
  'FPHCCTRL',
  'FPHCLIP',
  'FPHXCCLIP',
  'FPHFWDED',
  'FPHXFWDFR',
  'FPHPRXCON',
  'FPHPRGMA',
  'FPHVIA',
  'JSVER',
  'SVRVR',
  'GLUV',
  'GLUR',
  'GLEL',
  'GLOPS',
  'CVGRAD',
  'CVFM',
  'AUD',
  'PBR',
  'PBRD',
  'PBRERR',
  'CHJMOB',
  'CHJARCH',
  'CHJPLAT',
  'CHJPLATV',
  'CHJMODEL',
  'CHJBIT',
  'CHJVRLIST',
  'CHJWOW64',
  'CHJERR',
  'JIFFY',
  'LID',
  'JINT',
  'PTYP',
  'TOUCH',
  'TDOWN',
  'MMOV',
  'CLICK',
  'MDOWN',
  'KEY',
  'KDOWN',
  'KBTWN',
  'TBTWN',
  'MBTWN',
  'AUDERR',
  'AXEL',
  'AXINT',
  'BAERR',
  'BAID',
  'BATL',
  'BAVER',
  'BADGER',
  'BTWN',
  'CHJUA',
  'CHUA',
  'CMPAS',
  'CTERR',
  'CVERR',
  'CVFERR',
  'DOWN',
  'EMSG',
  'FFONTS',
  'FLRTD',
  'FULOC',
  'GLERR',
  'JCOX',
  'JDIFF',
  'JTERR',
  'KDEL',
  'KREP',
  'LOST',
  'MIST',
  'MOVE',
  'MOV',
  'OFFLN',
  'ORPY',
  'ORTCC',
  'RTCERR',
  'POLLING',
  'RDDERR',
  'RDDT',
  'RTCH',
  'RTCSDP',
  'RTCT',
  'SUAGT',
  'TRACE',
] as const

export type StarbucksIoBlackboxFieldName = (typeof STARBUCKS_IO_BLACKBOX_FIELD_NAMES)[number]

/**
 * Browser and sensor values that cannot be inferred from a Node process.
 *
 * Tokens (CTOKEN/LSTOKEN/JSTOKEN), network-derived values, and canvas/WebGL /
 * audio results are session-specific.  They must be supplied by the caller or
 * by a browser capture; this collector never invents a substitute value.
 */
export type StarbucksIoBlackboxSignals = Readonly<
  Partial<Record<StarbucksIoBlackboxFieldName, string>>
>

/**
 * The small browser surface needed by the TypeScript sensor collectors.  A
 * real Window, the package's browser shim, and a test double can all satisfy
 * this shape.  No JavaScript from the vendor WDP is evaluated.
 */
export interface StarbucksIoBrowserEnvironment {
  Object?: { create?(prototype: object | null): object }
  String?: (value?: unknown) => string
  addEventListener?(type: string, listener: (event: any) => void, options?: unknown): void
  removeEventListener?(type: string, listener: (event: any) => void, options?: unknown): void
  document?: {
    createElement?(name: string): unknown
    URL?: string
    referrer?: string
    getElementsByTagName?(name: string): ArrayLike<unknown>
  }
  navigator?: BrowserNavigator
  screen?: {
    width?: number
    height?: number
    colorDepth?: number
  }
  OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => any
  webkitOfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => any
  performance?: {
    now?(): number
    memory?: { jsHeapSizeLimit?: number }
  }
  WebSocket?: unknown
  RTCPeerConnection?: unknown
  mozRTCPeerConnection?: unknown
  webkitRTCPeerConnection?: unknown
  RTCSctpTransport?: unknown
  RTCIceGatherer?: unknown
  PointerEvent?: unknown
  Window?: { TEMPORARY?: unknown }
  isSecureContext?: boolean
  localStorage?: {
    getItem?(name: string): string | null
    setItem?(name: string, value: string): void
    removeItem?(name: string): void
  }
  indexedDB?: unknown
  openDatabase?: (...args: unknown[]) => unknown
  webkitRequestFileSystem?: (...args: unknown[]) => unknown
  webkitTemporaryStorage?: {
    queryUsageAndQuota?(
      success: (used: number, quota: number) => void,
      failure: (error: unknown) => void,
    ): void
  }
}

const hashInput = (value: string) => String.fromCharCode(...new TextEncoder().encode(value))

const sha1 = (value: string) => {
  const input = hashInput(value)
  const bytes = new Uint8Array(input.length + 1)
  for (let index = 0; index < input.length; index++) bytes[index] = input.charCodeAt(index)
  bytes[input.length] = 0x80
  const blockLength = Math.ceil((bytes.length + 8) / 64) * 64
  const padded = new Uint8Array(blockLength)
  padded.set(bytes)
  const bitLength = input.length * 8
  const lengthOffset = padded.length - 4
  padded[lengthOffset] = (bitLength >>> 24) & 0xff
  padded[lengthOffset + 1] = (bitLength >>> 16) & 0xff
  padded[lengthOffset + 2] = (bitLength >>> 8) & 0xff
  padded[lengthOffset + 3] = bitLength & 0xff
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const rotate = (number: number, shift: number) => (number << shift) | (number >>> (32 - shift))
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(80)
    for (let index = 0; index < 16; index++) {
      const base = offset + index * 4
      words[index] =
        (padded[base]! << 24) |
        (padded[base + 1]! << 16) |
        (padded[base + 2]! << 8) |
        padded[base + 3]!
    }
    for (let index = 16; index < 80; index++)
      words[index] = rotate(
        words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!,
        1,
      )
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let index = 0; index < 80; index++) {
      const [functionValue, constant] =
        index < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : index < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : index < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const next = (rotate(a, 5) + functionValue + e + constant + words[index]!) | 0
      e = d
      d = c
      c = rotate(b, 30)
      b = a
      a = next
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

const truncateWithChecksum = (value: string, length: number) => {
  const truncated = value.slice(0, length)
  let checksum = 0
  for (const character of truncated) checksum += Number.parseInt(character, 16)
  return `${truncated}${Number.isNaN(checksum) ? '' : String(checksum).padStart(3, '0')}`
}

type IoInteractionEvent = {
  type?: unknown
  isTrusted?: unknown
  pointerType?: unknown
  button?: unknown
  keyCode?: unknown
  code?: unknown
  screenX?: unknown
  screenY?: unknown
  clientX?: unknown
  clientY?: unknown
  alpha?: unknown
  beta?: unknown
  gamma?: unknown
  webkitCompassHeading?: unknown
  webkitCompassAccuracy?: unknown
  interval?: unknown
  accelerationIncludingGravity?: { x?: unknown; y?: unknown; z?: unknown }
  touches?: { 0?: { clientX?: unknown; clientY?: unknown }; length?: number }
  changedTouches?: {
    item?(index: number): { identifier?: unknown } | null
    0?: { identifier?: unknown }
  }
}

type IoInteractionState = {
  Y?: string
  U?: number
  wa?: number
  isTrusted?: boolean
  T?: 'down' | 'up'
  ua?: string
  count: number
  samples: Map<string, number[]>
  between: number[]
  previous?: { time: number; id: string }
  durations: number[]
  repeats: number[]
  x: number[]
  y: number[]
  scrollIntervals: number[]
  previousScroll?: number
}

const numericEventValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const eventTouchIdentifier = (event: IoInteractionEvent) => {
  try {
    const touch = event.changedTouches?.item?.(0) ?? event.changedTouches?.[0]
    const identifier = touch?.identifier
    return identifier === undefined || identifier === null ? '' : String(identifier)
  } catch {
    return ''
  }
}

const eventCoordinate = (event: IoInteractionEvent, axis: 'x' | 'y') => {
  const direct = numericEventValue(event[axis === 'x' ? 'screenX' : 'screenY'])
  if (direct !== undefined) return direct
  const client = numericEventValue(event[axis === 'x' ? 'clientX' : 'clientY'])
  if (client !== undefined) return client
  const touch = event.touches?.[0]
  return numericEventValue(touch?.[axis === 'x' ? 'clientX' : 'clientY'])
}

const collectorRound = (value: number, digits: number) => {
  if (!Number.isFinite(value)) return value
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const median = (values: readonly number[]) => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const average = (values: readonly number[]) =>
  values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length

const deviation = (values: readonly number[]) => {
  if (values.length < 2) return Number.NaN
  const mean = average(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  )
}

const skewness = (values: readonly number[]) => {
  if (values.length < 3) return Number.NaN
  const mean = average(values)
  const standardDeviation = deviation(values)
  if (!Number.isFinite(standardDeviation) || standardDeviation === 0) return 1
  return (
    (values.length *
      values.reduce((sum, value) => sum + ((value - mean) / standardDeviation) ** 3, 0)) /
    ((values.length - 1) * (values.length - 2))
  )
}

const kurtosis = (values: readonly number[]) => {
  if (values.length < 4) return Number.NaN
  const mean = average(values)
  const standardDeviation = deviation(values)
  if (!Number.isFinite(standardDeviation) || standardDeviation === 0) return Number.NaN
  const sum = values.reduce((total, value) => total + ((value - mean) / standardDeviation) ** 4, 0)
  return (
    (values.length * (values.length + 1) * sum) /
      ((values.length - 1) * (values.length - 2) * (values.length - 3)) -
    (3 * (values.length - 1) ** 2) / ((values.length - 2) * (values.length - 3))
  )
}

const interactionSummary = (values: readonly number[], digits: number) =>
  [
    collectorRound(average(values), digits),
    collectorRound(median(values), digits),
    collectorRound(deviation(values), digits),
    values.length,
    collectorRound(skewness(values), digits),
    collectorRound(kurtosis(values), digits),
  ].join(';')

/**
 * Installs the same small interaction state machine as general5's `U`/`bb`
 * handlers.  It is deliberately separate from the canvas probes so callers
 * can install it before a login form is used and read the resulting fields at
 * submission time.  Unsupported event objects simply produce no field.
 */
export const createStarbucksIoInteractionCollector = (
  environment: StarbucksIoBrowserEnvironment,
) => {
  const signals: Record<string, string> = {}
  const states = new Map<string, IoInteractionState>()
  const startedAt = Date.now()
  const listeners = new Map<string, (event: IoInteractionEvent) => void>()
  let wheelSeen = false

  const emit = (state: IoInteractionState) => {
    if (!state.Y || !state.wa || !state.count) return
    let value = `${state.wa - startedAt};${String(state.isTrusted)};${state.count}`
    if (state.x.length > 0 && state.y.length > 0) {
      value += `;${collectorRound(average(state.x), 2)};${collectorRound(average(state.y), 2)}`
      value += `;${collectorRound(deviation(state.x), 2)};${collectorRound(deviation(state.y), 2)}`
      value += `;${collectorRound(skewness(state.x), 2)};${collectorRound(skewness(state.y), 2)}`
      value += `;${collectorRound(kurtosis(state.x), 2)};${collectorRound(kurtosis(state.y), 2)}`
      if (state.scrollIntervals.length > 0) {
        const maxX = Math.max(...state.x)
        const maxY = Math.max(...state.y)
        const correlation = (() => {
          const meanX = average(state.x)
          const meanY = average(state.y)
          const deviationX = Math.sqrt(state.x.reduce((sum, item) => sum + (item - meanX) ** 2, 0))
          const deviationY = Math.sqrt(state.y.reduce((sum, item) => sum + (item - meanY) ** 2, 0))
          if (deviationX === 0 || deviationY === 0) return 1
          return Math.abs(
            state.x.reduce(
              (sum, item, index) => sum + (item - meanX) * (state.y[index]! - meanY),
              0,
            ) /
              state.x.length /
              (deviationX / Math.sqrt(state.x.length)) /
              (deviationY / Math.sqrt(state.y.length)),
          )
        })()
        value += `;${collectorRound(maxX, 2)};${collectorRound(maxY, 2)};${collectorRound(correlation, 4)};${Math.round(median(state.scrollIntervals))}`
      }
    }
    signals[state.Y] = value
  }

  const handle = (event: IoInteractionEvent) => {
    const type = typeof event.type === 'string' ? event.type : ''
    if (!type) return
    if (type === 'deviceorientation') {
      const gamma = numericEventValue(event.gamma)
      const beta = numericEventValue(event.beta)
      const alpha = numericEventValue(event.alpha)
      if (gamma !== undefined || beta !== undefined || alpha !== undefined)
        signals.ORPY = `${collectorRound(gamma ?? 0, 4)};${collectorRound(beta ?? 0, 4)};${collectorRound(alpha ?? 0, 4)}`
      const compass = numericEventValue(event.webkitCompassHeading)
      const accuracy = numericEventValue(event.webkitCompassAccuracy)
      if (compass !== undefined || accuracy !== undefined)
        signals.CMPAS = `${collectorRound(compass ?? 0, 4)};${collectorRound(accuracy ?? 0, 4)}`
      return
    }
    if (type === 'devicemotion') {
      const acceleration = event.accelerationIncludingGravity
      const x = numericEventValue(acceleration?.x)
      const y = numericEventValue(acceleration?.y)
      const z = numericEventValue(acceleration?.z)
      if (x !== undefined || y !== undefined || z !== undefined)
        signals.AXEL = `${collectorRound(x ?? 0, 4)};${collectorRound(y ?? 0, 4)};${collectorRound(z ?? 0, 4)}`
      const interval = numericEventValue(event.interval)
      if (interval !== undefined && interval !== 0)
        signals.AXINT = String(collectorRound(interval, 2))
      return
    }
    let key = type
    let label = ''
    if (type === 'keydown' || type === 'keyup') {
      key = 'kp'
      label = 'KEY'
    } else if (type === 'mousedown' || type === 'mouseup') {
      key = 'mc'
      label = 'CLICK'
    } else if (type === 'touchstart' || type === 'touchend') {
      key = 'tc'
      label = 'TOUCH'
    } else if (type.toUpperCase().includes('MOVE')) label = `${type.toUpperCase()[0]}MOV`
    else if (type === 'scroll' || type === 'wheel') label = type.toUpperCase()
    if (!label) return

    const now = Date.now()
    let state = states.get(key)
    if (!state) {
      state = {
        Y: label,
        count: 0,
        samples: new Map<string, number[]>(),
        between: [],
        durations: [],
        repeats: [],
        x: [],
        y: [],
        scrollIntervals: [],
      }
      states.set(key, state)
    }
    state.Y = label
    state.U = now
    if (!state.wa) {
      if (typeof event.pointerType === 'string' && event.pointerType) {
        signals.PTYP ??= event.pointerType
      } else {
        state.wa = now
        state.isTrusted = Boolean(event.isTrusted)
      }
    }

    const down = /^(?:key|mouse)down$/.test(type) || type === 'touchstart'
    const up = /^(?:key|mouse)up$/.test(type) || type === 'touchend'
    if (down) {
      state.T = 'down'
      state.ua = type.replace('down', 'up')
    } else if (up) {
      state.T = 'up'
      state.ua = type.replace('up', 'down')
    }
    const identifier = eventTouchIdentifier(event)
    const button = numericEventValue(event.button)
    const keyCode = numericEventValue(event.keyCode)
    const code = typeof event.code === 'string' ? event.code : ''
    const sampleKey = `${identifier};${button === undefined ? '' : button};${keyCode === undefined ? '' : keyCode};${code}`
    const isWheel = key === 'wheel'
    const underLimit = state.count < 20 || (type === 'scroll' && !wheelSeen)
    if (isWheel && state.count === 19 && !wheelSeen) wheelSeen = true
    if (underLimit) {
      if (state.T) {
        if (sampleKey) {
          const samples = state.samples.get(sampleKey) ?? []
          if (state.T === 'down') {
            samples.push(now)
            state.samples.set(sampleKey, samples)
            const duplicate = samples.length > 1
            if (!duplicate) {
              state.count += 1
              if (state.previous) state.between.push(now - state.previous.time)
              if (samples.length === 1) state.previous = { time: now, id: sampleKey }
            }
          } else if (samples.length > 0) {
            state.durations.push(now - samples[0]!)
            if (samples.length > 1)
              state.repeats.push(samples[samples.length - 1]! - samples[samples.length - 2]!)
            state.samples.delete(sampleKey)
          }
        }
      } else state.count += 1
      if (type !== 'wheel') {
        if (state.T || type === 'scroll') {
          if (state.T || type === 'scroll') {
            if (state.T === undefined && type !== 'scroll') {
              if (state.previousScroll !== undefined)
                state.scrollIntervals.push(now - state.previousScroll)
              state.previousScroll = now
            }
          }
        }
        const x = eventCoordinate(event, 'x')
        const y = eventCoordinate(event, 'y')
        if (x !== undefined && y !== undefined && state.T !== 'up') {
          if (state.x.length < 20) state.x.push(x)
          if (state.y.length < 20) state.y.push(y)
        }
      }
    }
    if (isWheel) {
      emit(state)
      return
    }
    if (state.T !== 'down') emit(state)
    if (state.T !== 'down') {
      if (state.durations.length > 0)
        signals[`${type[0]!.toUpperCase()}DOWN`] = interactionSummary(state.durations, 2)
      if (state.between.length > 0)
        signals[`${type[0]!.toUpperCase()}BTWN`] = interactionSummary(state.between, 2)
      if (state.repeats.length > 0)
        signals[`${type[0]!.toUpperCase()}REP`] = String(Math.round(median(state.repeats)))
    }
  }

  for (const type of [
    'deviceorientation',
    'devicemotion',
    'mousemove',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'keydown',
    'keyup',
    'wheel',
    'scroll',
    'pointermove',
    'pointerdown',
  ]) {
    const listener = (event: IoInteractionEvent) => handle(event)
    listeners.set(type, listener)
    environment.addEventListener?.(type, listener, { passive: true, capture: false })
  }

  return {
    signals: () => ({ ...signals }),
    close: () => {
      for (const [type, listener] of listeners) environment.removeEventListener?.(type, listener)
      listeners.clear()
    },
  }
}

/**
 * Collects the non-token browser probes used by general5 WDP.  Network
 * tokens, cookies, and interaction history remain explicit signals because
 * they cannot be reconstructed from a static Node process.
 */
export const collectStarbucksIoBrowserSignals = (
  environment: StarbucksIoBrowserEnvironment = globalThis,
): StarbucksIoBlackboxSignals => {
  const signals: Record<string, string> = {}
  const document = environment.document
  const canvas = document?.createElement?.('canvas') as
    | {
        width?: number
        height?: number
        getContext?: (kind: string) => any
        toDataURL?: () => string
      }
    | undefined
  if (!canvas) {
    signals.CVFERR = 'Unable to get 2d context'
    signals.CVERR = 'WebGL not supported'
    signals.GLERR = 'WebGL not supported'
    return signals
  }

  canvas.width = 500
  canvas.height = 400
  const context = canvas.getContext?.('2d')
  if (context) {
    const families = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']
    // This is the exact probe alphabet used by Ab.prototype.O in the
    // captured general5 collector.  It intentionally contains unassigned
    // and supplementary-plane code points: changing it changes CVFM.
    const characters =
      '\u20b9 \u2581 \u20ba \ua73d \ufffd \u20b8 \u05c6 \u1e9e \u097f \uf003 \u1cda \u17dd \u23ae \u0d02 \u0b82 \u115a \u2425 \u302e \ua830 \u2b06 \u21e4 \u20bd \u2c7b \u20b0 \ufbee \uf810 \uffff \u007f \u10a0 \ud835\udf90 \u0700 \u1950 \u3095 \u532d \u061c \u20e3 \ufff9 \u0218 \u058f \u08e4 \u09b3 \u1c50 \u2619'.split(
        ' ',
      )
    const measures = families.map((family) => {
      context.font = `1200% ${family}`
      return characters
        .map((character) => {
          const measured = context.measureText?.(character)
          if (!measured) return ''
          const left =
            (measured.actualBoundingBoxLeft ?? 0) + (measured.actualBoundingBoxRight ?? 0)
          const vertical =
            (measured.actualBoundingBoxAscent ?? 0) + (measured.actualBoundingBoxDescent ?? 0)
          return `${left},${vertical}`
        })
        .join(';')
    })
    signals.CVFM = sha1(measures.join('|'))
  }

  const webgl = canvas.getContext?.('webgl') ?? canvas.getContext?.('experimental-webgl')
  if (!webgl) {
    signals.CVERR = 'WebGL not supported'
    signals.GLERR = 'WebGL not supported'
    return signals
  }
  try {
    const debug = (webgl as any).getExtension?.('WEBGL_debug_renderer_info')
    if (debug) {
      signals.GLUV = String((webgl as any).getParameter?.(debug.UNMASKED_VENDOR_WEBGL) ?? '').slice(
        0,
        100,
      )
      signals.GLUR = String(
        (webgl as any).getParameter?.(debug.UNMASKED_RENDERER_WEBGL) ?? '',
      ).slice(0, 200)
    }
    const extensions = (webgl as any).getSupportedExtensions?.()
    if (Array.isArray(extensions))
      signals.GLEL = truncateWithChecksum(sha1(extensions.join('')), 20)
    const parameters = [
      'ALIASED_POINT_SIZE_RANGE',
      'MAX_VIEWPORT_DIMS',
      'MAX_VARYING_VECTORS',
      'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'SHADING_LANGUAGE_VERSION',
      'MAX_TEXTURE_IMAGE_UNITS',
      'SAMPLE_BUFFERS',
    ]
    signals.GLOPS = parameters
      .map((name) => {
        const value = (webgl as any).getParameter?.((webgl as any)[name])
        const text =
          value && typeof value !== 'string' && typeof value.length === 'number'
            ? [...value].join(',')
            : String(value ?? '')
        return name === 'SHADING_LANGUAGE_VERSION' && value ? sha1(text).slice(0, 8) : text
      })
      .join(';')
  } catch (error) {
    signals.GLERR = String(error instanceof Error ? error.message : error).slice(0, 100)
  }
  try {
    const createShader = webgl.createShader
    const drawGradient =
      typeof createShader === 'function' &&
      typeof webgl.createProgram === 'function' &&
      typeof webgl.createBuffer === 'function' &&
      typeof webgl.drawArrays === 'function'
    if (drawGradient) {
      const vertexSource =
        'attribute vec2 a_position; \nattribute vec4 a_color; \nuniform mat3 u_matrix; \nvarying vec4 v_color; \nvoid main() { \n   vec2 position = (u_matrix * vec3(a_position, 1)).xy; \n   gl_Position = vec4(position, 0, 1); \n   v_color = a_color; \n} \n'
      const fragmentSource =
        'precision mediump float; \nvarying vec4 v_color; \nvoid main() { \n\tgl_FragColor = v_color; \n} \n'
      const vertexShader = createShader.call(webgl, webgl.VERTEX_SHADER, vertexSource)
      const fragmentShader = createShader.call(webgl, webgl.FRAGMENT_SHADER, fragmentSource)
      webgl.shaderSource?.(vertexShader, vertexSource)
      webgl.compileShader?.(vertexShader)
      webgl.shaderSource?.(fragmentShader, fragmentSource)
      webgl.compileShader?.(fragmentShader)
      const program = webgl.createProgram()
      webgl.attachShader?.(program, vertexShader)
      webgl.attachShader?.(program, fragmentShader)
      webgl.linkProgram?.(program)
      const position = webgl.getAttribLocation?.(program, 'a_position')
      const color = webgl.getAttribLocation?.(program, 'a_color')
      const matrix = webgl.getUniformLocation?.(program, 'u_matrix')
      if (position === -1 || color === -1 || matrix == null)
        throw new Error('WebGL gradient locations unavailable')
      const positions = webgl.createBuffer()
      webgl.bindBuffer?.(webgl.ARRAY_BUFFER, positions)
      webgl.bufferData?.(
        webgl.ARRAY_BUFFER,
        new Float32Array([0, 0, 0, 0.5, 0.7, 0, 0, -0.1, 0.35, 0.7, 0.5, -0.1]),
        webgl.STATIC_DRAW,
      )
      const colors = webgl.createBuffer()
      webgl.bindBuffer?.(webgl.ARRAY_BUFFER, colors)
      webgl.bufferData?.(
        webgl.ARRAY_BUFFER,
        new Float32Array([
          1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0.8, 0, 1, 1, 0.8, 1, 0, 1, 0.8,
        ]),
        webgl.STATIC_DRAW,
      )
      webgl.viewport?.(0, 0, canvas.width, canvas.height)
      webgl.clearColor?.(0, 0, 0, 0)
      webgl.clear?.(webgl.COLOR_BUFFER_BIT)
      webgl.enable?.(webgl.BLEND)
      webgl.blendFunc?.(webgl.SRC_ALPHA, webgl.ONE_MINUS_SRC_ALPHA)
      webgl.useProgram?.(program)
      webgl.enableVertexAttribArray?.(position)
      webgl.bindBuffer?.(webgl.ARRAY_BUFFER, positions)
      webgl.vertexAttribPointer?.(position, 2, webgl.FLOAT, false, 0, 0)
      webgl.enableVertexAttribArray?.(color)
      webgl.bindBuffer?.(webgl.ARRAY_BUFFER, colors)
      webgl.vertexAttribPointer?.(color, 4, webgl.FLOAT, false, 0, 0)
      webgl.uniformMatrix3fv?.(
        matrix,
        false,
        [
          1.5863117781980967, -0.20884190755208254, 0, 0.20884190755208254, 1.5863117781980967, 0,
          -0.3, -0.2, 1,
        ],
      )
      webgl.drawArrays?.(webgl.TRIANGLES, 0, 5)
    }
    if (typeof canvas.toDataURL !== 'function') throw new Error('Canvas.toDataURL not defined')
    signals.CVGRAD = truncateWithChecksum(sha1(canvas.toDataURL()), 30)
  } catch (error) {
    signals.CVERR = String(error instanceof Error ? error.message : error).slice(0, 100)
  }
  return signals
}

/** Collects the asynchronous OfflineAudioContext probe when the surface has one. */
export const collectStarbucksIoBrowserSignalsAsync = async (
  environment: StarbucksIoBrowserEnvironment = globalThis,
): Promise<StarbucksIoBlackboxSignals> => {
  const signals = { ...collectStarbucksIoBrowserSignals(environment) }
  const getBattery = environment.navigator?.getBattery
  if (typeof getBattery === 'function') {
    try {
      const battery = await getBattery()
      if (battery?.level) signals.BATL = String(battery.level)
    } catch {
      // The vendor intentionally ignores a rejected BatteryManager promise.
    }
  }
  const AudioContext = environment.OfflineAudioContext ?? environment.webkitOfflineAudioContext
  if (!AudioContext) {
    signals.AUDERR = 'Audio context is not defined'
    return signals
  }
  try {
    const context = new AudioContext(1, 200_000, 95_000)
    const oscillator = context.createOscillator?.()
    const compressor = context.createDynamicsCompressor?.()
    if (!oscillator || !compressor || typeof context.startRendering !== 'function')
      throw new Error('OfflineAudioContext is incomplete')
    oscillator.type = 'sawtooth'
    if (oscillator.frequency) oscillator.frequency.value = 3_000
    if (compressor.threshold) compressor.threshold.value = -80
    if (compressor.knee) compressor.knee.value = 40
    if (compressor.ratio) compressor.ratio.value = 12
    if (compressor.reduction) compressor.reduction.value = -20
    if (compressor.attack) compressor.attack.value = 0.003
    if (compressor.release) compressor.release.value = 0
    oscillator.connect?.(compressor)
    compressor.connect?.(context.destination)
    oscillator.start?.(0)
    const rendered = await context.startRendering()
    const samples = rendered?.getChannelData?.(0)
    if (!samples) throw new Error('No PCM data')
    let sum = 0
    for (const sample of samples) sum += Math.abs(sample)
    signals.AUD = String(sum).slice(0, 50)
  } catch (error) {
    signals.AUDERR = String(error instanceof Error ? error.message : error).slice(0, 100)
  }
  return signals
}

/**
 * Extracts the literal values from a downloaded dyn_wdp.js response.
 *
 * The response is a small registration script (`a("name", value)`).  It does
 * not need a JavaScript evaluator: direct strings, URI-decoded strings (`c`),
 * and the loader's base64 decoder (`d`) are sufficient for the current
 * protocol.  Any other expression is intentionally ignored and must be
 * supplied as an explicit signal instead of being guessed.
 */
export const parseStarbucksIoDynamicScript = (script: string) => {
  if (!script.trim()) throw new Error('iOvation dynamic script must not be empty')
  const values: Record<string, string> = {}
  const aliases: Readonly<Record<string, string>> = {
    haccchr: 'HACCLNG',
    hacclng: 'HACCLNG',
    svrtime: 'SVRTIME',
    jstoken: 'JSTOKEN',
    jssrc: 'JSSRC',
    suagt: 'SUAGT',
    did: 'DID',
    alias: 'ALIAS',
    fpremad: 'REMAD',
    fphcctrl: 'FPHCCTRL',
    fphclip: 'FPHCLIP',
    fphxcclip: 'FPHXCCLIP',
    fphfwded: 'FPHFWDED',
    fphxfwdfr: 'FPHXFWDFR',
    fphprxcon: 'FPHPRXCON',
    fphprgma: 'FPHPRGMA',
    fphvia: 'FPHVIA',
    jsver: 'JSVER',
    svrvr: 'SVRVR',
    charch: 'CHJARCH',
    chplat: 'CHJPLAT',
    chplatv: 'CHJPLATV',
    chmob: 'CHJMOB',
    chua: 'CHJUA',
    chmodel: 'CHJMODEL',
    chvrlist: 'CHJVRLIST',
    chbit: 'CHJBIT',
    chwow64: 'CHJWOW64',
  }
  const add = (name: string, value: string) => {
    if (!name || !value) return
    const normalized = aliases[name.toLowerCase()] ?? name.toUpperCase()
    if (values[normalized] !== undefined && values[normalized] !== value)
      throw new Error(`iOvation dynamic script contains conflicting ${normalized} values`)
    values[normalized] = value
  }
  for (const match of script.matchAll(/\ba\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']/g))
    add(match[1] ?? '', match[2] ?? '')
  for (const match of script.matchAll(
    /\ba\(\s*["']([^"']+)["']\s*,\s*([cd])\(\s*["']([^"']*)["']\s*\)/g,
  )) {
    const encoded = match[3] ?? ''
    const value =
      match[2] === 'c' ? decodeURIComponent(encoded) : Buffer.from(encoded, 'base64').toString()
    add(match[1] ?? '', value)
  }
  return values
}

/**
 * Extracts the per-page CTOKEN/LID registration from the logo.js response.
 * The response is data-only for this purpose; evaluating the registration
 * wrapper would unnecessarily reintroduce a vendor-JavaScript runtime.
 */
export const parseStarbucksIoLogoScript = (script: string) => {
  if (!script.trim()) throw new Error('iOvation logo script must not be empty')
  const token = script.match(/\b_CTOKEN\s*=\s*["']([^"']+)["']/)?.[1]
  if (!token) throw new Error('iOvation logo script did not expose _CTOKEN')
  const lid = script.match(/\.add\(\s*["']LID["']\s*,\s*["']([^"']+)["']\s*\)/)?.[1]
  return lid ? { CTOKEN: token, LID: lid } : { CTOKEN: token }
}

export interface StarbucksIoBlackboxOptions {
  pageURL: string | URL
  globalObjectName?: string
  /** Loader version reported by the WDP bootstrap (for example `5.2.2`). */
  loaderVersion?: string
  /** Optional values collected by the dynamic WDP stage. */
  dynamicFields?: Readonly<Record<string, string>>
  /** Downloaded dyn_wdp.js source; parsed without evaluating JavaScript. */
  dynamicScript?: string
  /** Downloaded logo.js source; parsed without evaluating JavaScript. */
  logoScript?: string
  /** Explicit values collected by a browser or another TS signal provider. */
  signals?: StarbucksIoBlackboxSignals
  /** Collector integration label (the login page uses `general5`). */
  alias?: string
  /** Call site label recorded as JINT (for example `form`). */
  intent?: string
  /** Static collector namespace (`IO` for the remote TP collector, `FP` for local FP). */
  namespace?: 'IO' | 'FP'
  /** Optional browser/shim surface used for pure-TypeScript sensor probes. */
  browserEnvironment?: StarbucksIoBrowserEnvironment
  userAgent?: string
  appVersion?: string
  appName?: string
  platform?: string
  oscpu?: string
  language?: string
  languages?: string[]
  cookieEnabled?: boolean
  hardwareConcurrency?: number
  width?: number
  height?: number
  colorDepth?: number
  referrer?: string
}

export interface StarbucksIoBlackboxRuntime {
  getBlackbox(): Promise<string>
  close(): void
}

type BrowserNavigator = {
  userAgent?: string
  appVersion?: string
  appName?: string
  platform?: string
  oscpu?: string
  language?: string
  languages?: readonly string[]
  cookieEnabled?: boolean
  hardwareConcurrency?: number
  plugins?: ArrayLike<{ filename?: string } | unknown>
  systemLanguage?: string
  onLine?: boolean
  maxTouchPoints?: number
  storage?: {
    getDirectory?: () => Promise<unknown>
  }
  credentials?: unknown
  serviceWorker?: unknown
  webkitTemporaryStorage?: StarbucksIoBrowserEnvironment['webkitTemporaryStorage']
  getBattery?: () => Promise<{ level?: number }>
  userAgentData?: {
    mobile?: boolean
    brands?: Array<{ brand?: string; version?: string }>
    getHighEntropyValues?(hints: string[]): Promise<{
      architecture?: string
      platform?: string
      platformVersion?: string
      model?: string
      bitness?: string
      wow64?: boolean
      fullVersionList?: Array<{ brand?: string; version?: string }>
    }>
  }
}

const defaultUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'

const navigatorValue = () =>
  (globalThis as typeof globalThis & { navigator?: BrowserNavigator }).navigator

const stringValue = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const numberValue = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const pad = (value: number, width: number) => value.toString().padStart(width, '0')
const hex = (value: number, width = 4) => Math.max(0, value).toString(16).padStart(width, '0')

/**
 * WDP stores field values as a UTF-8 byte string, rather than as JavaScript
 * Unicode.  Keeping this conversion explicit is important for non-ASCII user
 * agents and languages: the field length and the DES input both count bytes.
 */
const utf8Binary = (value: string) => String.fromCharCode(...new TextEncoder().encode(value))

const utcTimestamp = (value: Date) =>
  `${value.getUTCFullYear()}/${pad(value.getUTCMonth() + 1, 2)}/${pad(value.getUTCDate(), 2)} ${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}`

const browserInfo = (userAgent: string, appName: string, appVersion: string) => {
  const token = userAgent.match(/([\w]+(?:\s+[^\s/]+)?)[/]([^\s]+)/g) ?? []
  const browsers = [
    'Classilla',
    'Gnuzilla',
    'SeaMonkey',
    'Maxthon',
    'K-Meleon',
    'Flock',
    'Epic',
    'Camino',
    'Firebird',
    'Conkeror',
    'Fennec',
    'Skyfire',
    'MicroB',
    'GranParadiso',
    'Opera Mini',
    'Netscape',
    'Sleipnir',
    'Browser',
    'IceCat',
    'weasel',
    'iCab',
    'Opera',
    'OPR',
    'OPiOS',
    'Minimo',
    'Konqueror',
    'Galeon',
    'Lunascape',
    'Thunderbird',
    'BonEcho',
    'Navigator',
    'Epiphany',
    'Minefield',
    'TizenBrowser',
    'Namoroka',
    'Shiretoko',
    'NetFront',
    'IEMobile',
    'Puffin',
    'Firefox',
    'FxiOS',
    'Edge',
    'Edg',
    'Chrome',
    'CriOS',
    'Safari',
    'Mobile',
    'Mobile Safari',
    'Trident',
  ]
  let name = appName
  let version = appVersion.trim()
  for (const value of token) {
    const slash = value.indexOf('/')
    const candidate = value.slice(0, slash)
    if (browsers.some((browser) => candidate.toUpperCase().includes(browser.toUpperCase()))) {
      name = candidate
      version = value.slice(slash + 1).replace(/;$/, '')
      break
    }
  }
  return { name, version }
}

const osComment = (userAgent: string, oscpu: string, platformName: string) => {
  const comments = [...userAgent.matchAll(/\(([^)]*)\)/g)].map((match) =>
    (match[1] ?? '').replace(/[();]/g, '').trim(),
  )
  const os = oscpu || platformName
  const index = comments.findIndex((value) => value.toUpperCase().includes(os.toUpperCase()))
  if (index >= 0) return comments.slice(index + 1).join('; ')
  return comments.slice(1).join('; ')
}

const timezoneOffsetForCollector = (year: number) => {
  const january = new Date(year, 0, 1, 0, 0, 0, 0).getTimezoneOffset()
  const july = new Date(year, 6, 1, 0, 0, 0, 0).getTimezoneOffset()
  return Math.max(january, july)
}

const browserBrands = (brands: unknown) => {
  if (!Array.isArray(brands)) return ''
  return brands
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      const brand = JSON.stringify((entry as { brand?: unknown }).brand)
      const version = JSON.stringify((entry as { version?: unknown }).version)
      return `${brand};V=${version}`
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * Reproduces the capability branches of the WDP PBR collector, including
 * the asynchronous storage/quota callbacks.
 * The browser implementation intentionally exposes the actual capability
 * surface to this function; no Node-specific value is substituted.
 */
const collectPbrSignals = async (
  environment: StarbucksIoBrowserEnvironment,
  nav?: BrowserNavigator,
) => {
  const signals: Record<string, string> = {}
  const objectToStringError = (() => {
    try {
      // String(Object.create(null)) throws in browsers; the vendor then
      // attempts the `.sort()` call on the unreachable result.
      const objectConstructor = environment.Object ?? Object
      const stringConstructor = environment.String ?? String
      stringConstructor(objectConstructor.create?.(null) ?? Object.create(null))
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  if (!objectToStringError) return signals
  const errorLength = objectToStringError.length
  const probe = ({ result, key }: { result?: boolean; key: string }) => {
    const code =
      errorLength === 40
        ? 'C'
        : errorLength === 42
          ? 'F'
          : errorLength === 16
            ? 'S'
            : errorLength === 15
              ? 'I'
              : ''
    signals.PBR = result === undefined ? '?' : result ? 'T' : 'F'
    signals.PBRD = `2;${errorLength};${code};${key}`
  }
  const code =
    errorLength === 40
      ? 'C'
      : errorLength === 42
        ? 'F'
        : errorLength === 16
          ? 'S'
          : errorLength === 15
            ? 'I'
            : ''
  if (code === 'C') {
    if (environment.RTCSctpTransport !== undefined) {
      const temporary = nav?.webkitTemporaryStorage ?? environment.webkitTemporaryStorage
      if (!temporary?.queryUsageAndQuota) probe({ key: '2' })
      else {
        await new Promise<void>((resolve) => {
          try {
            temporary.queryUsageAndQuota?.(
              (_used, quota) => {
                const heap = environment.performance?.memory?.jsHeapSizeLimit ?? 1_000_000_000
                probe({ result: quota < 2 * heap, key: '2' })
                resolve()
              },
              () => {
                probe({ key: '2' })
                resolve()
              },
            )
          } catch (error) {
            signals.PBRERR = String(error instanceof Error ? error.message : error).slice(0, 50)
            probe({ key: '2' })
            resolve()
          }
        })
      }
    } else if (typeof environment.webkitRequestFileSystem === 'function') {
      await new Promise<void>((resolve) => {
        try {
          environment.webkitRequestFileSystem?.(
            environment.Window?.TEMPORARY,
            1,
            () => {
              probe({ result: false, key: '1' })
              resolve()
            },
            () => {
              probe({ result: true, key: '1' })
              resolve()
            },
          )
        } catch {
          probe({ key: '1' })
          resolve()
        }
      })
    } else probe({ key: '1' })
  } else if (code === 'S') {
    if (typeof nav?.storage?.getDirectory === 'function') {
      try {
        await nav.storage.getDirectory()
        probe({ result: false, key: '3' })
      } catch {
        probe({ result: true, key: '3' })
      }
    } else if (environment.PointerEvent !== undefined) {
      probe({ key: '5' })
    } else {
      try {
        if (typeof environment.openDatabase !== 'function')
          throw new Error('openDatabase not defined')
        environment.openDatabase(null, null, null, null)
        try {
          const storage = environment.localStorage
          if (!storage?.setItem || !storage.removeItem) throw new Error('localStorage not defined')
          storage.setItem('fp_b2ebf7ba-62d2-49bc-80c1-3e5459a657d6', '1')
          storage.removeItem('fp_b2ebf7ba-62d2-49bc-80c1-3e5459a657d6')
          probe({ result: false, key: '6' })
        } catch {
          probe({ result: true, key: '6' })
        }
      } catch {
        probe({ result: true, key: '5' })
      }
    }
  } else if (code === 'F') {
    if (typeof nav?.storage?.getDirectory === 'function') {
      try {
        await nav.storage.getDirectory()
        probe({ result: false, key: '10' })
      } catch {
        probe({ result: true, key: '10' })
      }
    } else if (nav?.credentials !== undefined) {
      probe({ result: nav.serviceWorker === undefined, key: '7' })
    } else probe({ key: '9' })
  } else if (code === 'I') {
    probe({ result: environment.indexedDB === undefined, key: '8' })
  }
  return signals
}

class FieldStore {
  #fields = new Map<string, string>()
  #order: string[] = []

  add(name: string, value: unknown, prepend = false) {
    if (typeof value !== 'string' || value.length === 0) return
    const normalized = [...value]
      .filter((character) => {
        const code = character.charCodeAt(0)
        return !(code <= 0x08 || (code >= 0x0b && code <= 0x1f) || code === 0x7f)
      })
      .join('')
    if (!normalized) return
    if (!this.#fields.has(name)) {
      if (prepend) this.#order.unshift(name)
      else this.#order.push(name)
    }
    this.#fields.set(name, utf8Binary(normalized))
  }

  serialize(maxLength: number) {
    const encodeField = (name: string, value: string) =>
      `${hex(name.length)}${name.toUpperCase()}${hex(value.length)}${value}`

    // The vendor inserts these two bookkeeping fields during finalization,
    // but token collectors may still run between the ordinary fields and the
    // finalizer.  In the captured IO blackbox BBSZ follows CTOKEN; when the
    // websocket WSTRIP token is present it follows JSTOKEN instead.  Keep the
    // observed insertion point instead of unconditionally putting BBSZ first.
    const names = this.#order.filter((name) => name !== 'BBSZ' && name !== 'LOST')
    if (maxLength < 4_000) {
      const fontIndex = names.indexOf('FFONTS')
      if (fontIndex >= 0) names.splice(fontIndex, 1)
    }
    const bbszIndex = names.includes('WSTRIP')
      ? names.indexOf('JSTIME') >= 0
        ? names.indexOf('JSTIME')
        : names.length
      : names.indexOf('CTOKEN') >= 0
        ? names.indexOf('CTOKEN') + 1
        : 0
    names.splice(bbszIndex, 0, 'BBSZ')
    names.unshift('LOST')
    const values = new Map(this.#fields)
    values.set('BBSZ', utf8Binary(String(maxLength)))
    values.set('LOST', utf8Binary('0000;00000'))

    const version = maxLength > 0 ? maxLength : 0
    const limit = version - 6
    let budget = Math.floor(0.75 * limit)
    budget -= (budget % 4) + 4
    budget -= 4
    const totalFields = names.length
    const totalLength =
      8 * totalFields +
      names.join('').length +
      names.reduce((sum, name) => sum + (values.get(name)?.length ?? 0), 0)
    let encoded = ''
    let included = 0
    for (const name of names) {
      const field = encodeField(name, values.get(name) ?? '')
      if (version <= 0 || encoded.length + field.length + 3 < budget) {
        encoded += field
        included++
      }
    }

    if (encoded.length !== totalLength || included !== totalFields) {
      const lost = totalLength - encoded.length
      const lostValue = `${hex(totalFields - included)};${pad(Math.min(lost, 100_000), 5)}`
      const marker = encodeField('LOST', values.get('LOST') ?? '')
      encoded = encoded.replace(marker, encodeField('LOST', utf8Binary(lostValue)))
      return `${hex(included)}${encoded}`
    }

    // LOST is only emitted when a field was dropped.
    encoded = encoded.replace(encodeField('LOST', values.get('LOST') ?? ''), '')
    return `${hex(included - 1)}${encoded}`
  }
}

// DES is implemented locally instead of using a platform cipher provider.
// Bun's OpenSSL build, for example, does not expose the legacy DES names that
// Node exposes.  The tables are the standard DES tables and match the
// ma.Ab()/ma.xb() implementation embedded in static_wdp.js.
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64,
  56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53,
  45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]
const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37,
  5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2,
  42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
  52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 28, 20, 12, 4,
]
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
  31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
]
const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19,
  20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13,
  30, 6, 22, 11, 4, 25,
]
const SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11,
    9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5,
    11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10,
    6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2,
    11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12,
    11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4,
    15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1,
    10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9,
    4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10,
    3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6,
    15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14,
    0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10,
    11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12,
    2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9,
    5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11,
    0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13,
    15, 12, 9, 0, 3, 5, 6, 11,
  ],
]

const permutation = (value: bigint, table: readonly number[], inputBits: number) => {
  let result = 0n
  for (const bit of table) result = (result << 1n) | ((value >> BigInt(inputBits - bit)) & 1n)
  return result
}

const rotate28 = (value: bigint, count: number) =>
  ((value << BigInt(count)) | (value >> BigInt(28 - count))) & 0x0fffffffn

const desRoundKeys = (key: Uint8Array) => {
  let value = 0n
  for (const byte of key) value = (value << 8n) | BigInt(byte)
  const selected = permutation(value, PC1, 64)
  let left = selected >> 28n
  let right = selected & 0x0fffffffn
  const shifts = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
  return shifts.map((shift) => {
    left = rotate28(left, shift)
    right = rotate28(right, shift)
    return permutation((left << 28n) | right, PC2, 56)
  })
}

const desBlock = (block: Uint8Array, keys: readonly bigint[]) => {
  let value = 0n
  for (const byte of block) value = (value << 8n) | BigInt(byte)
  const permuted = permutation(value, IP, 64)
  let left = permuted >> 32n
  let right = permuted & 0xffffffffn
  for (const key of keys) {
    const expanded = permutation(right, E, 32) ^ key
    let substituted = 0n
    for (let box = 0; box < 8; box++) {
      const six = Number((expanded >> BigInt((7 - box) * 6)) & 0x3fn)
      const row = ((six & 0x20) >> 4) | (six & 1)
      const column = (six >> 1) & 0xf
      substituted = (substituted << 4n) | BigInt(SBOX[box]?.[row * 16 + column] ?? 0)
    }
    const mixed = permutation(substituted, P, 32)
    const next = left ^ mixed
    left = right
    right = next & 0xffffffffn
  }
  const output = permutation((right << 32n) | left, FP, 64)
  const bytes = new Uint8Array(8)
  for (let index = 7; index >= 0; index--) {
    bytes[index] = Number((output >> BigInt((7 - index) * 8)) & 0xffn)
  }
  return bytes
}

const encrypt = (plainText: string) => {
  const key = Uint8Array.from([124, 76, 69, 0, 99, 2, 200, 163])
  const input = Uint8Array.from([...plainText].map((character) => character.charCodeAt(0) & 0xff))
  const padded = new Uint8Array(Math.ceil(input.length / 8) * 8)
  padded.set(input)
  const keys = desRoundKeys(key)
  const output = new Uint8Array(padded.length)
  for (let offset = 0; offset < padded.length; offset += 8)
    output.set(desBlock(padded.subarray(offset, offset + 8), keys), offset)
  return Buffer.from(output).toString('base64')
}

const decrypt = (cipherText: string) => {
  const key = Uint8Array.from([124, 76, 69, 0, 99, 2, 200, 163])
  const input = Buffer.from(cipherText, 'base64')
  if (input.length === 0 || input.length % 8 !== 0)
    throw new Error('iOvation blackbox ciphertext is not DES block aligned')
  const keys = desRoundKeys(key).toReversed()
  const output = new Uint8Array(input.length)
  for (let offset = 0; offset < input.length; offset += 8)
    output.set(desBlock(input.subarray(offset, offset + 8), keys), offset)
  return new TextDecoder().decode(output).replace(/\0+$/g, '')
}

const decodeStarbucksIoBlackboxPart = (value: string) => {
  if (!/^0400[A-Za-z0-9+/=]+$/.test(value))
    throw new Error('iOvation blackbox must start with the 0400 envelope marker')
  return decrypt(value.slice(4))
}

/**
 * Decodes the local WDP envelope for diagnostics and fixture verification.
 * It does not expose a browser fallback: callers still need the same fields
 * and tokens to produce a compatible blackbox.
 */
export const decodeStarbucksIoBlackbox = (value: string) => {
  if (value.includes(';'))
    throw new Error(
      'iOvation blackbox contains multiple envelopes; use decodeStarbucksIoBlackboxes',
    )
  return decodeStarbucksIoBlackboxPart(value)
}

/**
 * Decodes the combined value used by the login form. Starbucks submits the
 * remote IO collector followed by the local FP collector, separated by one
 * semicolon; each side is an independent `0400` DES envelope.
 */
export const decodeStarbucksIoBlackboxes = (value: string) => {
  const parts = value.split(';')
  if (parts.length !== 2 || parts.some((part) => part.length === 0))
    throw new Error(
      'combined iOvation blackbox must contain exactly two non-empty envelopes separated by ;',
    )
  return parts.map(decodeStarbucksIoBlackboxPart)
}

const staticVersionFromScript = (script: string) => {
  const version = script.match(/(?:\.staticVer|\bstaticVer)\s*=\s*["']([^"']+)["']/)?.[1]
  if (!version) throw new Error('iOvation script did not expose a staticVer value')
  return version
}

export const createTypeScriptIoBlackboxRuntime = (
  script: string,
  options: StarbucksIoBlackboxOptions,
): StarbucksIoBlackboxRuntime => {
  if (!script.trim()) throw new Error('iOvation script must not be empty')
  const staticVersion = staticVersionFromScript(script)
  const loaderVersion =
    options.loaderVersion ?? script.match(/loaderVer\s*[:=]\s*["']([^"']+)["']/)?.[1]
  const startedAt = Date.now()
  let closed = false
  let cached: Promise<string> | undefined
  const browserEnvironment = options.browserEnvironment
  const interactionCollector = browserEnvironment
    ? createStarbucksIoInteractionCollector(browserEnvironment)
    : undefined
  const hostNavigator = navigatorValue()
  // Bun/Node expose a process-level navigator that is not the page realm the
  // WDP observes. Use it only when it looks like an actual browser surface;
  // otherwise the pinned browser defaults below remain deterministic.
  const nav =
    browserEnvironment?.navigator ??
    (hostNavigator && !/^(?:Bun|Node)\//i.test(String(hostNavigator.userAgent ?? ''))
      ? hostNavigator
      : undefined)
  const userAgent = stringValue(options.userAgent ?? nav?.userAgent, defaultUserAgent)
  const appVersion = stringValue(options.appVersion ?? nav?.appVersion, userAgent)
  const appName = stringValue(options.appName ?? nav?.appName, 'Netscape')
  const platformName = stringValue(options.platform ?? nav?.platform, `${platform()} ${arch()}`)
  const oscpuValue = options.oscpu ?? nav?.oscpu
  const oscpu = stringValue(oscpuValue, platformName)
  const language = stringValue(options.language ?? nav?.language ?? nav?.systemLanguage, 'en-US')
  const languages = options.languages ?? nav?.languages ?? [language]
  const width = numberValue(options.width ?? browserEnvironment?.screen?.width, 1024)
  const height = numberValue(options.height ?? browserEnvironment?.screen?.height, 768)
  const colorDepth = numberValue(options.colorDepth ?? browserEnvironment?.screen?.colorDepth, 24)
  const referrer = options.referrer ?? browserEnvironment?.document?.referrer ?? ''
  const url = new URL(options.pageURL)

  const build = async () => {
    const now = new Date()
    const fields = new FieldStore()
    const browserSignals = browserEnvironment
      ? {
          ...(await collectStarbucksIoBrowserSignalsAsync(browserEnvironment)),
          ...interactionCollector?.signals(),
          ...(await collectPbrSignals(browserEnvironment, nav)),
        }
      : {}
    const signalEntries = Object.entries({ ...browserSignals, ...options.signals })
    const parsedDynamicEntries = Object.entries(
      options.dynamicScript ? parseStarbucksIoDynamicScript(options.dynamicScript) : {},
    )
    const parsedLogoEntries = Object.entries(
      options.logoScript ? parseStarbucksIoLogoScript(options.logoScript) : {},
    )
    const dynamicEntries = [
      ...parsedLogoEntries,
      ...parsedDynamicEntries,
      ...Object.entries(options.dynamicFields ?? {}),
    ]
    const provided = new Map<string, string>()
    for (const [name, value] of [...signalEntries, ...dynamicEntries]) {
      if (provided.has(name) && provided.get(name) !== value)
        throw new Error(`iOvation field ${name} was supplied more than once`)
      provided.set(name, value)
    }
    if (!provided.has('LSTOKEN') && browserEnvironment?.localStorage?.getItem) {
      const tokenId = script.match(/new\s+\w+\(\s*["']([\da-f]{8}-[\da-f-]{27,})["']/i)?.[1]
      try {
        const token =
          (tokenId && browserEnvironment.localStorage.getItem(`fp_${tokenId}`)) ??
          browserEnvironment.localStorage.getItem('fp_temp')
        if (token) provided.set('LSTOKEN', token)
      } catch (error) {
        provided.set(
          'LSERROR',
          String(error instanceof Error ? error.message : error).slice(0, 100),
        )
      }
    }
    const supplied = (name: string) => provided.get(name)
    const add = (name: string, value: unknown, prepend = false) =>
      fields.add(name, supplied(name) ?? value, prepend)

    // JSTIME is inserted first because the dynamic token fields use prepend
    // insertion.  This reproduces the collector's observed order:
    // CTOKEN,BBSZ,LSTOKEN,SVRTIME,JSTOKEN,JSTIME,...
    add('JSTIME', utcTimestamp(now), true)
    const prependNames = ['CTOKEN', 'WSTRIP', 'LSTOKEN', 'SVRTIME', 'JSTOKEN']
    for (const name of [...prependNames].reverse()) {
      const value = supplied(name)
      if (value !== undefined) fields.add(name, value, true)
    }
    add('INTLOC', `${url.origin}${url.pathname}`)
    add('STVER', staticVersion)
    if (loaderVersion || supplied('LDVER') !== undefined)
      add('LDVER', loaderVersion?.slice(0, 40) ?? '')
    add('BBNS', options.namespace ?? 'FP')
    add('TZON', String(timezoneOffsetForCollector(now.getFullYear())))
    add('UAGT', userAgent.slice(0, 400))
    add('JRES', `${height}x${width}`)
    add('JCLDPT', String(colorDepth))
    add('JENBL', '1')
    const browser = browserInfo(userAgent, appName, appVersion)
    add('JBRNM', browser.name)
    add('JBRVR', browser.version)
    add('JBROS', oscpu || platformName)
    const plugins = Array.from(nav?.plugins ?? [], (plugin) =>
      typeof plugin === 'object' && plugin && 'filename' in plugin
        ? String((plugin as { filename?: unknown }).filename ?? '')
        : String(plugin),
    ).filter(Boolean)
    if (plugins.length || supplied('JPLGNS') !== undefined) add('JPLGNS', `${plugins.join(';')};`)
    add('JLANG', language)
    add('JLANGS', languages.filter((value): value is string => typeof value === 'string').join(','))
    if (!(options.cookieEnabled ?? nav?.cookieEnabled ?? true) || supplied('JCOX') !== undefined)
      add('JCOX', '1')
    add('JBRCM', osComment(userAgent, oscpu, platformName))
    const webSocket = browserEnvironment?.WebSocket ?? (globalThis as any).WebSocket
    if (typeof webSocket !== 'function' || supplied('WSERR') !== undefined)
      add('WSERR', 'window.WebSocket not defined')
    if (nav?.onLine === false) add('OFFLN', '1')
    const userAgentData = nav?.userAgentData
    if (userAgentData) {
      if (userAgentData.mobile !== undefined) add('CHJMOB', String(userAgentData.mobile))
      add('CHJUA', browserBrands(userAgentData.brands))
      const highEntropy = userAgentData.getHighEntropyValues
        ? await userAgentData
            .getHighEntropyValues([
              'platform',
              'platformVersion',
              'architecture',
              'model',
              'fullVersionList',
              'bitness',
              'wow64',
            ])
            .catch((error) => {
              add('CHJERR', String(error instanceof Error ? error.message : error).slice(0, 100))
              return undefined
            })
        : undefined
      if (highEntropy) {
        add('CHJARCH', highEntropy.architecture)
        add('CHJPLAT', highEntropy.platform)
        add('CHJPLATV', highEntropy.platformVersion)
        add('CHJMODEL', highEntropy.model)
        add('CHJBIT', highEntropy.bitness)
        add('CHJWOW64', highEntropy.wow64 === undefined ? undefined : String(highEntropy.wow64))
        add('CHJVRLIST', browserBrands(highEntropy.fullVersionList))
      }
    }
    add('NPLAT', platformName)
    if (!userAgent.includes(appVersion) || supplied('APVER') !== undefined) add('APVER', appVersion)
    if (typeof oscpuValue === 'string' && oscpuValue.length > 0) add('OSCPU', oscpuValue)
    else if (supplied('OSCPU') !== undefined) add('OSCPU', '')
    const concurrency = numberValue(
      options.hardwareConcurrency ?? nav?.hardwareConcurrency,
      Math.max(1, cpus().length),
    )
    add('CCUR', String(concurrency))
    add('JREFRR', referrer)
    add('BBOUT', 'ms2_devicefingerprint')
    const mist = supplied('MIST')
    if (mist !== undefined) add('MIST', mist)
    // The two collectors are concatenated by the vendor, but their async
    // completion points differ.  IO writes the dynamic headers before the
    // browser probes; FP writes JINT/JIFFY first and then its FPH headers.
    // Keeping these order tables explicit is important because the DES input
    // is ordered, not a map.
    const namespace = supplied('BBNS') ?? options.namespace ?? 'FP'
    const ioOrder = [
      'JSSRC',
      'HACCLNG',
      'DID',
      'ALIAS',
      'REMAD',
      'HCCTRL',
      'HXCCLIP',
      'HXFWDFR',
      'HPRGMA',
      'JSVER',
      'SVRVR',
      'GLUV',
      'GLUR',
      'GLEL',
      'GLOPS',
      'CVGRAD',
      'CVFM',
      'AUD',
      'PBR',
      'PBRD',
      'JIFFY',
      'LID',
      'JINT',
      'PTYP',
      'TOUCH',
      'TDOWN',
      'MMOV',
      'CLICK',
      'MDOWN',
      'KEY',
      'KDOWN',
      'KBTWN',
      'TBTWN',
      'MBTWN',
    ]
    const fpOrder = [
      'JINT',
      'JIFFY',
      'JSSRC',
      'HACCLNG',
      'DID',
      'FPHCCTRL',
      'FPHXCCLIP',
      'FPHXFWDFR',
      'FPHPRGMA',
      'FPHVIA',
      'JSVER',
      'SVRVR',
      'GLUV',
      'GLUR',
      'GLEL',
      'GLOPS',
      'CVGRAD',
      'CVFM',
      'PBR',
      'PBRD',
      'AUD',
      'LID',
      'PTYP',
      'TOUCH',
      'TDOWN',
      'MMOV',
      'CLICK',
      'MDOWN',
      'KEY',
      'KDOWN',
      'KBTWN',
      'TBTWN',
      'MBTWN',
    ]
    const ordered = new Set(namespace === 'FP' ? fpOrder : ioOrder)
    for (const name of namespace === 'FP' ? fpOrder : ioOrder) {
      const value = name === 'ALIAS' ? (options.alias ?? supplied(name)) : supplied(name)
      if (value !== undefined) add(name, value)
      else if (name === 'JINT') add(name, options.intent ?? 'form')
      else if (name === 'JIFFY') add(name, String(Math.max(0, Date.now() - startedAt)))
    }

    // Remaining browser-only fields are copied verbatim.  They are not
    // synthesized: a failed probe stays absent, matching the WDP collector.
    for (const name of STARBUCKS_IO_BLACKBOX_FIELD_NAMES) {
      if (
        name === 'BBSZ' ||
        name === 'JSTIME' ||
        name === 'CTOKEN' ||
        name === 'SUAGT' ||
        ordered.has(name)
      )
        continue
      const value = supplied(name)
      if (value !== undefined) fields.add(name, value)
    }
    for (const [name, value] of dynamicEntries) {
      // The static collector removes SUAGT when it is identical to
      // navigator.userAgent; a mismatch is represented by JDIFF instead.
      if (name === 'SUAGT' || prependNames.includes(name) || ordered.has(name)) continue
      if (!STARBUCKS_IO_BLACKBOX_FIELD_NAMES.includes(name as never)) fields.add(name, value)
    }
    const dynamicUserAgent = supplied('SUAGT')
    if (dynamicUserAgent !== undefined && dynamicUserAgent !== userAgent) fields.add('JDIFF', '1')
    const plain = fields.serialize(10_000)
    return `0400${encrypt(plain)}`
  }

  return {
    async getBlackbox() {
      if (closed) throw new Error('iOvation runtime is closed')
      cached ??= build()
      return cached
    },
    close() {
      closed = true
      interactionCollector?.close()
    },
  }
}
