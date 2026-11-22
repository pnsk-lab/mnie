import { Environment, execute, ReturnSignal, type AstNode } from './kxz-vm'
import type { CurrentKxzRuntimeData } from './antibot-data'

type CurrentHandler = { params: string[]; body: AstNode }
type CurrentMetadata = Record<string, any>
export interface CurrentLoginVmData {
  strings: string[]
  dispatch: number[][][]
  metadata: CurrentMetadata[]
  numbers: number[]
  handlers: CurrentHandler[]
  bytecode: Uint8Array
}
type CurrentStack = Array<unknown> & {
  Kv: () => unknown
  Kw: (...values: unknown[]) => number
  KF: (...args: number[]) => unknown[]
  Kj: (...args: number[]) => unknown[]
  CV: () => unknown
  CO: (...values: unknown[]) => number
  Cz: (...args: number[]) => unknown[]
  CW: (...args: number[]) => unknown[]
  wQ: () => unknown
  wN: (...values: unknown[]) => number
  wE: (...args: number[]) => unknown[]
  wZ: (...args: number[]) => unknown[]
}

const containsMemberProperty = (node: AstNode, properties: ReadonlySet<string>): boolean => {
  if (!node || typeof node !== 'object') return false
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier' &&
    properties.has(node.property.name)
  )
    return true
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((entry) => containsMemberProperty(entry as AstNode, properties))
      : containsMemberProperty(value as AstNode, properties),
  )
}

class CurrentSlotStore {
  V: Array<{ v: unknown }> = []

  K(index: number) {
    this.V[index] = { v: undefined }
  }

  z(index: number) {
    const slot = this.V[index]
    if (!slot) throw new ReferenceError(`current KXZ slot ${String(index)} is not allocated`)
    return slot.v
  }

  KJ(index: number, value: unknown) {
    const slot = this.V[index]
    if (!slot) throw new ReferenceError(`current KXZ slot ${String(index)} is not allocated`)
    slot.v = value
  }

  w() {
    const copy = new CurrentSlotStore()
    copy.V = this.V.slice()
    return copy
  }

  // Current login bundle aliases for the same slot store contract.
  get x() {
    return this.V
  }
  C(index: number) {
    return this.K(index)
  }
  h(index: number) {
    return this.z(index)
  }
  CE(index: number, value: unknown) {
    return this.KJ(index, value)
  }
  O() {
    return this.w()
  }
}

/** Slot store aliases used by the rotating auth bundle family. */
class AuthSlotStore {
  j: Array<{ v: unknown }> = []

  w(index: number) {
    this.j[index] = { v: undefined }
  }

  U(index: number) {
    const slot = this.j[index]
    if (!slot) throw new ReferenceError(`current login slot ${String(index)} is not allocated`)
    return slot.v
  }

  wv(index: number, value: unknown) {
    const slot = this.j[index]
    if (!slot) throw new ReferenceError(`current login slot ${String(index)} is not allocated`)
    slot.v = value
  }

  N() {
    const copy = new AuthSlotStore()
    copy.j = this.j.slice()
    return copy
  }
}

const createStack = (): CurrentStack => {
  const stack = [] as unknown as CurrentStack
  Object.defineProperties(stack, {
    Kv: { value: Array.prototype.pop },
    Kw: { value: Array.prototype.push },
    KF: { value: Array.prototype.slice },
    Kj: { value: Array.prototype.splice },
    CV: { value: Array.prototype.pop },
    CO: { value: Array.prototype.push },
    Cz: { value: Array.prototype.slice },
    CW: { value: Array.prototype.splice },
    wQ: { value: Array.prototype.pop },
    wN: { value: Array.prototype.push },
    wE: { value: Array.prototype.slice },
    wZ: { value: Array.prototype.splice },
  })
  return stack
}

class CurrentMachine {
  readonly KA = createStack()
  readonly Km = createStack()
  readonly m = createStack()
  readonly F = createStack()
  readonly C = createStack()
  readonly Kp: unknown
  readonly KH: unknown

  constructor(
    public E: number,
    public h: number,
    readonly r: CurrentSlotStore,
    thisArg: unknown,
    private readonly table: number[][][],
    private readonly program: Uint8Array,
    private readonly globalObject: Record<string, unknown>,
  ) {
    this.KH = thisArg
    this.Kp = thisArg == null ? globalObject : Object(thisArg)
  }

  G() {
    const opcode = this.program[this.E]
    const instruction = opcode === undefined ? undefined : this.table[this.h]?.[opcode]
    if (!instruction) throw new Error(`current KXZ dispatch miss at ${this.h}:${this.E}`)
    this.E++
    ;(this as { h: number }).h = instruction[0]!
    return instruction[1]!
  }
}

