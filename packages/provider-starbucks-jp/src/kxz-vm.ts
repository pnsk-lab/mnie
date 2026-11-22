import {
  createStarbucksWasmDispatcher,
  createStarbucksWasmTable,
  type StarbucksWasmDispatcher,
} from './wasm-lite'

/**
 * TypeScript implementation of the tiny JavaScript VM used by KXZ bundles.
 * Runtime extraction supplies the rotating constants, function metadata,
 * opcode bodies, WASM bytes, and memory image; expression/statement semantics
 * live in this file.
 */

export type AstNode = Record<string, any>
export type AstFunction = { params: string[]; body: AstNode }
type VmVariant = 'kxz' | 'login'
type StringTableEntry = string | { type?: string; value?: unknown }

export const decodeStaticLiteral = (node: any): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (node.type === 'Literal') return node.value
  if (node.type === 'ArrayExpression')
    return (node.elements ?? []).map((element: unknown) => decodeStaticLiteral(element))
  if (node.type === 'ObjectExpression') {
    const result: Record<string, unknown> = {}
    for (const property of node.properties ?? []) {
      const key = property.key?.name ?? property.key?.value
      if (typeof key === 'string') result[key] = decodeStaticLiteral(property.value)
    }
    return result
  }
  return node
}

export interface StarbucksPureKxzVmData {
  strings: StringTableEntry[]
  metadata: Record<string, any>[]
  handlers: AstFunction[]
  dispatchWasm: Uint8Array
  tableWasm: Uint8Array
  memory: Uint8Array
}

const variantData = (variant: VmVariant, supplied: StarbucksPureKxzVmData) => ({
  strings: supplied.strings,
  metadata: supplied.metadata,
  handlers: supplied.handlers,
  stringName: variant === 'kxz' ? 'd' : 'O',
  metadataName: variant === 'kxz' ? 'iA' : 'uG',
})

export class ReturnSignal {
  constructor(readonly value: unknown) {}
}
export class BreakSignal {
  constructor(readonly label?: string) {}
}

export class Environment {
  readonly values = new Map<string, unknown>()
  constructor(
    readonly parent?: Environment,
    readonly thisValue?: unknown,
    readonly globalThisValue: unknown = parent?.globalThisValue ?? thisValue,
  ) {}

  has(name: string): boolean {
    return this.values.has(name) || Boolean(this.parent?.has(name))
  }

  get(name: string): unknown {
    if (this.values.has(name)) return this.values.get(name)
    if (this.parent) return this.parent.get(name)
    if (name === 'undefined') return undefined
    throw new ReferenceError(`${name} is not defined`)
  }

  set(name: string, value: unknown): unknown {
    if (this.values.has(name)) {
      this.values.set(name, value)
      return value
    }
    if (this.parent?.has(name)) return this.parent.set(name, value)
    this.values.set(name, value)
    return value
  }

  declare(name: string, value: unknown): unknown {
    this.values.set(name, value)
    return value
  }
}

interface Reference {
  get(): unknown
  set(value: unknown): unknown
  thisValue?: unknown
}

const propertyKey = (value: unknown) => (typeof value === 'symbol' ? value : String(value))

const memberReference = (object: unknown, key: unknown): Reference => {
  if (object === null || object === undefined)
    throw new TypeError('Cannot access a property of null')
  const property = propertyKey(key)
  return {
    get: () => (object as any)[property],
    set: (value) => ((object as any)[property] = value),
    thisValue: object,
  }
}

const identifierReference = (environment: Environment, name: string): Reference => ({
  get: () => environment.get(name),
  set: (value) => environment.set(name, value),
  thisValue: environment.globalThisValue,
})

const reference = (node: AstNode, environment: Environment): Reference => {
  if (node.type === 'Identifier') return identifierReference(environment, node.name)
  if (node.type === 'MemberExpression') {
    const object = evaluate(node.object, environment)
    const key = node.computed ? evaluate(node.property, environment) : node.property.name
    return memberReference(object, key)
  }
  throw new ReferenceError(`unsupported assignment target ${node.type}`)
}

const jsBinary = (operator: string, left: any, right: any): unknown => {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
    case '%':
      return left % right
    case '**':
      return left ** right
    case '|':
      return left | right
    case '&':
      return left & right
    case '^':
      return left ^ right
    case '<<':
      return left << right
    case '>>':
      return left >> right
    case '>>>':
      return left >>> right
    case '<':
      return left < right
    case '>':
      return left > right
    case '<=':
      return left <= right
    case '>=':
      return left >= right
    case '==':
      return left == right
    case '===':
      return left === right
    case '!=':
      return left != right
    case '!==':
      return left !== right
    case 'in':
      return propertyKey(left) in Object(right)
    case 'instanceof':
      return left instanceof right
    default:
      throw new Error(`unsupported VM binary operator ${operator}`)
  }
}

