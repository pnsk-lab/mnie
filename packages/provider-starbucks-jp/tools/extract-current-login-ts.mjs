import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse } from 'acorn'

/**
 * Extracts the rotating login inline VM as JSON-compatible AST/literal data.
 * This is a static parser: it never evaluates the bundle, creates a VM, or
 * instantiates WebAssembly.
 *
 * Usage: node extract-current-login-ts.mjs <login-inline.js> [output.ts]
 */
const [input, output = '/tmp/starbucks-current-login-data.ts'] = process.argv.slice(2)
if (!input)
  throw new Error('usage: node extract-current-login-ts.mjs <login-inline.js> [output.ts]')

const source = await readFile(resolve(input), 'utf8')
const ast = parse(source, {
  ecmaVersion: 'latest',
  allowHashBang: true,
  allowReturnOutsideFunction: true,
  sourceType: 'script',
})

const normalize = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(normalize)
  const result = {}
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'raw', 'regex'].includes(key)) continue
    result[key] = normalize(value)
  }
  return result
}

const declarations = new Map()
const visit = (node) => {
  if (!node || typeof node !== 'object') return
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier')
    declarations.set(node.id.name, node.init)
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }
}
visit(ast)

const required = (name) => {
  const node = declarations.get(name)
  if (!node) throw new Error(`current login declaration ${name} was not found`)
  return node
}
const array = (name) => {
  const node = required(name)
  if (node.type !== 'ArrayExpression') throw new Error(`${name} is not an array`)
  return normalize(node)
}

// The login obfuscator rotates local variable names.  Older captures used
// E/oo/oK/oE/ol/R; the current live bundle uses L/Ja/Jq/JL/Je/l.  When the
// well-known names are absent, identify the same static tables by shape. This
// remains static-only: no declaration or function body is evaluated.
const isLiteral = (node, type) =>
  node?.type === 'Literal' && (type === undefined || typeof node.value === type)
const discovered = (() => {
  if (['E', 'oo', 'oK', 'oE', 'ol', 'R'].every((name) => declarations.has(name))) return null
  const entries = [...declarations.entries()]
  const arrays = entries.filter(([, node]) => node?.type === 'ArrayExpression')
  const strings = arrays
    .filter(
      ([, node]) =>
        node.elements.length > 500 &&
        node.elements.every((item) => item === null || isLiteral(item, 'string')),
    )
    .sort((left, right) => right[1].elements.length - left[1].elements.length)[0]
  const metadata = arrays
    .filter(
      ([, node]) =>
        node.elements.length > 100 &&
        node.elements.every((item) => item?.type === 'ObjectExpression'),
    )
    .sort((left, right) => right[1].elements.length - left[1].elements.length)[0]
  const numeric = (item) =>
    isLiteral(item, 'number') ||
    (item?.type === 'UnaryExpression' &&
      ['+', '-'].includes(item.operator) &&
      isLiteral(item.argument, 'number'))
  const constants = arrays
    .filter(([, node]) => node.elements.length > 50 && node.elements.every(numeric))
    .sort((left, right) => right[1].elements.length - left[1].elements.length)[0]
  const transitions = arrays
    .filter(
      ([, node]) =>
        node.elements.length >= 2 &&
        node.elements.every((item) => item?.type === 'ArrayExpression'),
    )
    .sort((left, right) => right[1].elements.length - left[1].elements.length)[0]
  const handlers = arrays
    .filter(
      ([, node]) =>
        node.elements.length > 100 &&
        node.elements.every(
          (item) =>
            item?.type === 'FunctionExpression' ||
            (item?.type === 'ObjectExpression' &&
              item.properties?.some((property) => property.key?.name === 'body')),
        ),
    )
    .sort((left, right) => right[1].elements.length - left[1].elements.length)[0]
  const program = entries
    .filter(
      ([, node]) => node?.type === 'CallExpression' && isLiteral(node.arguments?.[0], 'string'),
    )
    .filter(([, node]) => node.arguments[0].value.length > 100_000)
    .sort(
      (left, right) => right[1].arguments[0].value.length - left[1].arguments[0].value.length,
    )[0]
  if (!strings || !metadata || !constants || !transitions || !handlers || !program)
    throw new Error('current login static tables could not be discovered by shape')
  return {
    strings: strings[0],
    metadata: metadata[0],
    constants: constants[0],
    transitions: transitions[0],
    handlers: handlers[0],
    program: program[0],
  }
})()

const tableName = (legacyName, key) => discovered?.[key] ?? legacyName
const programNode = discovered ? declarations.get(discovered.program) : required('R')
if (
  programNode.type !== 'CallExpression' ||
  programNode.callee?.type !== 'Identifier' ||
  programNode.arguments[0]?.type !== 'Literal' ||
  typeof programNode.arguments[0].value !== 'string'
)
  throw new Error('R is not a static base64 decoder call')

const data = {
  sha256: createHash('sha256').update(source).digest('hex'),
  sourceBytes: Buffer.byteLength(source),
  strings: array(tableName('E', 'strings')),
  metadata: array(tableName('oo', 'metadata')),
  constants: array(tableName('oK', 'constants')),
  transitions: array(tableName('oE', 'transitions')),
  handlers: array(tableName('ol', 'handlers')),
  programBase64: programNode.arguments[0].value,
}
const encoded = gzipSync(Buffer.from(JSON.stringify(data))).toString('base64')
const text =
  '// Generated by extract-current-login-ts.mjs; do not edit by hand.\n' +
  `export const STARBUCKS_CURRENT_LOGIN_VM_DATA_GZIP_BASE64 = ${JSON.stringify(encoded)}\n` +
  `export const STARBUCKS_CURRENT_LOGIN_VM_SOURCE_SHA256 = ${JSON.stringify(data.sha256)} as const\n` +
  `export const STARBUCKS_CURRENT_LOGIN_VM_SOURCE_BYTES = ${data.sourceBytes}\n`
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), text)
console.log(
  JSON.stringify({
    output: resolve(output),
    hash: data.sha256,
    sourceBytes: data.sourceBytes,
    strings: data.strings.elements.length,
    handlers: data.handlers.elements.length,
    programBytes: Buffer.from(data.programBase64, 'base64').length,
  }),
)