class CurrentLoginMachine {
  readonly CD = createStack()
  readonly Cy = createStack()
  readonly y = createStack()
  readonly z = createStack()
  readonly U = createStack()
  readonly CR: unknown
  readonly CG: unknown

  constructor(
    public t: number,
    public Y: number,
    public s: CurrentSlotStore,
    thisArg: unknown,
    private readonly table: number[][][],
    private readonly program: Uint8Array,
    private readonly globalObject: Record<string, unknown>,
  ) {
    this.CG = thisArg
    this.CR = thisArg == null ? globalObject : Object(thisArg)
  }

  Q() {
    const opcode = this.program[this.t]
    const instruction = opcode === undefined ? undefined : this.table[this.Y]?.[opcode]
    if (!instruction) throw new Error(`current login dispatch miss at ${this.Y}:${this.t}`)
    this.t++
    this.Y = instruction[0]!
    return instruction[1]!
  }
}

/** Machine contract emitted by the current auth/login obfuscator family. */
class AuthLoginMachine {
  readonly ws = createStack()
  readonly wt = createStack()
  readonly t = createStack()
  readonly E = createStack()
  readonly W = createStack()
  readonly wq: unknown
  readonly wh: unknown

  constructor(
    public A: number,
    public Y: number,
    readonly V: AuthSlotStore,
    thisArg: unknown,
    private readonly table: number[][][],
    private readonly program: Uint8Array,
    private readonly globalObject: Record<string, unknown>,
  ) {
    this.wh = thisArg
    this.wq = thisArg == null ? globalObject : Object(thisArg)
  }

  M() {
    const opcode = this.program[this.A]
    const instruction = opcode === undefined ? undefined : this.table[this.Y]?.[opcode]
    if (!instruction) throw new Error(`current auth login dispatch miss at ${this.Y}:${this.A}`)
    this.A++
    this.Y = instruction[0]!
    return instruction[1]!
  }
}

const decodeBase64 = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'))

const makeRealmPrimitives = (globalObject: Record<string, unknown>) => {
  const realm = <T>(name: string, fallback: T): T =>
    name in globalObject ? (globalObject[name] as T) : fallback
  const ME = realm('ReferenceError', ReferenceError)
  const Mu = realm('TypeError', TypeError)
  const MY = realm('Object', Object)
  const MQ = realm('RegExp', RegExp)
  const Mz = realm('Number', Number)
  const MF = realm('String', String)
  const MP = realm('Array', Array)
  const Mp = (MY as any).bind
  const Mt = (MY as any).call
  const MN = Mt.bind(Mp, Mt)
  const k = (MY as any).apply
  const Ms = MN(k)
  const l = (MP as any).prototype.push
  const a = (MP as any).prototype.pop
  const g = (MP as any).prototype.slice
  const G = (MP as any).prototype.splice
  const c = (MP as any).prototype.join
  const R = (MP as any).prototype.map
  const r = MN(l)
  const w = MN(g)
  const f = MN(c)
  const v = MN(R)
  const h = (MY as any).prototype.hasOwnProperty
  const U = MN(h)
  const O = (realm('JSON', JSON) as any).stringify
  const e = (MY as any).getOwnPropertyDescriptor
  const Mo = (MY as any).defineProperty
  const MM = (MF as any).fromCharCode
  const I = (realm('Math', Math) as any).min
  const MB = (realm('Math', Math) as any).floor
  const Mm = (MY as any).create
  const s = (MF as any).prototype.indexOf
  const K = (MF as any).prototype.charAt
  const q = MN(s)
  const Md = MN(K)
  const Mw = realm('Uint8Array', Uint8Array)
  const b = [
    ME,
    Mu,
    MY,
    MQ,
    Mz,
    MF,
    MP,
    Mp,
    Mt,
    k,
    l,
    a,
    g,
    G,
    c,
    R,
    h,
    O,
    e,
    Mo,
    MM,
    I,
    MB,
    Mm,
    s,
    K,
    Mw,
  ]
  const values: Record<string, unknown> = {
    ME,
    Mu,
    MY,
    MQ,
    Mz,
    MF,
    MP,
    Mp,
    Mt,
    k,
    Ms,
    l,
    a,
    g,
    G,
    c,
    R,
    r,
    w,
    f,
    v,
    h,
    U,
    O,
    e,
    Mo,
    MM,
    I,
    MB,
    Mm,
    s,
    K,
    q,
    Md,
    Mw,
    b,
    Object: MY,
    Array: MP,
    String: MF,
    Number: Mz,
    RegExp: MQ,
    TypeError: Mu,
    ReferenceError: ME,
    Math: realm('Math', Math),
    JSON: realm('JSON', JSON),
    Reflect: realm('Reflect', Reflect),
    Uint8Array: Mw,
    parseInt: realm('parseInt', parseInt),
    parseFloat: realm('parseFloat', parseFloat),
    isNaN: realm('isNaN', isNaN),
    isFinite: realm('isFinite', isFinite),
  }
  return values
}