export const evaluate = (node: AstNode | null | undefined, environment: Environment): unknown => {
  if (!node) return undefined
  switch (node.type) {
    case 'Identifier':
      return environment.get(node.name)
    case 'ThisExpression':
      return environment.thisValue
    case 'Literal':
      return node.value
    case 'ArrayExpression':
      return node.elements.map((element: AstNode | null) => evaluate(element, environment))
    case 'ObjectExpression': {
      const object: Record<PropertyKey, unknown> = {}
      for (const property of node.properties as AstNode[]) {
        if (property.type === 'SpreadElement')
          Object.assign(object, evaluate(property.argument, environment))
        else {
          const key = property.computed
            ? propertyKey(evaluate(property.key, environment))
            : property.key.type === 'Identifier'
              ? property.key.name
              : property.key.value
          if (property.kind === 'get')
            Object.defineProperty(object, key, {
              configurable: true,
              enumerable: true,
              get: () => evaluate(property.value.body, environment),
            })
          else if (property.kind === 'set')
            Object.defineProperty(object, key, {
              configurable: true,
              enumerable: true,
              set: () => undefined,
            })
          else object[key] = evaluate(property.value, environment)
        }
      }
      return object
    }
    case 'FunctionExpression': {
      const closure = environment
      return function (this: unknown, ...args: unknown[]) {
        const child = new Environment(closure, this)
        for (let index = 0; index < node.params.length; index++)
          child.declare(node.params[index]!.name, args[index])
        child.declare('arguments', args)
        const result = execute(node.body, child)
        return result instanceof ReturnSignal ? result.value : undefined
      }
    }
    case 'MemberExpression':
      return reference(node, environment).get()
    case 'CallExpression': {
      const callee = reference(node.callee, environment)
      const fn = callee.get()
      if (typeof fn !== 'function') {
        const calleeDescription =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.type === 'MemberExpression'
              ? `${node.callee.object.type}.${node.callee.property.type === 'Identifier' ? node.callee.property.name : node.callee.property.value}`
              : node.callee.type
        throw new TypeError(`VM attempted to call a non-function (${calleeDescription})`)
      }
      return Reflect.apply(
        fn,
        callee.thisValue,
        node.arguments.map((argument: AstNode) => evaluate(argument, environment)),
      )
    }
    case 'NewExpression': {
      const constructor = evaluate(node.callee, environment)
      if (typeof constructor !== 'function')
        throw new TypeError('VM attempted to construct a non-function')
      return Reflect.construct(
        constructor as Function,
        node.arguments.map((argument: AstNode) => evaluate(argument, environment)),
      )
    }
    case 'UnaryExpression': {
      if (
        node.operator === 'typeof' &&
        node.argument.type === 'Identifier' &&
        !environment.has(node.argument.name)
      )
        return 'undefined'
      const value = evaluate(node.argument, environment)
      switch (node.operator) {
        case 'typeof':
          return typeof value
        case 'void':
          return undefined
        case '!':
          return !value
        case '~':
          return ~(value as any)
        case '+':
          return +(value as any)
        case '-':
          return -(value as any)
        case 'delete':
          return true
        default:
          throw new Error(`unsupported VM unary operator ${node.operator}`)
      }
    }
    case 'BinaryExpression':
      return jsBinary(
        node.operator,
        evaluate(node.left, environment),
        evaluate(node.right, environment),
      )
    case 'LogicalExpression': {
      const left = evaluate(node.left, environment)
      if (node.operator === '&&') return left && evaluate(node.right, environment)
      if (node.operator === '||') return left || evaluate(node.right, environment)
      if (node.operator === '??') return left ?? evaluate(node.right, environment)
      throw new Error(`unsupported VM logical operator ${node.operator}`)
    }
    case 'ConditionalExpression':
      return evaluate(
        evaluate(node.test, environment) ? node.consequent : node.alternate,
        environment,
      )
    case 'SequenceExpression': {
      let value: unknown
      for (const expression of node.expressions as AstNode[])
        value = evaluate(expression, environment)
      return value
    }
    case 'AssignmentExpression': {
      const target = reference(node.left, environment)
      const right = evaluate(node.right, environment)
      const value =
        node.operator === '=' ? right : jsBinary(node.operator.slice(0, -1), target.get(), right)
      return target.set(value)
    }
    case 'UpdateExpression': {
      const target = reference(node.argument, environment)
      const previous = Number(target.get())
      const next = node.operator === '++' ? previous + 1 : previous - 1
      target.set(next)
      return node.prefix ? next : previous
    }
    case 'AwaitExpression':
      return evaluate(node.argument, environment)
    default:
      throw new Error(`unsupported VM expression ${node.type}`)
  }
}

