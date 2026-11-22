/**
 * A deliberately small WebAssembly interpreter for the KXZ dispatcher module.
 *
 * The KXZ module is not instantiated through `WebAssembly.Module` at runtime.
 * Its binary is treated as data and the handful of instructions used by the
 * dispatcher are executed by this TypeScript implementation.  This is not a
 * general-purpose WASM implementation: unsupported sections/opcodes fail
 * loudly so a rotated vendor module cannot silently produce a different
 * fingerprint.
 */

type WasmValue = number | object | null | undefined
type WasmFunction = (...args: WasmValue[]) => WasmValue | WasmValue[]

interface Reader {
  readonly bytes: Uint8Array
  offset: number
  u8(): number
  bytesOf(length: number): Uint8Array
  u32(): number
  i32(): number
  text(): string
}

const reader = (bytes: Uint8Array): Reader => {
  const value: Reader = {
    bytes,
    offset: 0,
    u8() {
      const byte = this.bytes[this.offset]
      if (byte === undefined) throw new Error('WASM truncated byte')
      this.offset += 1
      return byte
    },
    bytesOf(length) {
      if (length < 0 || this.offset + length > this.bytes.length)
        throw new Error('WASM truncated section')
      const result = this.bytes.subarray(this.offset, this.offset + length)
      this.offset += length
      return result
    },
    u32() {
      let result = 0
      let shift = 0
      for (;;) {
        const byte = this.u8()
        result |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) return result >>> 0
        shift += 7
        if (shift > 35) throw new Error('WASM u32 leb128 is too long')
      }
    },
    i32() {
      let result = 0
      let shift = 0
      let byte = 0
      for (;;) {
        byte = this.u8()
        result |= (byte & 0x7f) << shift
        shift += 7
        if ((byte & 0x80) === 0) break
        if (shift > 35) throw new Error('WASM i32 leb128 is too long')
      }
      if (shift < 32 && (byte & 0x40) !== 0) result |= ~0 << shift
      return result | 0
    },
    text() {
      return new TextDecoder().decode(this.bytesOf(this.u32()))
    },
  }
  return value
}

type WasmType = 'i32' | 'f64' | 'externref'
interface FunctionType {
  params: readonly WasmType[]
  results: readonly WasmType[]
}

interface Instruction {
  opcode: number
  args: number[]
  start: number
  end?: number
  alternate?: number
  kind?: 'block' | 'loop' | 'if'
}

interface FunctionBody {
  typeIndex: number
  locals: readonly WasmType[]
  instructions: readonly Instruction[]
}

interface ParsedModule {
  types: readonly FunctionType[]
  imports: Array<{
    module: string
    name: string
    kind: 'function' | 'memory' | 'table'
    typeIndex?: number
  }>
  functions: readonly FunctionBody[]
  exports: ReadonlyMap<string, { kind: 'function' | 'table'; index: number }>
  data: Array<{ offset: number; bytes: Uint8Array }>
  elements: Array<{ offset: number; indices: number[] }>
  memoryPages: number
  tableInitial: number
  globals: number[]
}

const valueType = (byte: number): WasmType => {
  if (byte === 0x7f) return 'i32'
  if (byte === 0x7c) return 'f64'
  if (byte === 0x6f) return 'externref'
  throw new Error(`unsupported WASM value type 0x${byte.toString(16)}`)
}

const parseExpression = (input: Reader) => {
  const opcode = input.u8()
  let value = 0
  if (opcode === 0x41) value = input.i32()
  else throw new Error(`unsupported WASM global/data expression 0x${opcode.toString(16)}`)
  if (input.u8() !== 0x0b) throw new Error('WASM expression did not end')
  return value
}