const makeLoginRealmPrimitives = (globalObject: Record<string, unknown>) => {
  const realm = <T>(name: string, fallback: T): T =>
    name in globalObject ? (globalObject[name] as T) : fallback
  const ot = realm('ReferenceError', ReferenceError)
  const oQ = realm('TypeError', TypeError)
  const oB = realm('Object', Object)
  const ow = realm('RegExp', RegExp)
  const ov = realm('Number', Number)
  const oS = realm('String', String)
  const oO = realm('Array', Array)
  const oZ = (oB as any).bind
  const oh = (oB as any).call
  const oq = oh.bind(oZ, oh)
  const d = (oB as any).apply
  const of = oq(d)
  const g = (oO as any).prototype.push
  const s = (oO as any).prototype.pop
  const U = (oO as any).prototype.slice
  const l = (oO as any).prototype.splice
  const M = (oO as any).prototype.join
  const c = (oO as any).prototype.map
  const H = oq(g)
  const r = oq(U)
  const u = oq(M)
  const i = oq(c)
  const n = (oB as any).prototype.hasOwnProperty
  const a = oq(n)
  const z = (realm('JSON', JSON) as any).stringify
  const G = (oB as any).getOwnPropertyDescriptor
  const oF = (oB as any).defineProperty
  const oy = (oS as any).fromCharCode
  const e = (realm('Math', Math) as any).min
  const oI = (realm('Math', Math) as any).floor
  const oY = (oB as any).create
  const f = (oS as any).prototype.indexOf
  const A = (oS as any).prototype.charAt
  const C = oq(f)
  const ox = oq(A)
  const or = realm('Uint8Array', Uint8Array)
  return {
    ot,
    oQ,
    oB,
    ow,
    ov,
    oS,
    oO,
    oZ,
    oh,
    d,
    of,
    g,
    s,
    U,
    l,
    M,
    c,
    H,
    r,
    u,
    i,
    n,
    a,
    z,
    G,
    oF,
    oy,
    e,
    oI,
    oY,
    f,
    A,
    C,
    ox,
    or,
    W: [
      ot,
      oQ,
      oB,
      ow,
      ov,
      oS,
      oO,
      oZ,
      oh,
      d,
      g,
      s,
      U,
      l,
      M,
      c,
      n,
      z,
      G,
      oF,
      oy,
      e,
      oI,
      oY,
      f,
      A,
      or,
    ],
    Object: oB,
    Array: oO,
    String: oS,
    Number: ov,
    RegExp: ow,
    TypeError: oQ,
    ReferenceError: ot,
    Math: realm('Math', Math),
    JSON: realm('JSON', JSON),
    Reflect: realm('Reflect', Reflect),
    Uint8Array: or,
    parseInt: realm('parseInt', parseInt),
    parseFloat: realm('parseFloat', parseFloat),
    isNaN: realm('isNaN', isNaN),
    isFinite: realm('isFinite', isFinite),
  } as Record<string, unknown>
}

