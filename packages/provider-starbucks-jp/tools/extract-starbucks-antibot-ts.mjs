import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'acorn'

/**
 * Statically extracts the data consumed by the TypeScript anti-bot VM.
 *
 * This tool deliberately parses source text and byte strings only. It never
 * evaluates vendor JavaScript, creates a WebAssembly.Module, or emits a
 * JavaScript executor. The output is compressed JSON data for offline
 * analysis only; runtime code extracts the contract in memory.
 *
 * Usage:
 *   node extract-starbucks-antibot-ts.mjs <analysis-dir> <output-dir>
 *
 * `analysis-dir` is the directory produced by analyze-starbucks-har.mjs.
 */

const [analysisDirectory, outputDirectory = '/tmp/starbucks-static-runtime-data', loginMemoryPath] =
  process.argv.slice(2)

if (!analysisDirectory) {
  console.error(
    'usage: node extract-starbucks-antibot-ts.mjs <analysis-dir> [output-dir] [login-memory.bin]',
  )
  process.exitCode = 2
  throw new Error('missing static-analysis directory')
}

const inputDirectory = resolve(analysisDirectory)
const outputDir = resolve(outputDirectory)
const read = (name) => readFile(join(inputDirectory, name), 'utf8')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const decodeBase64 = (value) => {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return undefined
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bytes = Buffer.from(normalized, 'base64')
    return bytes.length ? bytes : undefined
  } catch {
    return undefined
  }
}

const parseScript = (source, file) => {
  try {
    return parse(source, {
      ecmaVersion: 'latest',
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      sourceType: 'script',
    })
  } catch (cause) {
    throw new Error(`could not parse ${file}: ${cause.message}`, { cause })
  }
}

const walk = (root, visitor) => {
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

const arrayCandidates = (ast) => {
  const candidates = []
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return
    if (node.init?.type !== 'ArrayExpression') return
    const elements = node.init.elements ?? []
    if (elements.length < 100) return
    const count = (type) => elements.filter((element) => element?.type === type).length
    const strings = count('Literal')
    const objects = count('ObjectExpression')
    const functions = count('FunctionExpression')
    candidates.push({
      name: node.id.name,
      expression: node.init,
      length: elements.length,
      stringRatio: strings / elements.length,
      objectRatio: objects / elements.length,
      functionRatio: functions / elements.length,
    })
  })
  return candidates
}

const chooseCandidate = (candidates, key, description) => {
  const candidate = [...candidates].sort((left, right) => right[key] - left[key])[0]
  if (!candidate || candidate[key] < 0.9)
    throw new Error(`could not statically identify ${description} table`)
  return candidate
}

const normalize = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(normalize)
  if (node.type === 'Literal') return { type: 'Literal', value: node.value }
  if (node.type === 'FunctionExpression')
    return {
      type: 'FunctionExpression',
      id: normalize(node.id),
      expression: node.expression,
      generator: node.generator,
      async: node.async,
      params: node.params.map(normalize),
      body: normalize(node.body),
    }
  const result = {}
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'raw', 'regex'].includes(key)) continue
    result[key] = normalize(value)
  }
  return result
}

const functionTable = (source, file) => {
  const ast = parseScript(source, file)
  const candidates = arrayCandidates(ast)
  const strings = chooseCandidate(
    candidates.filter((entry) => entry.stringRatio > 0.9),
    'length',
    'string',
  )
  const metadata = chooseCandidate(
    candidates.filter((entry) => entry.objectRatio > 0.9),
    'length',
    'metadata',
  )
  const handlers = chooseCandidate(
    candidates.filter((entry) => entry.functionRatio > 0.9),
    'length',
    'handler',
  )
  const stringsData = normalize(strings.expression.elements)
  const metadataData = normalize(metadata.expression.elements)
  const handlersData = handlers.expression.elements.map((entry) => ({
    params: entry.params.map((param) => {
      if (param.type !== 'Identifier')
        throw new Error(`${file} contains a non-identifier handler parameter`)
      return param.name
    }),
    body: normalize(entry.body),
  }))
  return {
    strings: stringsData,
    metadata: metadataData,
    handlers: handlersData,
    variables: { strings: strings.name, metadata: metadata.name, handlers: handlers.name },
  }
}

const wasmModules = (source, file) => {
  const ast = parseScript(source, file)
  const modules = []
  const seen = new Set()
  walk(ast, (node) => {
    if (node.type !== 'Literal' || typeof node.value !== 'string') return
    const bytes = decodeBase64(node.value)
    if (!bytes || bytes.subarray(0, 4).toString('hex') !== '0061736d') return
    const digest = sha256(bytes)
    if (seen.has(digest)) return
    seen.add(digest)
    modules.push({ bytes, digest })
  })
  if (modules.length !== 2)
    throw new Error(`${file} expected two embedded WASM modules, got ${modules.length}`)
  return modules
}