export const execute = (node: AstNode, environment: Environment): unknown => {
  switch (node.type) {
    case 'BlockStatement':
      for (const statement of node.body as AstNode[]) {
        const result = execute(statement, environment)
        if (result instanceof ReturnSignal || result instanceof BreakSignal) return result
      }
      return undefined
    case 'ExpressionStatement':
      return evaluate(node.expression, environment)
    case 'VariableDeclaration':
      for (const declaration of node.declarations as AstNode[])
        environment.declare(declaration.id.name, evaluate(declaration.init, environment))
      return undefined
    case 'ReturnStatement':
      return new ReturnSignal(evaluate(node.argument, environment))
    case 'IfStatement':
      if (evaluate(node.test, environment)) return execute(node.consequent, environment)
      return node.alternate ? execute(node.alternate, environment) : undefined
    case 'ForStatement': {
      if (node.init) execute(node.init, environment)
      for (;;) {
        if (node.test && !evaluate(node.test, environment)) break
        const result = execute(node.body, environment)
        if (result instanceof ReturnSignal) return result
        if (result instanceof BreakSignal) {
          if (!result.label) break
          return result
        }
        if (node.update) evaluate(node.update, environment)
      }
      return undefined
    }
    case 'ForInStatement': {
      const object = evaluate(node.right, environment)
      for (const key in Object(object)) {
        if (node.left.type === 'VariableDeclaration')
          environment.declare(node.left.declarations[0]!.id.name, key)
        else reference(node.left, environment).set(key)
        const result = execute(node.body, environment)
        if (result instanceof ReturnSignal) return result
        if (result instanceof BreakSignal) {
          if (!result.label) break
          return result
        }
      }
      return undefined
    }
    case 'LabeledStatement': {
      const result = execute(node.body, environment)
      if (result instanceof BreakSignal && result.label === node.label.name) return undefined
      return result
    }
    case 'BreakStatement':
      return new BreakSignal(node.label?.name)
    case 'ThrowStatement':
      throw evaluate(node.argument, environment)
    default:
      throw new Error(`unsupported VM statement ${node.type}`)
  }
}

export class SlotStore {
  readonly slots: Array<{ v: unknown }> = []
  a(index: number) {
    this.slots[index] = { v: undefined }
  }
  O(index: number) {
    return this.a(index)
  }
  u(index: number) {
    const slot = this.slots[index]
    if (!slot) throw new ReferenceError(`KXZ VM slot ${index} is not allocated`)
    return slot.v
  }
  p(index: number) {
    return this.u(index)
  }
  aN(index: number, value: unknown) {
    const slot = this.slots[index]
    if (!slot) throw new ReferenceError(`KXZ VM slot ${index} is not allocated`)
    slot.v = value
  }
  Oe(index: number, value: unknown) {
    return this.aN(index, value)
  }
  m() {
    const copy = new SlotStore()
    copy.slots.push(...this.slots)
    return copy
  }
  X() {
    return this.m()
  }
}

class VmState {
  readonly aK: any[] = []
  readonly Z: any[] = []
  /** Login bundle aliases for the same stacks/slots used by the KXZ bundle. */
  readonly Ot = this.aK
  readonly K = this.Z
  readonly y: unknown
  readonly i: unknown
  readonly v: SlotStore
  readonly OV: unknown
  readonly Ob: unknown
  constructor(
    readonly V: unknown,
    readonly W: unknown,
    readonly q: SlotStore,
    readonly aG: Record<string, unknown>,
    readonly at: unknown,
  ) {
    this.y = V
    this.i = W
    this.v = q
    this.OV = at
    this.Ob = at
    Object.assign(this.aK, {
      as: Array.prototype.pop,
      am: Array.prototype.push,
      aP: Array.prototype.slice,
      aQ: Array.prototype.splice,
      OM: Array.prototype.pop,
      OX: Array.prototype.push,
      ON: Array.prototype.slice,
      OF: Array.prototype.splice,
    })
    Object.assign(this.Z, {
      as: Array.prototype.pop,
      am: Array.prototype.push,
      aP: Array.prototype.slice,
      aQ: Array.prototype.splice,
      OM: Array.prototype.pop,
      OX: Array.prototype.push,
      ON: Array.prototype.slice,
      OF: Array.prototype.splice,
    })
  }
}

const decodeBase64 = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))