const makeAuthRealmPrimitives = (globalObject: Record<string, unknown>) => {
  const realm = <T>(name: string, fallback: T): T =>
    name in globalObject ? (globalObject[name] as T) : fallback
  const SW = realm('ReferenceError', ReferenceError)
  const Sj = realm('TypeError', TypeError)
  const SJ = realm('Object', Object)
  const Sg = realm('RegExp', RegExp)
  const SK = realm('Number', Number)
  const SL = realm('String', String)
  const Sr = realm('Array', Array)
  const SM = (SJ as any).bind
  const SO = (SJ as any).call
  const SX = SO.bind(SM, SO)
  const Q = (SJ as any).apply
  const Sw = SX(Q)
  const Y = (Sr as any).prototype.push
  const V = (Sr as any).prototype.pop
  const l = (Sr as any).prototype.slice
  const R = (Sr as any).prototype.splice
  const F = (Sr as any).prototype.join
  const z = (Sr as any).prototype.map
  const G = SX(Y)
  const t = SX(l)
  const N = SX(F)
  const k = SX(z)
  const b = (SJ as any).prototype.hasOwnProperty
  const B = SX(b)
  const c = (realm('JSON', JSON) as any).stringify
  const m = (SJ as any).getOwnPropertyDescriptor
  const SH = (SJ as any).defineProperty
  const SS = (SL as any).fromCharCode
  const P = (realm('Math', Math) as any).min
  const SU = (realm('Math', Math) as any).floor
  const So = (SJ as any).create
  const w = (SL as any).prototype.indexOf
  const q = (SL as any).prototype.charAt
  const p = SX(w)
  const Sf = SX(q)
  const St = realm('Uint8Array', Uint8Array)
  return {
    SW,
    Sj,
    SJ,
    Sg,
    SK,
    SL,
    Sr,
    SM,
    SO,
    SX,
    Q,
    Sw,
    Y,
    V,
    l,
    R,
    F,
    z,
    G,
    t,
    N,
    k,
    b,
    B,
    c,
    m,
    SH,
    SS,
    P,
    SU,
    So,
    w,
    q,
    p,
    Sf,
    St,
    T: [
      SW,
      Sj,
      SJ,
      Sg,
      SK,
      SL,
      Sr,
      SM,
      SO,
      Q,
      Y,
      V,
      l,
      R,
      F,
      z,
      b,
      c,
      m,
      SH,
      SS,
      P,
      SU,
      So,
      w,
      q,
      St,
    ],
    Object: SJ,
    Array: Sr,
    String: SL,
    Number: SK,
    RegExp: Sg,
    TypeError: Sj,
    ReferenceError: SW,
    Math: realm('Math', Math),
    JSON: realm('JSON', JSON),
    Reflect: realm('Reflect', Reflect),
    Uint8Array: St,
    parseInt: realm('parseInt', parseInt),
    parseFloat: realm('parseFloat', parseFloat),
    isNaN: realm('isNaN', isNaN),
    isFinite: realm('isFinite', isFinite),
  } as Record<string, unknown>
}

const declareBrowserGlobals = (environment: Environment, globalObject: Record<string, unknown>) => {
  const names = [
    'window',
    'self',
    'globalThis',
    'global',
    'document',
    'navigator',
    'location',
    'screen',
    'performance',
    'crypto',
    'console',
    'Worker',
    'Blob',
    'URL',
    'XMLHttpRequest',
    'FormData',
    'Request',
    'Headers',
    'Response',
    'Event',
    'CustomEvent',
    'MutationObserver',
    'HTMLFormElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'OffscreenCanvas',
    'ImageData',
    'WebGLRenderingContext',
    'WebGL2RenderingContext',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ]
  for (const name of names) {
    if (name in globalObject) environment.declare(name, globalObject[name])
  }
  for (const name of Object.keys(globalObject))
    if (!environment.has(name)) environment.declare(name, globalObject[name])
}

const decodeMr = (value: string): Uint8Array => decodeBase64(value)

export interface CurrentKxzVmEvent {
  type: string
  detail: unknown
}

export interface CurrentKxzVmOptions {
  /** Runtime-extracted contract for the fetched KXZ bundle. */
  data?: CurrentKxzRuntimeData
  bootstrapInit?: readonly unknown[]
  onEvent?: (event: CurrentKxzVmEvent) => void
  onExchange?: (event: CurrentKxzVmEvent) => unknown
  throwOnHandlerError?: boolean
  onHandler?: (index: number, machine: unknown) => void
}

export interface CurrentKxzVmRuntime {
  run(): void
  events(): readonly CurrentKxzVmEvent[]
  close(): void
}

