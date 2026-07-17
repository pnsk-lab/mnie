import fs from 'node:fs'
import crypto from 'node:crypto'

const input = process.argv[2]
const outputDir = process.argv[3] ?? 'workspace/starbucks-kxz-wasm'

/** Decode the subset of JavaScript string escapes used by the vendor bundle. */
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
  // The vendor bundles construct WebAssembly.Module values from base64
  // literals through an obfuscated decoder (the decoder name rotates). A
  // call-shaped scan is sufficient and does not execute untrusted JavaScript.
  const literals = /[A-Za-z_$][\w$]*\(\s*(?:"((?:\\.|[^"\\]){128,})"|'((?:\\.|[^'\\]){128,})')/g
  for (const match of source.matchAll(literals)) {
    const decoded = decodeJavaScriptString(match[1] ?? match[2] ?? '')
    if (!/^[A-Za-z0-9+/=_-]+$/.test(decoded)) continue
    const bytes = Buffer.from(decoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (bytes.subarray(0, 4).toString('hex') !== '0061736d') continue
    const digest = crypto.createHash('sha256').update(bytes).digest('hex')
    if (seen.has(digest)) continue
    seen.add(digest)
    modules.push(bytes)
  }
  if (!modules.length) throw new Error('no embedded WebAssembly modules found')
  return modules
}

/** Parse only the WASM import/export sections; never instantiate the module. */
const parseWasmContract = (bytes) => {
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
  const string = () => {
    const length = u32()
    const value = Buffer.from(bytes.subarray(offset, offset + length)).toString('utf8')
    offset += length
    return value
  }
  const kind = (value) =>
    ({ 0: 'function', 1: 'table', 2: 'memory', 3: 'global', 4: 'tag' })[value] ?? `kind-${value}`
  const skipLimits = () => {
    const flags = u8()
    u32()
    if (flags & 1) u32()
  }
  const imports = []
  const exports = []
  if (bytes.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('invalid WASM magic')
  while (offset < bytes.length) {
    const section = u8()
    const size = u32()
    const end = offset + size
    if (end > bytes.length) throw new Error('truncated WASM section')
    if (section === 2) {
      for (let count = u32(); count > 0; count--) {
        const module = string()
        const name = string()
        const kindCode = u8()
        const entry = { module, name, kind: kind(kindCode) }
        if (kindCode === 0) u32()
        else if (kindCode === 1) {
          u8()
          skipLimits()
        } else if (kindCode === 2) skipLimits()
        else if (kindCode === 3) {
          u8()
          u8()
        } else if (kindCode === 4) {
          u32()
          u32()
        }
        imports.push(entry)
      }
    } else if (section === 7) {
      for (let count = u32(); count > 0; count--)
        exports.push({ name: string(), kind: kind(u8()), index: u32() })
    }
    offset = end
  }
  return { imports, exports }
}

if (!input) {
  console.error('usage: node extract-kxz-wasm.mjs <anti-bot-js> [output-dir]')
  process.exitCode = 2
} else {
  const source = fs.readFileSync(input, 'utf8')
  const modules = extractWasmStrings(source)
  fs.mkdirSync(outputDir, { recursive: true })
  const manifest = { source: input, modules: [] }
  for (const [index, bytes] of modules.entries()) {
    const file = `${outputDir}/module-${index}.wasm`
    fs.writeFileSync(file, bytes)
    // Parsing the sections is static inspection only; neither the module nor
    // its imports are instantiated here. The contract is what the
    // TypeScript host implementation has to provide.
    const { imports, exports } = parseWasmContract(bytes)
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    manifest.modules.push({
      file,
      bytes: bytes.byteLength,
      sha256,
      imports,
      exports,
    })
    console.log(
      JSON.stringify({
        file,
        bytes: bytes.byteLength,
        sha256,
        imports: imports.length,
        exports: exports.length,
      }),
    )
  }
  fs.writeFileSync(`${outputDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
}