const decodeInstructions = (bytes: Uint8Array): Instruction[] => {
  const input = reader(bytes)
  const result: Instruction[] = []
  const controls: Array<{ index: number; kind: Instruction['kind']; alternate?: number }> = []
  while (input.offset < bytes.length) {
    const start = input.offset
    const opcode = input.u8()
    const instruction: Instruction = { opcode, args: [], start }
    switch (opcode) {
      case 0x02:
      case 0x03:
      case 0x04: {
        const blockType = input.u8()
        // A block type may be a value type, the empty type, or a small
        // signed type-index (the KXZ module uses the latter for result
        // carrying blocks).
        if (
          blockType !== 0x40 &&
          blockType !== 0x7f &&
          blockType !== 0x7c &&
          blockType !== 0x6f &&
          blockType > 0x3f
        )
          throw new Error(`unsupported WASM block type 0x${blockType.toString(16)}`)
        instruction.kind = opcode === 0x02 ? 'block' : opcode === 0x03 ? 'loop' : 'if'
        instruction.args.push(blockType)
        controls.push({ index: result.length, kind: instruction.kind })
        break
      }
      case 0x05: {
        const control = controls.at(-1)
        if (!control || control.kind !== 'if') throw new Error('WASM else without if')
        control.alternate = result.length
        instruction.args.push(control.index)
        break
      }
      case 0x0b: {
        const control = controls.pop()
        if (!control) {
          // The terminal function end is retained as an ordinary instruction.
          result.push(instruction)
          continue
        }
        instruction.args.push(control.index)
        result[control.index]!.end = result.length
        if (control.alternate !== undefined) result[control.index]!.alternate = control.alternate
        break
      }
      case 0x0c:
      case 0x0d:
        instruction.args.push(input.u32())
        break
      case 0x0e: {
        const count = input.u32()
        for (let index = 0; index < count + 1; index++) instruction.args.push(input.u32())
        break
      }
      case 0x10:
        instruction.args.push(input.u32())
        break
      case 0x11:
        instruction.args.push(input.u32(), input.u32())
        break
      case 0x20:
      case 0x21:
      case 0x22:
      case 0x23:
      case 0x24:
        instruction.args.push(input.u32())
        break
      case 0x28:
      case 0x2b:
      case 0x2d:
      case 0x2f:
      case 0x36:
      case 0x3a:
        input.u32() // alignment
        instruction.args.push(input.u32()) // offset
        break
      case 0x41:
        instruction.args.push(input.i32())
        break
      case 0x44: {
        const value = new DataView(
          input.bytes.buffer,
          input.bytes.byteOffset + input.offset,
          8,
        ).getFloat64(0, true)
        input.offset += 8
        instruction.args.push(value)
        break
      }
      case 0x3f:
      case 0x40:
        instruction.args.push(input.u8())
        break
      case 0x1a:
      case 0x1b:
      case 0x47:
      case 0x6a:
      case 0x6b:
      case 0x6c:
      case 0x71:
      case 0x74:
      case 0xa7:
      case 0xb8:
        break
      case 0x00:
      case 0x01:
      case 0x0f:
      case 0x46:
        break
      default:
        throw new Error(`unsupported KXZ WASM opcode 0x${opcode.toString(16)}`)
    }
    result.push(instruction)
  }
  if (controls.length) throw new Error('unterminated WASM control block')
  return result
}