const canonicalGlobals = (
  variant: VmVariant,
  data: ReturnType<typeof variantData>,
  state: VmState,
  thisGlobal: Record<string, unknown>,
  createVmFunction?: (
    index: number,
    parent: SlotStore | null,
    v: unknown,
    w: unknown,
    thisArg?: unknown,
  ) => Function,
  outerFunction?: Function,
) => {
  // A caller-provided Window must remain the source of truth for realm
  // objects.  Using Node's Object/Array/Date here would make instanceof,
  // constructor and error-string probes observe the wrong realm even though
  // the VM itself is TypeScript and receives only runtime-extracted data.
  const realmValue = <T>(name: string, fallback: T): T =>
    name in thisGlobal ? (thisGlobal[name] as T) : fallback
  const RealmObject = realmValue('Object', Object)
  const RealmArray = realmValue('Array', Array)
  const RealmString = realmValue('String', String)
  const RealmNumber = realmValue('Number', Number)
  const RealmRegExp = realmValue('RegExp', RegExp)
  const RealmTypeError = realmValue('TypeError', TypeError)
  const RealmReferenceError = realmValue('ReferenceError', ReferenceError)
  const RealmError = realmValue('Error', Error)
  const RealmMath = realmValue('Math', Math)
  const RealmJson = realmValue('JSON', JSON)
  const RealmReflect = realmValue('Reflect', Reflect)
  const RealmDate = realmValue('Date', Date)
  const RealmSymbol = realmValue('Symbol', Symbol)
  const RealmBigInt = realmValue('BigInt', BigInt)
  const RealmUint8Array = realmValue('Uint8Array', Uint8Array)
  const RealmUint16Array = realmValue('Uint16Array', Uint16Array)
  const RealmUint32Array = realmValue('Uint32Array', Uint32Array)
  const RealmArrayBuffer = realmValue('ArrayBuffer', ArrayBuffer)
  const RealmParseInt = realmValue('parseInt', parseInt)
  const RealmParseFloat = realmValue('parseFloat', parseFloat)
  const RealmIsNaN = realmValue('isNaN', isNaN)
  const RealmIsFinite = realmValue('isFinite', isFinite)
  // Normalize ESTree literal entries at the VM boundary instead of leaking
  // extractor representation into handlers.
  const strings = data.strings.map((entry) => (typeof entry === 'string' ? entry : entry?.value))
  const cache = Object.create(null) as Record<string, unknown>
  const apply = (fn: unknown, thisArg: unknown, args: unknown[]) =>
    RealmReflect.apply(fn as Function, thisArg, args)
  const push = (array: any[], ...values: unknown[]) =>
    RealmArray.prototype.push.apply(array, values)
  const pop = (array: any[]) => RealmArray.prototype.pop.call(array)
  const slice = (array: any[], ...args: number[]) =>
    (RealmArray.prototype.slice as any).apply(array, args)
  const splice = (array: any[], ...args: number[]) =>
    (RealmArray.prototype.splice as any).apply(array, args)
  const globals: Record<string, unknown> = {
    Object: RealmObject,
    Array: RealmArray,
    String: RealmString,
    Number: RealmNumber,
    RegExp: RealmRegExp,
    TypeError: RealmTypeError,
    ReferenceError: RealmReferenceError,
    Error: RealmError,
    Math: RealmMath,
    JSON: RealmJson,
    Reflect: RealmReflect,
    Date: RealmDate,
    Symbol: RealmSymbol,
    BigInt: RealmBigInt,
    Uint8Array: RealmUint8Array,
    Uint16Array: RealmUint16Array,
    Uint32Array: RealmUint32Array,
    ArrayBuffer: RealmArrayBuffer,
    parseInt: RealmParseInt,
    parseFloat: RealmParseFloat,
    isNaN: RealmIsNaN,
    isFinite: RealmIsFinite,
    [variant === 'kxz' ? 'd' : 'O']: strings,
    [variant === 'kxz' ? 'C' : 't']: cache,
    [variant === 'kxz' ? 'iL' : 'uD']: decodeBase64,
    [variant === 'kxz' ? 'iz' : 'uI']: RealmString.fromCharCode,
    [variant === 'kxz' ? 'ia' : 'uh']: RealmObject.defineProperty,
    [variant === 'kxz' ? 'ix' : 'uO']: RealmObject,
    [variant === 'kxz' ? 'iP' : 'uF']: RealmTypeError,
    [variant === 'kxz' ? 'id' : 'uR']: RealmReferenceError,
    [variant === 'kxz' ? 'ic' : 'uw']: RealmRegExp,
    [variant === 'kxz' ? 'iC' : 'uC']: RealmNumber,
    [variant === 'kxz' ? 'iZ' : 'uU']: apply,
    [variant === 'kxz' ? 'l' : 'X']: push,
    [variant === 'kxz' ? 'g' : 'f']: pop,
    [variant === 'kxz' ? 'N' : 'Q']: slice,
    [variant === 'kxz' ? 'X' : 'q']: splice,
    [variant === 'kxz' ? 'iU' : 'up']: thisGlobal,
    ...(variant === 'kxz'
      ? {
          U: (() => {
            if (!outerFunction) throw new Error('KXZ VM outer function is unavailable')
            return outerFunction
          })(),
        }
      : outerFunction
        ? { p: outerFunction }
        : {}),
    ...(variant === 'kxz' && createVmFunction
      ? {
          t: (index: unknown, v: unknown, w: unknown, parent: unknown) =>
            createVmFunction(Number(index), parent instanceof SlotStore ? parent : null, v, w),
        }
      : {}),
    ...(variant === 'login' && createVmFunction
      ? {
          S: (index: unknown, v: unknown, w: unknown, parent: unknown) =>
            createVmFunction(Number(index), parent instanceof SlotStore ? parent : null, v, w),
        }
      : {}),
    [variant === 'kxz' ? 'iR' : 'ua']: () => false,
    [variant === 'kxz' ? 'ii' : 'uu']: [
      RealmReferenceError,
      RealmTypeError,
      RealmObject,
      RealmRegExp,
      RealmNumber,
      RealmString,
      RealmArray,
      RealmObject.bind,
      RealmObject.call,
      RealmReflect.apply,
      push,
      pop,
      slice,
      splice,
      RealmArray.prototype.join,
      RealmArray.prototype.map,
      RealmObject.prototype.hasOwnProperty,
      RealmJson.stringify,
      RealmObject.getOwnPropertyDescriptor,
      RealmObject.defineProperty,
      RealmString.fromCharCode,
      RealmMath.min,
      RealmMath.floor,
      RealmObject.create,
      RealmString.prototype.indexOf,
      RealmString.prototype.charAt,
      RealmUint8Array,
    ],
    state,
  }
  // The browser bundle resolves host constructors both through its explicit
  // global alias and as ordinary global identifiers.  Expose the supplied
  // realm's browser surface without copying Node's process globals.
  for (const name of [
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
  ]) {
    if (!(name in globals) && name in thisGlobal) globals[name] = thisGlobal[name]
  }
  return globals
}

