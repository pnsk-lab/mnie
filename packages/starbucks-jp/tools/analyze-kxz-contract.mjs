import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Extract the KXZ host contract without evaluating the vendor bundle.
 *
 * This intentionally does not use WebAssembly.Module.  The output is a
 * release manifest for the eventual TypeScript port: it records the import
 * signatures, exports, and the small JS-side wire contract exposed by the
 * instrumentation/bootstrap files.  It is analysis data, not a runtime.
 */

const [mainFile, instrumentationFile, bootstrapFile, outputDirectory = '.'] = process.argv.slice(2)

if (!mainFile) {
  console.error(
    'usage: node analyze-kxz-contract.mjs <main-js> [instrumentation-js] [bootstrap-js] [output-dir]',
  )
  process.exitCode = 2
  throw new Error('missing KXZ main script')
}

const read = (file) => fs.readFileSync(file, 'utf8')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

const decodeJavaScriptString = (value) =>
  value.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})|\\(.)/gi, (_match, hex, unicode, escaped) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16))
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16))
    if (escaped === 'n') return '\n'
    if (escaped === 'r') return '\r'
    if (escaped === 't') return '\t'
    if (escaped === 'b') return '\b'
    if (escaped === 'f') return '\f'
    if (escaped === 'v') return '\v'
    return escaped ?? ''
  })

const extractWasmStrings = (source) => {
  const modules = []
  const seen = new Set()
  const literals = /[A-Za-z_$][\w$]*\(\s*(?:"((?:\\.|[^"\\]){128,})"|'((?:\\.|[^'\\]){128,})')/g
  for (const match of source.matchAll(literals)) {
    const decoded = decodeJavaScriptString(match[1] ?? match[2] ?? '')
    if (!/^[A-Za-z0-9+/=_-]+$/.test(decoded)) continue
    const bytes = Buffer.from(decoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (bytes.subarray(0, 4).toString('hex') !== '0061736d') continue
    const digest = sha256(bytes)
    if (seen.has(digest)) continue
    seen.add(digest)
    modules.push({ bytes, digest })
  }
  if (!modules.length) throw new Error('no embedded WebAssembly modules found')
  return modules
}

const valTypes = new Map([
  [0x7f, 'i32'],
  [0x7e, 'i64'],
  [0x7d, 'f32'],
  [0x7c, 'f64'],
  [0x7b, 'v128'],
  [0x70, 'funcref'],
  [0x6f, 'externref'],
])

const parser = (bytes) => {
  let offset = 8
  const types = []
  const imports = []
  const exports = []

  const u8 = () => {
    if (offset >= bytes.length) throw new Error('truncated WASM')
    return bytes[offset++]
  }
  const u32 = () => {
    let value = 0
    let shift = 0
    while (true) {
      const byte = u8()
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return value >>> 0
      shift += 7
      if (shift > 35) throw new Error('invalid WASM varuint')
    }
  }
  const string = () => {
    const length = u32()
    const value = Buffer.from(bytes.subarray(offset, offset + length)).toString('utf8')
    offset += length
    return value
  }
  const kind = (value) =>
    ({ 0: 'function', 1: 'table', 2: 'memory', 3: 'global', 4: 'tag' })[value] ?? `kind-${value}`
  const limits = () => {
    const flags = u8()
    const minimum = u32()
    const maximum = flags & 1 ? u32() : undefined
    return maximum === undefined ? { minimum } : { minimum, maximum }
  }

  if (bytes.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('invalid WASM magic')
  while (offset < bytes.length) {
    const sectionId = u8()
    const sectionSize = u32()
    const sectionEnd = offset + sectionSize
    if (sectionEnd > bytes.length) throw new Error('truncated WASM section')

    if (sectionId === 1) {
      for (let count = u32(); count > 0; count--) {
        if (u8() !== 0x60) throw new Error('unsupported WASM type form')
        const parameters = Array.from({ length: u32() }, () => valTypes.get(u8()) ?? 'unknown')
        const results = Array.from({ length: u32() }, () => valTypes.get(u8()) ?? 'unknown')
        types.push({ parameters, results })
      }
    } else if (sectionId === 2) {
      for (let count = u32(); count > 0; count--) {
        const module = string()
        const name = string()
        const kindCode = u8()
        const entry = { module, name, kind: kind(kindCode) }
        if (kindCode === 0) entry.typeIndex = u32()
        else if (kindCode === 1) {
          entry.elementType = valTypes.get(u8()) ?? 'unknown'
          entry.limits = limits()
        } else if (kindCode === 2) entry.limits = limits()
        else if (kindCode === 3) {
          entry.valueType = valTypes.get(u8()) ?? 'unknown'
          entry.mutable = Boolean(u8())
        } else if (kindCode === 4) {
          entry.attribute = u32()
          entry.typeIndex = u32()
        }
        imports.push(entry)
      }
    } else if (sectionId === 7) {
      for (let count = u32(); count > 0; count--)
        exports.push({ name: string(), kind: kind(u8()), index: u32() })
    }
    offset = sectionEnd
  }

  return {
    types,
    imports: imports.map((entry) =>
      entry.kind === 'function'
        ? { ...entry, signature: types[entry.typeIndex] ?? { parameters: [], results: [] } }
        : entry,
    ),
    exports,
  }
}

const scriptContract = (source) => ({
  hasShouldHook: /shouldHook/.test(source),
  hasGetEncodedData: /getEncodedData/.test(source),
  hasChunk: /\bchunk\b/.test(source),
  hasHeaderChunkSize: /headerChunkSize/.test(source),
  hasHeaderNamePrefix: /headerNamePrefix/.test(source),
  eventNames: [
    ...new Set([...source.matchAll(/addEventListener\(\s*["']([^"']+)["']/g)].map((m) => m[1])),
  ],
})

const source = read(mainFile)
const modules = extractWasmStrings(source).map(({ bytes, digest }, index) => ({
  index,
  bytes: bytes.byteLength,
  sha256: digest,
  ...parser(bytes),
}))

const scripts = Object.fromEntries(
  [
    ['instrumentation', instrumentationFile],
    ['bootstrap', bootstrapFile],
  ]
    .filter(([, file]) => file)
    .map(([name, file]) => {
      const body = read(file)
      return [
        name,
        {
          file: path.resolve(file),
          bytes: Buffer.byteLength(body),
          sha256: sha256(body),
          contract: scriptContract(body),
        },
      ]
    }),
)

const manifest = {
  generatedBy: 'analyze-kxz-contract.mjs',
  main: { file: path.resolve(mainFile), bytes: Buffer.byteLength(source), sha256: sha256(source) },
  scripts,
  modules,
  notes: [
    'This manifest is static analysis only; it does not instantiate WebAssembly or execute JavaScript.',
    'Module imports are the host callback contract that a pure TypeScript port must replace.',
  ],
}

fs.mkdirSync(outputDirectory, { recursive: true })
const output = path.join(outputDirectory, 'kxz-contract.json')
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
for (const module of modules)
  console.log(
    `${module.index}: ${module.bytes} bytes, ${module.imports.length} imports, ${module.exports.length} exports`,
  )
console.log(output)