/** Executes runtime-extracted current KXZ bytecode with a TypeScript dispatcher. */
export const createStarbucksCurrentPureKxzVm = (
  globalObject: Record<string, unknown>,
  options: CurrentKxzVmOptions = {},
): CurrentKxzVmRuntime => {
  if (!options.data)
    throw new Error('current KXZ VM data is required; extract it from the fetched bundle')
  const { strings, dispatch, metadata, numbers, handlers, bytecode, primitiveNames } = options.data
  const events: CurrentKxzVmEvent[] = []
  const originalDispatchEvent = globalObject.dispatchEvent
  if (typeof originalDispatchEvent === 'function') {
    globalObject.dispatchEvent = function (this: unknown, event: any) {
      if (!event || typeof event.type !== 'string')
        throw new TypeError('current KXZ dispatchEvent received an invalid event')
      const observed = { type: event.type, detail: event.detail } satisfies CurrentKxzVmEvent
      events.push(observed)
      options.onEvent?.(observed)
      if (options.bootstrapInit && event.detail && typeof event.detail.init === 'function')
        Reflect.apply(event.detail.init, event.detail, [...options.bootstrapInit])
      if (options.onExchange && event.detail && typeof event.detail.exchange === 'function') {
        const value = options.onExchange(observed)
        if (value !== undefined) Reflect.apply(event.detail.exchange, event.detail, [value])
      }
      const receiver = this === undefined || this === null ? globalObject : this
      return Reflect.apply(originalDispatchEvent as Function, receiver, [event])
    }
  }

  const root = new Environment(undefined, undefined, globalObject)
  const primitives = makeRealmPrimitives(globalObject)
  for (const [name, value] of Object.entries(primitives)) root.declare(name, value)
  root.declare('X', globalObject)
  root.declare('C', 0)
  root.declare('S', 0)
  root.declare('i', [0, 1, 2, 3])
  root.declare('j', strings)
  root.declare('Mj', dispatch)
  root.declare('Mi', metadata)
  root.declare('Mn', numbers)
  root.declare('N', Object.create(null))
  const Mh = {}
  const Mg = {}
  root.declare('Mh', Mh)
  root.declare('Mg', Mg)
  root.declare('MK', Mg)
  root.declare('J', bytecode)
  root.declare('Mr', decodeMr)
  root.declare('Ml', CurrentSlotStore)
  root.declare('Mk', CurrentMachine)
  // The vendor IIFE is named `t`; opcode 55 pushes that name as a callable
  // value. A stable wrapper preserves the observable function identity
  // without evaluating the source IIFE.
  root.declare('t', function currentKxzWrapper() {})
  declareBrowserGlobals(root, globalObject)
  // The extracted `b` array is source-order sensitive. It is declared above
  // from the same realm primitives and remains available to every handler.
  for (const [index, name] of primitiveNames.entries()) {
    if (!root.has(name)) throw new Error(`current KXZ primitive ${name} is unavailable at ${index}`)
  }

  let runMachine: (machine: CurrentMachine) => unknown
  const A = (
    d: number,
    u: number,
    slots: CurrentSlotStore,
    allocatedSlots: readonly number[],
    argumentSlots: readonly number[],
    hasArguments: unknown,
    argumentsSlot: unknown,
  ) => {
    const argumentCount = argumentSlots.length
    const fn = function (this: unknown, ...args: unknown[]) {
      const copied = slots.w()
      const machine = new CurrentMachine(d, u, copied, this, machineTable, bytecode, globalObject)
      if (hasArguments) {
        copied.K(argumentsSlot as any)
        copied.KJ(argumentsSlot as any, args)
      }
      for (const slot of allocatedSlots) copied.K(slot)
      const count = Math.min(args.length, argumentCount)
      for (let index = 0; index < count; index++) copied.KJ(argumentSlots[index]!, args[index])
      for (let index = count; index < argumentCount; index++)
        copied.KJ(argumentSlots[index]!, undefined)
      return runMachine(machine)
    }
    return fn
  }

  const T = (
    d: number,
    u: number,
    parent: CurrentSlotStore | null,
    allocatedSlots: readonly number[],
    copiedSlots: readonly number[],
    argumentSlots: readonly number[],
    argumentsSlot: unknown,
    selfSlot: unknown,
  ) => {
    const slots = new CurrentSlotStore()
    for (const slot of copiedSlots) {
      if (!parent) throw new ReferenceError(`current KXZ parent slot ${String(slot)} is missing`)
      slots.V[slot] = parent.V[slot]!
    }
    const fn = A(
      d,
      u,
      slots,
      allocatedSlots,
      argumentSlots,
      argumentsSlot !== undefined,
      argumentsSlot,
    )
    if (selfSlot !== undefined) {
      slots.K(selfSlot as any)
      slots.KJ(selfSlot as any, fn)
    }
    return fn
  }

  const H = (index: number, d: number, u: number, p: CurrentSlotStore) => {
    const entry = metadata[index]
    if (!entry) throw new Error(`current KXZ metadata ${index} is missing`)
    return T(d, u, p, entry.t ?? [], entry.O ?? [], entry.i ?? [], entry.U, entry.S)
  }
  root.declare('A', A)
  root.declare('T', T)
  root.declare('H', H)

  const runHandler = (index: number, machine: CurrentMachine) => {
    const handler = handlers[index]
    if (!handler) throw new Error(`current KXZ handler ${index} is missing`)
    options.onHandler?.(index, machine)
    const environment = new Environment(root, undefined, globalObject)
    for (const [position, name] of handler.params.entries())
      environment.declare(name, position === 0 ? machine : undefined)
    environment.declare('arguments', [machine])
    let result: unknown
    try {
      result = execute(handler.body, environment)
    } catch (error) {
      if (error instanceof Error)
        throw new Error(`current KXZ handler ${index}: ${error.message}`, { cause: error })
      throw error
    }
    return result instanceof ReturnSignal ? result.value : undefined
  }

  const machineTable = dispatch
  const createEntry = () => {
    const slots = new CurrentSlotStore()
    return A(0, 0, slots, [0, 1, 2, 3], [], false, undefined)
  }

  runMachine = (machine: CurrentMachine): unknown => {
    for (;;) {
      const marker = root.get('MK')
      if (marker !== Mg) {
        root.set('MK', Mg)
        return marker
      }
      const index = machine.G()
      const invoke = () => runHandler(index, machine)
      if (machine.F.length === 0) invoke()
      else {
        try {
          invoke()
        } catch (error) {
          const frame = machine.F.Kv() as any
          for (let position = 0; position < frame.B; position++) {
            const value = machine.Km.Kv() as any
            if (value?.N) machine.m.Kv()
          }
          machine.Km.Kw({ N: true })
          machine.m.Kw(error)
          machine.E = frame.J
          machine.h = frame.o
        }
      }
    }
  }

  return {
    run() {
      const entry = createEntry()
      entry()
    },
    events() {
      return events.slice()
    },
    close() {
      if (typeof originalDispatchEvent === 'function')
        globalObject.dispatchEvent = originalDispatchEvent
    },
  }
}