const wasmImportCount = (bytes) => {
  let offset = 8
  const u8 = () => bytes[offset++]
  const u32 = () => {
    let value = 0
    let shift = 0
    for (;;) {
      const byte = u8()
      value |= (byte & 0x7f) << shift
      if (!(byte & 0x80)) return value >>> 0
      shift += 7
      if (shift > 35) throw new Error('invalid WASM varuint')
    }
  }
  let imports = 0
  while (offset < bytes.length) {
    const section = u8()
    const size = u32()
    const end = offset + size
    if (section === 2) {
      imports = u32()
      break
    }
    offset = end
  }
  return imports
}

const memoryImage = (source, file) => {
  const ast = parseScript(source, file)
  let result
  walk(ast, (node) => {
    if (result || node.type !== 'CallExpression' || node.arguments.length < 2) return
    const value = node.arguments[0]
    const target = node.arguments[1]
    if (value?.type !== 'Literal' || typeof value.value !== 'string') return
    if (target?.type !== 'NewExpression' || target.callee?.type !== 'Identifier') return
    if (target.callee.name !== 'Uint8Array') return
    const bytes = decodeBase64(value.value)
    if (bytes && bytes.length > 100_000) result = bytes
  })
  if (!result) throw new Error(`${file} did not expose a static VM memory image`)
  return result
}

const gzipJson = (value) => gzipSync(Buffer.from(JSON.stringify(value))).toString('base64')
const tsString = (value) => JSON.stringify(value)
const writeDataModule = async (file, entries) => {
  const lines = ['// Generated by extract-starbucks-antibot-ts.mjs; do not edit by hand.']
  for (const [name, value] of entries) {
    const suffix = name === 'STARBUCKS_KXZ_SCRIPT_SHA256' ? ' as const' : ''
    lines.push(`export const ${name} = ${tsString(value)}${suffix}`)
  }
  await writeFile(join(outputDir, file), `${lines.join('\n')}\n`)
}

const kxzMain = await read('kxz-main.js')
const loginMain = await read('login-inline-anti-bot.js')
const kxz = functionTable(kxzMain, 'kxz-main.js')
const login = functionTable(loginMain, 'login-inline-anti-bot.js')
// The dispatcher imports the small host surface; the indirect-call table
// imports one callback per handler. Keep the former first for the generated
// filenames consumed by kxz-vm.ts.
const kxzModules = wasmModules(kxzMain, 'kxz-main.js').sort(
  (left, right) => wasmImportCount(left.bytes) - wasmImportCount(right.bytes),
)
const loginModules = wasmModules(loginMain, 'login-inline-anti-bot.js').sort(
  (left, right) => wasmImportCount(left.bytes) - wasmImportCount(right.bytes),
)
const kxzMemory = memoryImage(kxzMain, 'kxz-main.js')
const loginMemorySource = memoryImage(loginMain, 'login-inline-anti-bot.js')
const instrumentation = await read('kxz-instrumentation.js')
const bootstrap = await read('kxz-bootstrap.js')

// The inline login VM writes a small table after the base64 memory literal
// while constructing its worker. That tail is not present in source text,
// so require an explicitly captured binary image for a new bundle. For the
// currently pinned bundle, preserving the existing image is safe only when
// its pinned hash matches; a changed hash fails loudly instead of reusing it.
const expectedLoginHash = sha256(loginMain)
let loginMemory
let loginMemorySourceDescription
if (loginMemoryPath) {
  loginMemory = await readFile(resolve(loginMemoryPath))
  loginMemorySourceDescription = resolve(loginMemoryPath)
} else {
  const existingBundle = await readFile(join(outputDir, 'kxz-bundle-data.ts'), 'utf8').catch(
    () => '',
  )
  const existingHash = existingBundle.match(
    /STARBUCKS_LOGIN_ANTI_BOT_SCRIPT_SHA256[\s\S]*?'([0-9a-f]{64})'/,
  )?.[1]
  if (existingHash !== expectedLoginHash)
    throw new Error(
      'login memory tail is not present in source; pass a captured login-memory.bin for this bundle',
    )
  const existingMemory = await readFile(join(outputDir, 'login-memory-data.ts')).catch(
    () => undefined,
  )
  if (!existingMemory)
    throw new Error(
      'login memory tail is not present in source; pass a captured login-memory.bin for this bundle',
    )
  const encoded = existingMemory
    .toString('utf8')
    .match(/STARBUCKS_LOGIN_VM_MEMORY_GZIP_BASE64\s*=\s*'([^']+)'/)?.[1]
  if (!encoded) throw new Error('existing login-memory-data.ts did not expose a gzip image')
  // The runtime stores the image as gzip/base64; decode it before regenerating.
  loginMemory = gunzipSync(Buffer.from(encoded, 'base64'))
  loginMemorySourceDescription = 'existing pinned login-memory-data.ts'
}
if (!loginMemory.subarray(0, loginMemorySource.length).equals(loginMemorySource))
  throw new Error('captured login memory image does not begin with the bundle memory literal')
