import { createHash } from 'node:crypto'
import { parse } from 'acorn'
import type { AstFunction, AstNode } from './kxz-vm'

export interface CurrentKxzRuntimeData {
  sourceHash: string
  instrumentationHash?: string
  bootstrapHash?: string
  strings: string[]
  dispatch: number[][][]
  metadata: Record<string, any>[]
  numbers: number[]
  handlers: Array<{ params: string[]; body: AstNode }>
  bytecode: Uint8Array
  primitiveNames: string[]
}

export interface PinnedKxzRuntimeData {
  sourceHash: { instrumentation: string; bootstrap: string; main: string }
  strings: Array<string | { type?: string; value?: unknown }>
  metadata: Record<string, any>[]
  handlers: AstFunction[]
  dispatchWasm: Uint8Array
  tableWasm: Uint8Array
  memory: Uint8Array
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

const parseScript = (source: string, label: string): any => {
  try {
    return parse(source, {
      ecmaVersion: 'latest',
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      sourceType: 'script',
    })
  } catch (cause) {
    throw new Error(`could not parse ${label}: ${cause instanceof Error ? cause.message : cause}`)
  }
}

const walk = (root: unknown, visitor: (node: any) => void) => {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    visitor(node)
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) stack.push(...value)
        else stack.push(value)
      }
    }
  }
}

const normalize = (node: any): any => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(normalize)
  if (node.type === 'Literal') return { type: 'Literal', value: node.value }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'raw', 'regex'].includes(key)) continue
    result[key] = normalize(value)
  }
  return result
}

const literal = (node: any): unknown => {
  if (node?.type === 'Literal') return node.value
  if (node?.type === 'ArrayExpression') return (node.elements ?? []).map(literal)
  if (node?.type === 'ObjectExpression') {
    const result: Record<string, unknown> = {}
    for (const property of node.properties ?? []) {
      const key = property.key?.name ?? property.key?.value
      if (typeof key === 'string') result[key] = literal(property.value)
    }
    return result
  }
  return undefined
}

const declarations = (ast: any) => {
  const result = new Map<string, any>()
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier')
      result.set(node.id.name, node.init)
  })
  return result
}

const requiredArray = (declarationMap: Map<string, any>, name: string, label: string) => {
  const node = declarationMap.get(name)
  if (!node || node.type !== 'ArrayExpression')
    throw new Error(`${label} declaration ${name} is not a static array`)
  return node
}

const currentHandlers = (array: any, label: string) =>
  (array.elements ?? []).map((entry: any, index: number) => {
    if (entry?.type !== 'FunctionExpression')
      throw new Error(`${label} handler table entry ${index} is not a function`)
    return {
      params: entry.params.map((param: any) => {
        if (param.type !== 'Identifier')
          throw new Error(`${label} handler ${index} has a non-identifier parameter`)
        return param.name
      }),
      body: normalize(entry.body),
    }
  })

/** Extracts the current KXZ contract without evaluating vendor JavaScript. */
export const extractCurrentKxzRuntimeData = (
  source: string,
  instrumentation?: string,
  bootstrap?: string,
): CurrentKxzRuntimeData => {
  const map = declarations(parseScript(source, 'KXZ main bundle'))
  const required = (name: string) => map.get(name)
  const bytecodeNode = required('J')
  if (
    bytecodeNode?.type !== 'CallExpression' ||
    bytecodeNode.callee?.type !== 'Identifier' ||
    bytecodeNode.callee.name !== 'Mr' ||
    bytecodeNode.arguments[0]?.type !== 'Literal' ||
    typeof bytecodeNode.arguments[0].value !== 'string'
  )
    throw new Error('current KXZ bundle does not expose a static bytecode literal')
  const primitiveArray = requiredArray(map, 'b', 'current KXZ')
  const primitiveNames = primitiveArray.elements.map((entry: any) => {
    if (entry?.type !== 'Identifier') throw new Error('current KXZ primitive table is not static')
    return entry.name
  })
  const handlers = currentHandlers(requiredArray(map, 'MG', 'current KXZ'), 'current KXZ')
  const strings = literal(requiredArray(map, 'j', 'current KXZ'))
  const dispatch = literal(requiredArray(map, 'Mj', 'current KXZ'))
  const metadata = literal(requiredArray(map, 'Mi', 'current KXZ'))
  const numbers = literal(requiredArray(map, 'Mn', 'current KXZ'))
  if (
    !Array.isArray(strings) ||
    !Array.isArray(dispatch) ||
    !Array.isArray(metadata) ||
    !Array.isArray(numbers)
  )
    throw new Error('current KXZ tables are not static literals')
  const bytecode = Uint8Array.from(Buffer.from(bytecodeNode.arguments[0].value, 'base64'))
  return {
    sourceHash: sha256(source),
    instrumentationHash: instrumentation === undefined ? undefined : sha256(instrumentation),
    bootstrapHash: bootstrap === undefined ? undefined : sha256(bootstrap),
    strings: strings as string[],
    dispatch: dispatch as number[][][],
    metadata: metadata as Record<string, any>[],
    numbers: numbers as number[],
    handlers,
    bytecode,
    primitiveNames,
  }
}

