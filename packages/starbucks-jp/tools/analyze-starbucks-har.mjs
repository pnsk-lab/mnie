import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const input = process.argv[2]
const outputDir = process.argv[3] ?? 'workspace/starbucks-static-analysis'

if (!input) {
  console.error('usage: node analyze-starbucks-har.mjs <har> [output-dir]')
  process.exitCode = 2
} else {
  const har = JSON.parse(await readFile(input, 'utf8'))
  const entries = har?.log?.entries
  if (!Array.isArray(entries)) throw new Error('HAR does not contain log.entries')

  const body = (entry) => {
    const text = entry?.response?.content?.text
    if (typeof text !== 'string') return ''
    if (entry.response.content.encoding === 'base64')
      return Buffer.from(text, 'base64').toString('utf8')
    return text
  }
  const digest = (value) => createHash('sha256').update(value).digest('hex')
  const urlOf = (entry) => new URL(entry.request.url)
  const jsEntries = entries.filter((entry) => {
    const mime = entry.response?.content?.mimeType ?? ''
    return (
      /^javascript|ecmascript|text\/javascript/i.test(mime) ||
      /\.js(?:\?|$)/i.test(entry.request.url)
    )
  })
  const find = (predicate, description) => {
    const entry = jsEntries.find(predicate)
    if (!entry) throw new Error(`could not find ${description} in HAR`)
    return entry
  }
  const findOptional = (predicate) => jsEntries.find(predicate)
  const kxzSingle = find((entry) => urlOf(entry).searchParams.has('single'), 'KXZ single script')
  const kxzBootstrap = find((entry) => {
    const url = urlOf(entry)
    return url.searchParams.has('async') && !url.searchParams.has('seed')
  }, 'KXZ bootstrap script')
  const kxzMain = find((entry) => {
    const url = urlOf(entry)
    return url.searchParams.has('seed') && url.searchParams.has('KXZ2x4Fzkp--z')
  }, 'KXZ main script')
  const iovation = find(
    (entry) => /\/static_wdp\.js(?:\?|$)/i.test(entry.request.url),
    'iOvation static WDP',
  )
  const iovationDynamic = findOptional((entry) => /\/dyn_wdp\.js(?:\?|$)/i.test(entry.request.url))
  const iovationLogo = findOptional((entry) => /\/logo\.js(?:\?|$)/i.test(entry.request.url))
  const loginHTML = entries.find((entry) => {
    const url = urlOf(entry)
    return url.pathname === '/login' && /^text\/html/i.test(entry.response?.content?.mimeType ?? '')
  })
  if (!loginHTML) throw new Error('could not find login HTML in HAR')
  const inlineScripts = [...body(loginHTML).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1] ?? '',
  )
  const loginAntiBot = inlineScripts.sort((left, right) => right.length - left.length)[0] ?? ''
  if (!loginAntiBot) throw new Error('login HTML did not contain an inline script')

  await mkdir(outputDir, { recursive: true })
  const files = [
    { name: 'kxz-instrumentation.js', entry: kxzSingle },
    { name: 'kxz-bootstrap.js', entry: kxzBootstrap },
    { name: 'kxz-main.js', entry: kxzMain },
    { name: 'iovation-static-wdp.js', entry: iovation },
    ...(iovationDynamic ? [{ name: 'iovation-dynamic-wdp.js', entry: iovationDynamic }] : []),
    ...(iovationLogo ? [{ name: 'iovation-logo.js', entry: iovationLogo }] : []),
    { name: 'login-inline-anti-bot.js', entry: loginHTML, value: loginAntiBot },
  ]
  const manifest = { source: basename(input), files: [] }
  for (const { name, entry, value: override } of files) {
    const value = override ?? body(entry)
    const file = join(outputDir, name)
    await writeFile(file, value)
    manifest.files.push({
      name,
      file,
      harIndex: entries.indexOf(entry),
      url: entry.request.url,
      bytes: Buffer.byteLength(value),
      sha256: digest(value),
    })
  }
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify(manifest, null, 2))
}