const runHandler = (
  variant: VmVariant,
  data: ReturnType<typeof variantData>,
  index: number,
  args: unknown[],
  state: VmState,
  thisGlobal: Record<string, unknown>,
  createVmFunction?: (
    index: number,
    parent: SlotStore | null,
    v: unknown,
    w: unknown,
    thisArg?: unknown,
  ) => Function,
  outerFunction?: Function,
) => {
  const handler = data.handlers[index]
  if (!handler) throw new Error(`KXZ handler ${index} is missing`)
  const environment = new Environment(undefined, undefined, thisGlobal)
  for (const [name, value] of Object.entries(
    canonicalGlobals(variant, data, state, thisGlobal, createVmFunction, outerFunction),
  ))
    environment.declare(name, value)
  for (let position = 0; position < handler.params.length; position++)
    environment.declare(handler.params[position]!, args[position])
  environment.declare('arguments', args)
  try {
    const result = execute(handler.body, environment)
    if (result instanceof ReturnSignal) return result.value
    return undefined
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`KXZ handler ${index}: ${error.message}`, { cause: error })
    throw error
  }
}

const createVmFunctionFactory = (
  variant: VmVariant,
  data: ReturnType<typeof variantData>,
  dispatcher: { export(name: string): (...args: any[]) => any },
  globalObject: Record<string, unknown>,
  dispatchExport = 'p',
  suppressFunctionErrors = false,
) => {
  // Generated functions are installed as DOM/native callbacks. Browser event
  // dispatch reports an exception from such a callback without aborting the
  // remaining listeners; strict mode remains available for VM diagnostics.
  const invoke = (
    v: unknown,
    w: unknown,
    copied: SlotStore,
    argumentSlots: readonly number[],
    argumentsSlot: number | undefined,
    initialSlotIndices: readonly number[],
    thisArg: unknown,
    args: unknown[],
  ) => {
    const slots = copied.m()
    if (argumentsSlot !== undefined) {
      slots.a(argumentsSlot)
      slots.aN(argumentsSlot, args)
    }
    for (const slot of initialSlotIndices) slots.a(slot)
    const count = Math.min(args.length, argumentSlots.length)
    for (let position = 0; position < count; position++)
      slots.aN(argumentSlots[position]!, args[position])
    for (let position = count; position < argumentSlots.length; position++)
      slots.aN(argumentSlots[position]!, undefined)
    const state = new VmState(v, w, slots, globalObject, thisArg)
    const result = dispatcher.export(dispatchExport)(v, w, state)
    if (result === 0) return undefined
    if (result === 1) return state.aK.pop()
    throw new Error(`KXZ VM returned unsupported status ${String(result)}`)
  }

  const create = (
    index: number,
    parent: SlotStore | null,
    v: unknown,
    w: unknown,
    thisArg?: unknown,
  ): Function => {
    const metadata = data.metadata[index]
    if (!metadata) throw new Error(`KXZ VM metadata ${index} is missing`)
    // The two vendor bundles use different minified names for the same
    // closure layout.  Keep the mapping explicit instead of treating login
    // metadata as KXZ metadata.
    const parentSlots = variant === 'login' ? (metadata.U ?? []) : (metadata.M ?? [])
    const allocatedSlots = variant === 'login' ? (metadata.L ?? []) : (metadata.U ?? [])
    const argumentSlots = variant === 'login' ? (metadata.u ?? []) : (metadata.k ?? [])
    const argumentsSlot = variant === 'login' ? metadata.A : metadata.B
    const selfSlot = variant === 'login' ? metadata.q : metadata.x
    const copied = new SlotStore()
    for (const slot of parentSlots) copied.slots[slot] = parent?.slots[slot] ?? { v: undefined }
    for (const slot of allocatedSlots) copied.a(slot)
    const fn = function (this: unknown, ...args: unknown[]) {
      try {
        return invoke(v, w, copied, argumentSlots, argumentsSlot, [], thisArg ?? this, args)
      } catch (error) {
        if (!suppressFunctionErrors) throw error
        return undefined
      }
    }
    if (selfSlot !== undefined) {
      copied.a(selfSlot)
      copied.aN(selfSlot, fn)
    }
    Object.defineProperty(fn, '__starbucksVmIndex', { value: index })
    return fn
  }

  const createEntry = (
    v: unknown,
    w: unknown,
    slotIndices: readonly number[],
    argumentSlots: readonly number[] = [],
    thisArg?: unknown,
  ): Function => {
    const copied = new SlotStore()
    const fn = function (this: unknown, ...args: unknown[]) {
      try {
        return invoke(v, w, copied, argumentSlots, undefined, slotIndices, thisArg ?? this, args)
      } catch (error) {
        if (!suppressFunctionErrors) throw error
        return undefined
      }
    }
    return fn
  }
  return { create, createEntry }
}