const decodeBase64 = (value: string) => {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return undefined
  try {
    const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    return bytes.length ? Uint8Array.from(bytes) : undefined
  } catch {
    return undefined
  }
}

const wasmModules = (source: string) => {
  const modules: Array<{ bytes: Uint8Array; digest: string; imports: number }> = []
  const seen = new Set<string>()
  walk(parseScript(source, 'KXZ main bundle'), (node) => {
    if (node.type !== 'Literal' || typeof node.value !== 'string') return
    const bytes = decodeBase64(node.value)
    if (!bytes || bytes.slice(0, 4).join(',') !== '0,97,115,109') return
    const digest = sha256(bytes)
    if (seen.has(digest)) return
    seen.add(digest)
    let offset = 8
    let imports = 0
    const readU8 = () => bytes[offset++]!
    const readU32 = () => {
      let value = 0
      let shift = 0
      for (;;) {
        const byte = readU8()
        value |= (byte & 0x7f) << shift
        if (!(byte & 0x80)) return value >>> 0
        shift += 7
        if (shift > 35) throw new Error('invalid WASM varuint')
      }
    }
    while (offset < bytes.length) {
      const section = readU8()
      const size = readU32()
      const end = offset + size
      if (section === 2) {
        imports = readU32()
        break
      }
      offset = end
    }
    modules.push({ bytes, digest, imports })
  })
  if (modules.length !== 2)
    throw new Error(`KXZ bundle expected two embedded WASM modules, got ${modules.length}`)
  return modules.sort((left, right) => left.imports - right.imports)
}

const memoryImage = (source: string) => {
  let result: Uint8Array | undefined
  walk(parseScript(source, 'KXZ main bundle'), (node) => {
    if (result || node.type !== 'CallExpression' || node.arguments.length < 2) return
    const value = node.arguments[0]
    const target = node.arguments[1]
    if (value?.type !== 'Literal' || typeof value.value !== 'string') return
    if (target?.type !== 'NewExpression' || target.callee?.type !== 'Identifier') return
    if (target.callee.name !== 'Uint8Array') return
    const bytes = decodeBase64(value.value)
    if (bytes && bytes.length > 100_000) result = bytes
  })
  if (!result) throw new Error('KXZ bundle did not expose a static VM memory image')
  return result
}

const chooseTable = (ast: any, score: 'strings' | 'metadata' | 'handlers') => {
  const candidates: any[] = []
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return
    if (node.init?.type !== 'ArrayExpression' || node.init.elements.length < 100) return
    const elements = node.init.elements
    const count = (type: string) => elements.filter((entry: any) => entry?.type === type).length
    candidates.push({
      name: node.id.name,
      expression: node.init,
      length: elements.length,
      strings: count('Literal') / elements.length,
      metadata: count('ObjectExpression') / elements.length,
      handlers: count('FunctionExpression') / elements.length,
    })
  })
  const candidate = candidates.sort((left, right) => right[score] - left[score])[0]
  if (!candidate || candidate[score] < 0.9) throw new Error(`KXZ ${score} table was not found`)
  return candidate
}

/** Extracts the pinned KXZ contract and embedded WASM at runtime. */
export const extractPinnedKxzRuntimeData = (scripts: {
  instrumentation: string
  bootstrap: string
  main: string
}): PinnedKxzRuntimeData => {
  const ast = parseScript(scripts.main, 'KXZ main bundle')
  const strings = chooseTable(ast, 'strings')
  const metadata = chooseTable(ast, 'metadata')
  const handlers = chooseTable(ast, 'handlers')
  const modules = wasmModules(scripts.main)
  return {
    sourceHash: {
      instrumentation: sha256(scripts.instrumentation),
      bootstrap: sha256(scripts.bootstrap),
      main: sha256(scripts.main),
    },
    strings: literal(strings.expression) as Array<string | { type?: string; value?: unknown }>,
    metadata: literal(metadata.expression) as Record<string, any>[],
    handlers: handlers.expression.elements.map((entry: any) => ({
      params: entry.params.map((param: any) => {
        if (param.type !== 'Identifier')
          throw new Error('KXZ handler parameter is not an identifier')
        return param.name
      }),
      body: normalize(entry.body),
    })),
    dispatchWasm: modules[0]!.bytes,
    tableWasm: modules[1]!.bytes,
    memory: memoryImage(scripts.main),
  }
}