const parseModule = (bytes: Uint8Array): ParsedModule => {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  )
    throw new Error('invalid WASM magic')
  const input = reader(bytes)
  input.offset = 8
  const types: FunctionType[] = []
  const imports: ParsedModule['imports'] = []
  const functionTypeIndices: number[] = []
  const bodies: FunctionBody[] = []
  const exports = new Map<string, { kind: 'function' | 'table'; index: number }>()
  const data: ParsedModule['data'] = []
  const elements: ParsedModule['elements'] = []
  const globals: number[] = []
  let memoryPages = 0
  let tableInitial = 0
  let importedTable = false
  while (input.offset < bytes.length) {
    const id = input.u8()
    const sectionLength = input.u32()
    const section = reader(input.bytesOf(sectionLength))
    switch (id) {
      case 1: {
        const count = section.u32()
        for (let index = 0; index < count; index++) {
          if (section.u8() !== 0x60) throw new Error('invalid WASM function type')
          const params = Array.from({ length: section.u32() }, () => valueType(section.u8()))
          const results = Array.from({ length: section.u32() }, () => valueType(section.u8()))
          types.push({ params, results })
        }
        break
      }
      case 2: {
        const count = section.u32()
        for (let index = 0; index < count; index++) {
          const module = section.text()
          const name = section.text()
          const kind = section.u8()
          if (kind === 0) imports.push({ module, name, kind: 'function', typeIndex: section.u32() })
          else if (kind === 1) {
            const element = section.u8()
            if (element !== 0x70) throw new Error('unsupported imported WASM table')
            const flags = section.u32()
            const minimum = section.u32()
            if (flags & 1) section.u32()
            imports.push({ module, name, kind: 'table' })
            importedTable = true
            tableInitial = minimum
            if (minimum < 204) throw new Error('KXZ table is smaller than expected')
          } else if (kind === 2) {
            const flags = section.u32()
            memoryPages = section.u32()
            if (flags & 1) section.u32()
            imports.push({ module, name, kind: 'memory' })
          } else throw new Error(`unsupported imported WASM kind ${kind}`)
        }
        break
      }
      case 4:
        for (let index = 0, count = section.u32(); index < count; index++) {
          if (section.u8() !== 0x70) throw new Error('unsupported defined WASM table type')
          const flags = section.u32()
          tableInitial = section.u32()
          if (flags & 1) section.u32()
        }
        break
      case 3:
        for (let index = 0, count = section.u32(); index < count; index++)
          functionTypeIndices.push(section.u32())
        break
      case 5:
        for (let index = 0, count = section.u32(); index < count; index++) {
          const flags = section.u32()
          memoryPages = section.u32()
          if (flags & 1) section.u32()
        }
        break
      case 6:
        for (let index = 0, count = section.u32(); index < count; index++) {
          section.u8() // value type
          section.u8() // mutability
          globals.push(parseExpression(section))
        }
        break
      case 7:
        for (let index = 0, count = section.u32(); index < count; index++) {
          const name = section.text()
          const kind = section.u8()
          const value = section.u32()
          if (kind === 0) exports.set(name, { kind: 'function', index: value })
          else if (kind === 1) exports.set(name, { kind: 'table', index: value })
        }
        break
      case 9:
        for (let index = 0, count = section.u32(); index < count; index++) {
          const flags = section.u32()
          if (flags === 0) {
            const offset = parseExpression(section)
            const amount = section.u32()
            elements.push({
              offset,
              indices: Array.from({ length: amount }, () => section.u32()),
            })
          } else if (flags === 2) {
            section.u32() // table index
            const offset = parseExpression(section)
            if (section.u8() !== 0) throw new Error('unsupported WASM element kind')
            const amount = section.u32()
            elements.push({
              offset,
              indices: Array.from({ length: amount }, () => section.u32()),
            })
          } else throw new Error(`unsupported WASM element segment mode ${flags}`)
        }
        break
      case 10:
        for (let index = 0, count = section.u32(); index < count; index++) {
          const body = reader(section.bytesOf(section.u32()))
          const localGroups = body.u32()
          const locals: WasmType[] = []
          for (let group = 0; group < localGroups; group++) {
            const amount = body.u32()
            const type = valueType(body.u8())
            for (let local = 0; local < amount; local++) locals.push(type)
          }
          const code = body.bytesOf(body.bytes.length - body.offset)
          bodies.push({
            typeIndex: functionTypeIndices[index]!,
            locals,
            instructions: decodeInstructions(code),
          })
        }
        break
      case 11:
        for (let index = 0, count = section.u32(); index < count; index++) {
          const flags = section.u32()
          if (flags === 0) {
            const offset = parseExpression(section)
            const length = section.u32()
            data.push({ offset, bytes: section.bytesOf(length) })
          } else if (flags === 2) {
            section.u32() // memory index
            const offset = parseExpression(section)
            const length = section.u32()
            data.push({ offset, bytes: section.bytesOf(length) })
          } else throw new Error(`unsupported WASM data segment mode ${flags}`)
        }
        break
      default:
        // Custom/name sections are irrelevant; all standard sections that
        // affect this module are handled above.
        break
    }
  }
  if (!importedTable && tableInitial === 0 && elements.length)
    throw new Error('WASM element segment has no table')
  return {
    types,
    imports,
    functions: bodies,
    exports,
    data,
    elements,
    memoryPages,
    tableInitial,
    globals,
  }
}