export interface StarbucksPureVmEvent {
  type: string
  detail: unknown
}

export interface StarbucksPureKxzVmOptions {
  /** Runtime-extracted contract. Generated vendor data is never bundled. */
  data?: StarbucksPureKxzVmData
  /** Observes the browser custom-event boundary without evaluating vendor JS. */
  onEvent?: (event: StarbucksPureVmEvent) => void
  /**
   * Literal arguments extracted from the bootstrap response.  The bootstrap
   * response normally installs a listener which calls `detail.init(...)`;
   * supplying those arguments lets the pure VM perform that bridge without
   * evaluating the bootstrap JavaScript.
   */
  bootstrapInit?: readonly unknown[]
  /** Supplies the TypeScript instrumentation payload for an exchange event. */
  onExchange?: (event: StarbucksPureVmEvent) => unknown
  /** Propagates a host-handler error instead of emulating the bundle's abort path. */
  throwOnHandlerError?: boolean
  /** Optional low-level observation hook for validating the static handler port. */
  onHandler?: (index: number, state: unknown) => void
  /**
   * Login-only entry arguments used by the bundle's Web Worker copy.  The
   * page entry uses zeroes; the worker entry is seeded with the two numeric
   * values from the captured `p(self, ..., ..., metadata)` call.  Keeping
   * these values explicit avoids evaluating the generated Blob source.
   */
  loginEntry?: { v: number; w: number; initialSlotIndices?: readonly number[] }
  /**
   * Optional static CustomEvent bridge for the login inline bundle.  The
   * second inline snippet dispatches a rotating event after the VM has
   * installed its listeners; callers may provide the parsed event rather
   * than executing that snippet.
   */
  bootstrapEvent?: { type: string; detail: unknown }
}

export interface StarbucksPureVmRuntime {
  run(): void
  events(): readonly StarbucksPureVmEvent[]
  close(): void
}

/**
 * Creates the pinned KXZ VM. The caller supplies the browser global object;
 * no vendor JavaScript source is evaluated and no WebAssembly host API is
 * used. A hash check prevents accidentally running this decoder with a
 * different rotating bundle.
 */