export interface CurrentLoginVmOptions {
  /** Runtime-extracted contract for the fetched login bundle. */
  data?: CurrentLoginVmData
  bootstrapEvent?: { type: string; detail: unknown }
  loginEntry?: { v: number; w: number; initialSlotIndices?: readonly number[] }
  onEvent?: (event: CurrentKxzVmEvent) => void
  onHandler?: (index: number, machine: unknown) => void
}

/** Executes a runtime-extracted login inline bundle with its TypeScript VM. */
export const createStarbucksCurrentPureLoginVm = (
  globalObject: Record<string, unknown>,
  options: CurrentLoginVmOptions = {},
): CurrentKxzVmRuntime => {
  if (!options.data)
    throw new Error('current login VM data is required; extract it from the fetched bundle')
  const {
    strings: loginStrings,
    dispatch: loginDispatch,
    metadata: loginMetadata,
    numbers: loginNumbers,
    handlers: loginHandlers,
    bytecode: loginBytecode,
  } = options.data
  const loginUsesAuthMachine = loginHandlers.some((handler) =>
    containsMemberProperty(handler.body, new Set(['ws', 'wt', 'wq', 'wv'])),
  )
  const events: CurrentKxzVmEvent[] = []
  const originalDispatchEvent = globalObject.dispatchEvent
  const on = {}
  const oU = {}
  let runMachine: (machine: CurrentLoginMachine | AuthLoginMachine) => unknown
  if (typeof originalDispatchEvent === 'function') {
    globalObject.dispatchEvent = function (this: unknown, event: any) {
      if (!event || typeof event.type !== 'string')
        throw new TypeError('current login dispatchEvent received an invalid event')
      const observed = { type: event.type, detail: event.detail } satisfies CurrentKxzVmEvent
      events.push(observed)
      options.onEvent?.(observed)
      const receiver = this === undefined || this === null ? globalObject : this
      return Reflect.apply(originalDispatchEvent as Function, receiver, [event])
    }
  }

  const root = new Environment(undefined, undefined, globalObject)
  const primitives = loginUsesAuthMachine
    ? makeAuthRealmPrimitives(globalObject)
    : makeLoginRealmPrimitives(globalObject)
  for (const [name, value] of Object.entries(primitives)) root.declare(name, value)
  root.declare('P', globalObject)
  root.declare('j', options.loginEntry?.v ?? 0)
  root.declare('m', options.loginEntry?.w ?? 0)
  root.declare(
    'X',
    loginUsesAuthMachine ? Object.create(null) : (options.loginEntry?.initialSlotIndices ?? []),
  )
  root.declare('E', loginUsesAuthMachine ? (options.loginEntry?.v ?? 0) : loginStrings)
  root.declare('oE', loginDispatch)
  root.declare('oo', loginMetadata)
  root.declare('oK', loginNumbers)
  root.declare('q', Object.create(null))
  root.declare('R', loginBytecode)
  root.declare('oH', decodeBase64)
  root.declare('og', CurrentSlotStore)
  root.declare('od', CurrentLoginMachine)
  root.declare('oU', oU)
  root.declare('on', on)
  root.declare('oA', oU)
  root.declare('y', function currentLoginWrapper() {})
  if (loginUsesAuthMachine) {
    root.declare('v', globalObject)
    root.declare('Sb', Object.create(null))
    root.declare('A', loginBytecode)
    root.declare('C', loginStrings)
    root.declare('SC', loginDispatch)
    root.declare('Sa', loginMetadata)
    root.declare('Ss', loginNumbers)
    root.declare('SR', loginHandlers)
    root.declare('D', undefined)
    root.declare('SG', decodeBase64)
    root.declare('SH', Object.defineProperty)
    root.declare('SJ', Object)
    root.declare('SK', Number)
    root.declare('SS', String.fromCharCode)
    root.declare('SW', ReferenceError)
    root.declare('Sq', oU)
    root.declare('Sl', oU)
  }
  declareBrowserGlobals(root, globalObject)

  const J = (
    start: number,
    state: number,
    parent: CurrentSlotStore | null,
    allocatedSlots: readonly number[],
    copiedSlots: readonly number[],
    argumentSlots: readonly number[],
    captureSlot: unknown,
    returnSlot: unknown,
  ) => {
    const slots = new CurrentSlotStore()
    for (const slot of copiedSlots) {
      if (!parent) throw new ReferenceError(`current login parent slot ${String(slot)} is missing`)
      slots.x[slot] = parent.x[slot]!
    }
    const fn = A(
      start,
      state,
      slots,
      allocatedSlots,
      argumentSlots,
      captureSlot !== undefined,
      captureSlot,
    )
    if (returnSlot !== undefined) {
      slots.C(Number(returnSlot))
      slots.CE(Number(returnSlot), fn)
    }
    return fn
  }

  const authJ = (
    start: number,
    state: number,
    parent: AuthSlotStore | null,
    allocatedSlots: readonly number[],
    copiedSlots: readonly number[],
    argumentSlots: readonly number[],
    captureSlot: unknown,
    returnSlot: unknown,
  ) => {
    const slots = new AuthSlotStore()
    for (const slot of copiedSlots) {
      if (!parent)
        throw new ReferenceError(`current auth login parent slot ${String(slot)} is missing`)
      slots.j[slot] = parent.j[slot]!
    }
    const fn = A(
      start,
      state,
      slots,
      allocatedSlots,
      argumentSlots,
      captureSlot !== undefined,
      captureSlot,
    )
    if (returnSlot !== undefined) {
      slots.w(Number(returnSlot))
      slots.wv(Number(returnSlot), fn)
    }
    return fn
  }

  const A = (
    start: number,
    state: number,
    slots: CurrentSlotStore | AuthSlotStore,
    allocatedSlots: readonly number[],
    argumentSlots: readonly number[],
    hasArguments: boolean,
    argumentsSlot: unknown,
  ) => {
    const argumentCount = argumentSlots.length
    return function (this: unknown, ...args: unknown[]) {
      const copied = loginUsesAuthMachine
        ? (slots as AuthSlotStore).N()
        : (slots as CurrentSlotStore).O()
      const machine = loginUsesAuthMachine
        ? new AuthLoginMachine(
            start,
            state,
            copied as AuthSlotStore,
            this,
            loginDispatch,
            loginBytecode,
            globalObject,
          )
        : new CurrentLoginMachine(
            start,
            state,
            copied as CurrentSlotStore,
            this,
            loginDispatch,
            loginBytecode,
            globalObject,
          )
      if (hasArguments) {
        if (loginUsesAuthMachine) {
          ;(copied as AuthSlotStore).w(Number(argumentsSlot))
          ;(copied as AuthSlotStore).wv(Number(argumentsSlot), args)
        } else {
          ;(copied as CurrentSlotStore).C(Number(argumentsSlot))
          ;(copied as CurrentSlotStore).CE(Number(argumentsSlot), args)
        }
      }
      for (const slot of allocatedSlots) {
        if (loginUsesAuthMachine) (copied as AuthSlotStore).w(slot)
        else (copied as CurrentSlotStore).C(slot)
      }
      const count = Math.min(args.length, argumentCount)
      for (let index = 0; index < count; index++) {
        if (loginUsesAuthMachine) (copied as AuthSlotStore).wv(argumentSlots[index]!, args[index])
        else (copied as CurrentSlotStore).CE(argumentSlots[index]!, args[index])
      }
      for (let index = count; index < argumentCount; index++) {
        if (loginUsesAuthMachine) (copied as AuthSlotStore).wv(argumentSlots[index]!, undefined)
        else (copied as CurrentSlotStore).CE(argumentSlots[index]!, undefined)
      }
      return runMachine(machine)
    }
  }

  const p = (index: number, start: number, state: number, parent: CurrentSlotStore) => {
    const entry = loginMetadata[index]
    if (!entry) throw new Error(`current login metadata ${String(index)} is missing`)
    return J(start, state, parent, entry.a ?? [], entry.l ?? [], entry.T ?? [], entry.X, entry.m)
  }
  const authP = (index: number, start: number, state: number, parent: AuthSlotStore) => {
    const entry = loginMetadata[index]
    if (!entry) throw new Error(`current auth login metadata ${String(index)} is missing`)
    return authJ(
      start,
      state,
      parent,
      entry.k ?? [],
      entry.x ?? [],
      entry.X ?? [],
      entry.F,
      entry.o,
    )
  }
  root.declare('J', J)
  root.declare('k', A)
  root.declare('p', loginUsesAuthMachine ? authP : p)
  root.set('D', loginUsesAuthMachine ? authP : p)

  const runHandler = (index: number, machine: CurrentLoginMachine | AuthLoginMachine) => {
    const handler = loginHandlers[index]
    if (!handler) throw new Error(`current login handler ${index} is missing`)
    options.onHandler?.(index, machine)
    const environment = new Environment(root, undefined, globalObject)
    for (const [position, name] of handler.params.entries())
      environment.declare(name, position === 0 ? machine : undefined)
    environment.declare('arguments', [machine])
    try {
      const result = execute(handler.body, environment)
      return result instanceof ReturnSignal ? result.value : undefined
    } catch (error) {
      if (error instanceof Error)
        throw new Error(`current login handler ${index}: ${error.message}`, { cause: error })
      throw error
    }
  }

  runMachine = (machine) => {
    for (;;) {
      const marker = loginUsesAuthMachine ? root.get('Sq') : root.get('oA')
      const sentinel = loginUsesAuthMachine ? root.get('Sl') : oU
      if (marker !== sentinel) {
        root.set(loginUsesAuthMachine ? 'Sq' : 'oA', sentinel)
        return marker
      }
      const index = loginUsesAuthMachine
        ? (machine as AuthLoginMachine).M()
        : (machine as CurrentLoginMachine).Q()
      const invoke = () => runHandler(index, machine)
      if (loginUsesAuthMachine) {
        const authMachine = machine as AuthLoginMachine
        if (authMachine.E.length === 0) invoke()
        else {
          try {
            invoke()
          } catch (error) {
            const frame = authMachine.E.wQ() as any
            for (let position = 0; position < frame.i; position++) {
              const value = authMachine.wt.wQ() as any
              if (value?.T) authMachine.t.wQ()
            }
            authMachine.wt.wN({ T: true })
            authMachine.t.wN(error)
            authMachine.A = frame.v
            authMachine.Y = frame.K
          }
        }
      } else if ((machine as CurrentLoginMachine).z.length === 0) invoke()
      else {
        const legacyMachine = machine as CurrentLoginMachine
        try {
          invoke()
        } catch (error) {
          const frame = legacyMachine.z.CV() as any
          for (let position = 0; position < frame.P; position++) {
            const value = legacyMachine.Cy.CV() as any
            if (value?.w) legacyMachine.y.CV()
          }
          legacyMachine.Cy.CO({ w: true })
          legacyMachine.y.CO(error)
          legacyMachine.t = frame.E
          legacyMachine.Y = frame.g
        }
      }
    }
  }

  return {
    run() {
      const entry = loginUsesAuthMachine
        ? authJ(0, 0, null, [], [], [], undefined, undefined)
        : J(0, 0, null, [], [], [], undefined, undefined)
      entry()
      if (options.bootstrapEvent) {
        const CustomEventCtor = globalObject.CustomEvent
        if (typeof CustomEventCtor !== 'function')
          throw new Error('current login VM requires CustomEvent')
        const event = Reflect.construct(CustomEventCtor, [
          options.bootstrapEvent.type,
          {
            detail: options.bootstrapEvent.detail,
          },
        ])
        Reflect.apply(globalObject.dispatchEvent as Function, globalObject, [event])
      }
    },
    events() {
      return events.slice()
    },
    close() {
      if (typeof originalDispatchEvent === 'function')
        globalObject.dispatchEvent = originalDispatchEvent
    },
  }
}