if (loginMemory.length > 3 * 65_536)
  throw new Error('captured login memory image exceeds the WASM memory')

await mkdir(outputDir, { recursive: true })
await writeDataModule('kxz-handler-data.ts', [
  ['STARBUCKS_KXZ_HANDLER_IR_GZIP_BASE64', gzipJson(kxz.handlers)],
  ['STARBUCKS_LOGIN_HANDLER_IR_GZIP_BASE64', gzipJson(login.handlers)],
])
await writeDataModule('kxz-program-data.ts', [
  ['STARBUCKS_KXZ_STRINGS_GZIP_BASE64', gzipJson(kxz.strings)],
  ['STARBUCKS_KXZ_META_GZIP_BASE64', gzipJson(kxz.metadata)],
  ['STARBUCKS_LOGIN_STRINGS_GZIP_BASE64', gzipJson(login.strings)],
  ['STARBUCKS_LOGIN_META_GZIP_BASE64', gzipJson(login.metadata)],
])
await writeDataModule('kxz-memory-data.ts', [
  ['STARBUCKS_KXZ_VM_MEMORY_GZIP_BASE64', gzipSync(kxzMemory).toString('base64')],
  ['STARBUCKS_KXZ_VM_MEMORY_LENGTH', kxzMemory.length],
])
await writeDataModule('login-memory-data.ts', [
  ['STARBUCKS_LOGIN_VM_MEMORY_GZIP_BASE64', gzipSync(loginMemory).toString('base64')],
  ['STARBUCKS_LOGIN_VM_MEMORY_LENGTH', loginMemory.length],
])
await writeDataModule('kxz-wasm-data.ts', [
  ['STARBUCKS_KXZ_DISPATCH_WASM_BASE64', kxzModules[0].bytes.toString('base64')],
  ['STARBUCKS_KXZ_DISPATCH_WASM_SHA256', kxzModules[0].digest],
])
await writeDataModule('kxz-table-wasm-data.ts', [
  ['STARBUCKS_KXZ_TABLE_WASM_BASE64', kxzModules[1].bytes.toString('base64')],
])
await writeDataModule('login-dispatch-wasm-data.ts', [
  ['STARBUCKS_LOGIN_DISPATCH_WASM_BASE64', loginModules[0].bytes.toString('base64')],
  ['STARBUCKS_LOGIN_DISPATCH_WASM_SHA256', loginModules[0].digest],
])
await writeDataModule('login-table-wasm-data.ts', [
  ['STARBUCKS_LOGIN_TABLE_WASM_BASE64', loginModules[1].bytes.toString('base64')],
  ['STARBUCKS_LOGIN_TABLE_WASM_SHA256', loginModules[1].digest],
])
await writeDataModule('kxz-bundle-data.ts', [
  [
    'STARBUCKS_KXZ_SCRIPT_SHA256',
    {
      instrumentation: sha256(instrumentation),
      bootstrap: sha256(bootstrap),
      main: sha256(kxzMain),
    },
  ],
  ['STARBUCKS_LOGIN_ANTI_BOT_SCRIPT_SHA256', sha256(loginMain)],
])

const manifest = {
  generatedBy: 'extract-starbucks-antibot-ts.mjs',
  sourceDirectory: inputDirectory,
  outputDirectory: outputDir,
  bundles: {
    kxz: {
      variables: kxz.variables,
      handlers: kxz.handlers.length,
      metadata: kxz.metadata.length,
      strings: kxz.strings.length,
      memoryBytes: kxzMemory.length,
      wasm: kxzModules.map(({ bytes, digest }) => ({ bytes: bytes.length, sha256: digest })),
    },
    login: {
      variables: login.variables,
      handlers: login.handlers.length,
      metadata: login.metadata.length,
      strings: login.strings.length,
      memoryBytes: loginMemory.length,
      memorySource: loginMemorySourceDescription,
      wasm: loginModules.map(({ bytes, digest }) => ({ bytes: bytes.length, sha256: digest })),
    },
  },
}
await writeFile(
  join(outputDir, 'kxz-bundle-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log(JSON.stringify(manifest, null, 2))