export const createStarbucksPureKxzVm = (
  globalObject: Record<string, unknown>,
  options: StarbucksPureKxzVmOptions = {},
): StarbucksPureVmRuntime => {
  if (!options.data) throw new Error('KXZ VM data is required; extract it from the fetched bundle')
  const data = variantData('kxz', options.data)
  const memory = new Uint8Array(3 * 65_536)
  if (options.data.memory.length > memory.length)
    throw new Error('KXZ VM memory data exceeds WASM memory')
  memory.set(options.data.memory)
  const events: StarbucksPureVmEvent[] = []
  let outerFunction: Function
  const originalDispatchEvent = globalObject.dispatchEvent
  if (typeof originalDispatchEvent === 'function') {
    globalObject.dispatchEvent = function (this: unknown, event: any) {
      if (!event || typeof event.type !== 'string')
        throw new TypeError('KXZ VM dispatchEvent received an invalid event')
      const observed = { type: event.type, detail: event.detail } satisfies StarbucksPureVmEvent
      events.push(observed)
      options.onEvent?.(observed)
      // The instrumentation/bootstrap listeners are registered before the
      // bundle dispatches its event.  Invoke these host-side bridges before
      // the real EventTarget dispatch so the VM observes the same ordering.
      if (options.bootstrapInit && event.detail && typeof event.detail.init === 'function')
        Reflect.apply(event.detail.init, event.detail, [...options.bootstrapInit])
      if (options.onExchange && event.detail && typeof event.detail.exchange === 'function') {
        const payload = options.onExchange(observed)
        if (payload !== undefined) Reflect.apply(event.detail.exchange, event.detail, [payload])
      }
      const receiver = this === undefined || this === null ? globalObject : this
      const result = Reflect.apply(originalDispatchEvent as Function, receiver, [event])
      return result
    }
  }
  let dispatcher: StarbucksWasmDispatcher
  const handler = (index: number, ...args: unknown[]) => {
    const state = args[0] as VmState
    options.onHandler?.(index, state)
    try {
      const result = runHandler(
        'kxz',
        data,
        index,
        args,
        state,
        globalObject,
        create,
        outerFunction,
      )
      return result
    } catch (error) {
      if (options.throwOnHandlerError) throw error
      dispatcher?.export('aq')()
      state.Z.push(error)
      return undefined
    }
  }
  const tableImports = Object.fromEntries(
    data.handlers.map((_, index) => [
      `L.${index}`,
      (...args: unknown[]) => handler(index, ...args),
    ]),
  )
  const table = createStarbucksWasmTable(options.data.tableWasm, tableImports as any)
  const invokeHostHandler = (state: VmState, ...args: unknown[]) => {
    const index = Number(args.at(-1))
    return handler(index, state, ...args)
  }
  dispatcher = createStarbucksWasmDispatcher(
    options.data.dispatchWasm,
    {
      'D.aE': (state, value) => {
        ;(state as VmState).aK.push(value)
        return undefined
      },
      'D.al': (state, value) => {
        ;(state as VmState).aK.push([{}, [], true, false, undefined, null, Infinity][Number(value)])
        return undefined
      },
      'D.Q': invokeHostHandler as any,
      'D.d': invokeHostHandler as any,
      'D.e': invokeHostHandler as any,
      'D.S': invokeHostHandler as any,
      'D.n': invokeHostHandler as any,
      'D.C': (state, index) => {
        ;(state as VmState).q.aN(Number(index), (state as VmState).Z.pop())
        return undefined
      },
      'D.aa': (state) => {
        throw (state as VmState).Z.pop()
      },
      'D.aB': (state, amount) => {
        const value = (state as VmState).Z.at(-1)
        ;(state as VmState).Z.splice((state as VmState).Z.length - Number(amount))
        ;(state as VmState).Z[(state as VmState).Z.length - 1] = value
        return undefined
      },
      'D.w': (state) => ((state as VmState).aK.pop() ? 1 : 0),
      'D.aC': (state) => (state as VmState).aK.pop(),
    },
    table,
    memory,
  )
  const vmFactory = createVmFunctionFactory(
    'kxz',
    data,
    dispatcher,
    globalObject,
    'p',
    !options.throwOnHandlerError,
  )
  const create = vmFactory.create
  outerFunction = function U(iU: unknown, h: unknown, W: unknown, e: unknown) {
    void iU
    const bootstrap = Array.isArray(e) ? e.map(Number) : [2, 3, 1, 4, 0]
    return vmFactory.createEntry(h ?? 0, W ?? 0, bootstrap)()
  }
  return {
    run() {
      outerFunction(globalObject, 0, 0, [2, 3, 1, 4, 0])
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

/**
 * Creates the pure TypeScript VM for the login inline anti-bot bundle.  The
 * login bundle has a separate rotating handler table/dispatcher pair and a
 * second memory image; sharing the evaluator here keeps both paths free of
 * vendor JavaScript evaluation while preserving their distinct contracts.
 */
export const createStarbucksPureLoginVm = (
  globalObject: Record<string, unknown>,
  options: StarbucksPureKxzVmOptions = {},
): StarbucksPureVmRuntime => {
  if (!options.data)
    throw new Error('login VM data is required; extract it from the fetched bundle')
  const data = variantData('login', options.data)
  const memory = new Uint8Array(3 * 65_536)
  if (options.data.memory.length > memory.length)
    throw new Error('login VM memory data exceeds WASM memory')
  memory.set(options.data.memory)
  const events: StarbucksPureVmEvent[] = []
  const originalDispatchEvent = globalObject.dispatchEvent
  if (typeof originalDispatchEvent === 'function') {
    globalObject.dispatchEvent = function (this: unknown, event: any) {
      if (!event || typeof event.type !== 'string')
        throw new TypeError('login VM dispatchEvent received an invalid event')
      const observed = { type: event.type, detail: event.detail } satisfies StarbucksPureVmEvent
      events.push(observed)
      options.onEvent?.(observed)
      const result = Reflect.apply(originalDispatchEvent as Function, this, [event])
      if (options.bootstrapInit && event.detail && typeof event.detail.init === 'function')
        Reflect.apply(event.detail.init, event.detail, [...options.bootstrapInit])
      return result
    }
  }
  let dispatcher: StarbucksWasmDispatcher
  let create: ReturnType<typeof createVmFunctionFactory>['create']
  let outerFunction: Function
  const handler = (index: number, ...args: unknown[]) => {
    const state = args[0] as VmState
    options.onHandler?.(index, state)
    try {
      return runHandler('login', data, index, args, state, globalObject, create, outerFunction)
    } catch (error) {
      if (options.throwOnHandlerError) throw error
      dispatcher?.export('Ov')()
      state.Z.push(error)
      return undefined
    }
  }
  const tableImports = Object.fromEntries(
    data.handlers.map((_, index) => [
      `j.${index}`,
      (...args: unknown[]) => handler(index, ...args),
    ]),
  )
  const table = createStarbucksWasmTable(options.data.tableWasm, tableImports as any, 'B')
  const invokeHostHandler = (state: VmState, ...args: unknown[]) => {
    const index = Number(args.at(-1))
    return handler(index, state, ...args)
  }
  const pushConstant = (state: VmState, index: unknown) => {
    ;(state as VmState).aK.push([{}, [], true, false, undefined, null, Infinity][Number(index)])
    return undefined
  }
  dispatcher = createStarbucksWasmDispatcher(
    options.data.dispatchWasm,
    {
      'c.On': (state, value) => {
        ;(state as VmState).aK.push(value)
        return undefined
      },
      'c.OQ': pushConstant as any,
      'c.F': invokeHostHandler as any,
      'c.h': invokeHostHandler as any,
      'c.S': invokeHostHandler as any,
      'c.E': invokeHostHandler as any,
      'c.W': invokeHostHandler as any,
      'c.z': (state, index) => {
        ;(state as VmState).q.aN(Number(index), (state as VmState).Z.pop())
        return undefined
      },
      'c.OO': (state) => {
        throw (state as VmState).Z.pop()
      },
      'c.OA': (state, amount) => {
        const value = (state as VmState).Z.at(-1)
        ;(state as VmState).Z.splice((state as VmState).Z.length - Number(amount))
        ;(state as VmState).Z[(state as VmState).Z.length - 1] = value
        return undefined
      },
      'c.r': (state) => ((state as VmState).aK.pop() ? 1 : 0),
      'c.Oz': (state) => (state as VmState).aK.pop(),
    },
    table,
    memory,
  )
  const vmFactory = createVmFunctionFactory(
    'login',
    data,
    dispatcher,
    globalObject,
    'd',
    !options.throwOnHandlerError,
  )
  create = vmFactory.create
  outerFunction = function loginEntry() {
    return vmFactory.createEntry(
      options.loginEntry?.v ?? 0,
      options.loginEntry?.w ?? 0,
      options.loginEntry?.initialSlotIndices ?? [],
    )()
  }
  return {
    run() {
      outerFunction()
      const bootstrapEvent = options.bootstrapEvent
      if (bootstrapEvent && typeof globalObject.dispatchEvent === 'function') {
        const CustomEventCtor = globalObject.CustomEvent
        if (typeof CustomEventCtor !== 'function')
          throw new Error('login bootstrap event requires a CustomEvent constructor')
        const event = Reflect.construct(CustomEventCtor as Function, [
          bootstrapEvent.type,
          {
            detail: bootstrapEvent.detail,
            bubbles: false,
            cancelable: false,
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