interface Frame {
  kind: Instruction['kind']
  start: number
  end: number
  alternate?: number
  stackHeight: number
}

const asI32 = (value: WasmValue) => (Number(value) | 0) >>> 0
const asSignedI32 = (value: WasmValue) => Number(value) | 0

class Instance {
  readonly module: ParsedModule
  readonly memory: Uint8Array
  readonly table: WasmFunction[]
  readonly imports: WasmFunction[]
  readonly globals: number[]
  readonly functions: Array<{ type: FunctionType; invoke: WasmFunction }>

  constructor(
    module: ParsedModule,
    host: {
      functions: Readonly<Record<string, WasmFunction>>
      table?: WasmFunction[]
      memory?: Uint8Array
    },
  ) {
    this.module = module
    this.memory = host.memory ?? new Uint8Array(Math.max(1, module.memoryPages) * 65_536)
    this.table = host.table ?? new Array(module.tableInitial)
    this.globals = [...module.globals]
    this.imports = module.imports
      .filter((item) => item.kind === 'function')
      .map((item) => {
        const fn = host.functions[`${item.module}.${item.name}`]
        if (!fn) throw new Error(`missing WASM import ${item.module}.${item.name}`)
        return fn
      })
    const importedTypes = module.imports
      .filter((item) => item.kind === 'function')
      .map((item) => module.types[item.typeIndex!]!)
    this.functions = importedTypes.map((type, index) => ({
      type,
      invoke: (...args) => this.imports[index]!(...args),
    }))
    for (const body of module.functions) {
      const type = module.types[body.typeIndex]
      if (!type) throw new Error(`missing WASM function type ${body.typeIndex}`)
      this.functions.push({ type, invoke: (...args) => this.execute(body, type, args) })
    }
    for (const segment of module.elements) {
      for (const [index, functionIndex] of segment.indices.entries()) {
        const target = this.functions[functionIndex]
        if (!target) throw new Error(`WASM element function ${functionIndex} is missing`)
        this.table[segment.offset + index] = target.invoke
      }
    }
    for (const segment of module.data) this.memory.set(segment.bytes, segment.offset)
  }

  export(name: string): WasmFunction {
    const value = this.module.exports.get(name)
    if (!value) throw new Error(`WASM export ${name} is missing`)
    if (value.kind !== 'function') throw new Error(`WASM export ${name} is not a function`)
    const fn = this.functions[value.index]
    if (!fn) throw new Error(`WASM function ${value.index} is missing`)
    return fn.invoke
  }

  tableExport(name: string): WasmFunction[] {
    const value = this.module.exports.get(name)
    if (!value) throw new Error(`WASM export ${name} is missing`)
    if (value.kind !== 'table') throw new Error(`WASM export ${name} is not a table`)
    return this.table
  }

  private execute(
    body: FunctionBody,
    type: FunctionType,
    args: WasmValue[],
  ): WasmValue | WasmValue[] {
    const locals = [...args, ...body.locals.map(() => 0 as WasmValue)]
    const stack: WasmValue[] = []
    const frames: Frame[] = []
    const code = body.instructions
    let pc = 0
    const pop = () => {
      const value = stack.pop()
      if (value === undefined) throw new Error('WASM stack underflow')
      return value
    }
    const call = (index: number, parameters: WasmValue[]) => {
      const target = this.functions[index]
      if (!target) throw new Error(`WASM call target ${index} is missing`)
      const result = target.invoke(...parameters)
      if (target.type.results.length === 0) return
      if (target.type.results.length === 1) stack.push(result as WasmValue)
      else stack.push(...(result as WasmValue[]))
    }
    const branch = (depth: number) => {
      // Branch depths count the explicit control frames. A function itself is
      // not a branch label in WebAssembly (return uses a separate opcode).
      const targetIndex = frames.length - 1 - depth
      const target = frames[targetIndex]
      if (!target) throw new Error(`WASM branch depth ${depth} is invalid`)
      while (frames.length - 1 > targetIndex) frames.pop()
      if (target.kind === 'loop') {
        stack.length = target.stackHeight
        pc = target.start + 1
      } else {
        stack.length = target.stackHeight
        pc = target.end + 1
        frames.pop()
      }
    }
    while (pc < code.length) {
      const instruction = code[pc]!
      switch (instruction.opcode) {
        case 0x00:
          throw new Error(`WASM unreachable at instruction ${pc}`)
        case 0x01:
          pc++
          break
        case 0x02:
        case 0x03:
        case 0x04: {
          const end = instruction.end
          if (end === undefined) throw new Error('WASM control end is missing')
          const condition = instruction.opcode === 0x04 ? Boolean(pop()) : true
          const frame: Frame = {
            kind: instruction.kind,
            start: pc,
            end,
            alternate: instruction.alternate,
            stackHeight: stack.length,
          }
          frames.push(frame)
          if (instruction.opcode === 0x04 && !condition) {
            if (instruction.alternate !== undefined) pc = instruction.alternate + 1
            else {
              frames.pop()
              pc = end + 1
            }
          } else pc++
          break
        }
        case 0x05: {
          const frame = frames.at(-1)
          if (!frame || frame.kind !== 'if') throw new Error('WASM else frame is missing')
          pc = frame.end + 1
          frames.pop()
          break
        }
        case 0x0b:
          if (frames.length) frames.pop()
          else {
            const result =
              type.results.length === 0
                ? undefined
                : type.results.length === 1
                  ? pop()
                  : stack.splice(-type.results.length)
            return result
          }
          pc++
          break
        case 0x0c:
          branch(instruction.args[0]!)
          break
        case 0x0d:
          if (pop()) branch(instruction.args[0]!)
          else pc++
          break
        case 0x0e: {
          const selector = asSignedI32(pop())
          const target =
            selector >= 0 && selector < instruction.args.length - 1
              ? instruction.args[selector]!
              : instruction.args.at(-1)!
          branch(target)
          break
        }
        case 0x0f: {
          const result =
            type.results.length === 0
              ? undefined
              : type.results.length === 1
                ? pop()
                : stack.splice(-type.results.length)
          return result
        }
        case 0x10: {
          const target = this.functions[instruction.args[0]!]!
          const parameters = Array.from({ length: target.type.params.length }, () =>
            pop(),
          ).reverse()
          call(instruction.args[0]!, parameters)
          pc++
          break
        }
        case 0x11: {
          const typeIndex = instruction.args[0]!
          const signature = this.module.types[typeIndex]
          if (!signature) throw new Error(`WASM indirect signature ${typeIndex} is missing`)
          const tableIndex = asSignedI32(pop())
          const target = this.table[tableIndex]
          if (!target) throw new Error(`WASM indirect table entry ${tableIndex} is missing`)
          const parameters = Array.from({ length: signature.params.length }, () => pop()).reverse()
          const result = target(...parameters)
          if (signature.results.length === 1) stack.push(result as WasmValue)
          else if (signature.results.length > 1) stack.push(...(result as WasmValue[]))
          pc++
          break
        }
        case 0x1a:
          pop()
          pc++
          break
        case 0x1b: {
          const condition = Boolean(pop())
          const falseValue = pop()
          const trueValue = pop()
          stack.push(condition ? trueValue : falseValue)
          pc++
          break
        }
        case 0x20:
          stack.push(locals[instruction.args[0]!]!)
          pc++
          break
        case 0x21:
          locals[instruction.args[0]!] = pop()
          pc++
          break
        case 0x22: {
          const value = pop()
          locals[instruction.args[0]!] = value
          stack.push(value)
          pc++
          break
        }
        case 0x23:
          stack.push(this.globals[instruction.args[0]!] ?? 0)
          pc++
          break
        case 0x24:
          this.globals[instruction.args[0]!] = asSignedI32(pop())
          pc++
          break
        case 0x28: {
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset + 4 > this.memory.length) throw new Error('WASM i32.load out of bounds')
          stack.push(new DataView(this.memory.buffer).getInt32(offset, true))
          pc++
          break
        }
        case 0x2b: {
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset + 8 > this.memory.length) throw new Error('WASM f64.load out of bounds')
          stack.push(new DataView(this.memory.buffer).getFloat64(offset, true))
          pc++
          break
        }
        case 0x2d: {
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset >= this.memory.length) throw new Error('WASM i32.load8_u out of bounds')
          stack.push(this.memory[offset]!)
          pc++
          break
        }
        case 0x2f: {
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset + 2 > this.memory.length) throw new Error('WASM i32.load16_u out of bounds')
          stack.push(this.memory[offset]! | (this.memory[offset + 1]! << 8))
          pc++
          break
        }
        case 0x36: {
          const value = asI32(pop())
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset + 4 > this.memory.length) throw new Error('WASM i32.store out of bounds')
          new DataView(this.memory.buffer).setInt32(offset, value, true)
          pc++
          break
        }
        case 0x3a: {
          const value = asI32(pop())
          const offset = asI32(pop()) + instruction.args[0]!
          if (offset >= this.memory.length) throw new Error('WASM i32.store8 out of bounds')
          this.memory[offset] = value & 0xff
          pc++
          break
        }
        case 0x3f:
          stack.push(this.memory.length >>> 16)
          pc++
          break
        case 0x40:
          throw new Error('WASM memory.grow is not supported')
        case 0x41:
          stack.push(instruction.args[0]!)
          pc++
          break
        case 0x44:
          stack.push(instruction.args[0]!)
          pc++
          break
        case 0x46: {
          const right = pop()
          const left = pop()
          stack.push(asI32(left) === asI32(right) ? 1 : 0)
          pc++
          break
        }
        case 0x47: {
          const right = pop()
          const left = pop()
          stack.push(asI32(left) !== asI32(right) ? 1 : 0)
          pc++
          break
        }
        case 0x6a:
          stack.push((asSignedI32(pop()) + asSignedI32(pop())) | 0)
          pc++
          break
        case 0x6b: {
          const right = asSignedI32(pop())
          stack.push((asSignedI32(pop()) - right) | 0)
          pc++
          break
        }
        case 0x6c:
          stack.push(Math.imul(asSignedI32(pop()), asSignedI32(pop())))
          pc++
          break
        case 0x71:
          stack.push(asI32(pop()) & asI32(pop()))
          pc++
          break
        case 0x74: {
          const shift = asI32(pop()) & 31
          stack.push(asI32(pop()) << shift)
          pc++
          break
        }
        case 0xa7:
          stack.push(asI32(pop()))
          pc++
          break
        case 0xb8:
          stack.push(asI32(pop()))
          pc++
          break
        default:
          throw new Error(`unsupported KXZ WASM opcode 0x${instruction.opcode.toString(16)}`)
      }
    }
    return type.results.length === 0
      ? undefined
      : type.results.length === 1
        ? pop()
        : stack.splice(-type.results.length)
  }
}

export interface StarbucksWasmDispatcher {
  export(name: string): WasmFunction
}

/** Instantiates the KXZ dispatcher module without the host WebAssembly API. */
export const createStarbucksWasmDispatcher = (
  bytes: Uint8Array,
  functions: Readonly<Record<string, WasmFunction>>,
  table: WasmFunction[],
  memory = new Uint8Array(3 * 65_536),
): StarbucksWasmDispatcher => new Instance(parseModule(bytes), { functions, table, memory })

/** Instantiates the module that supplies the KXZ indirect-call table. */
export const createStarbucksWasmTable = (
  bytes: Uint8Array,
  functions: Readonly<Record<string, WasmFunction>>,
  exportName = 'H',
): WasmFunction[] => new Instance(parseModule(bytes), { functions }).tableExport(exportName)
