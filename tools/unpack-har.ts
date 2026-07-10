import { mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

interface HarEntry {
  request: {
    method: string
    url: string
    headers: { name: string; value: string }[]
    postData?: { text?: string }
  }
  response: {
    status: number
    content: { encoding?: string; mimeType?: string; text?: string }
  }
}

const [input, output = input?.replace(/\.har$/, '')] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: bun tools/unpack-har.ts <input.har> [output]')

const har = (await Bun.file(input).json()) as { log: { entries: HarEntry[] } }
const entries = har.log.entries
const knownBodies = new Map<string, HarEntry['response']['content']>()
for (const entry of entries) {
  if (entry.response.content.text !== undefined) {
    knownBodies.set(entry.request.url, entry.response.content)
  }
}

await mkdir(join(output, 'files'), { recursive: true })
const manifest: unknown[] = []

for (const [index, entry] of entries.entries()) {
  let content = entry.response.content
  let source: 'har' | 'matching-har-entry' | 'refetch' = 'har'
  let refetchStatus: number | undefined

  if (content.text === undefined) {
    const known = knownBodies.get(entry.request.url)
    if (known) {
      content = known
      source = 'matching-har-entry'
    } else {
      const headers = new Headers()
      for (const { name, value } of entry.request.headers) {
        if (!name.startsWith(':') && !['content-length', 'host'].includes(name.toLowerCase())) {
          headers.append(name, value)
        }
      }
      const response = await fetch(entry.request.url, {
        method: entry.request.method,
        headers,
        body:
          entry.request.method === 'GET' || entry.request.method === 'HEAD'
            ? undefined
            : entry.request.postData?.text,
        redirect: 'manual',
      })
      refetchStatus = response.status
      const bytes = new Uint8Array(await response.arrayBuffer())
      content = {
        mimeType: response.headers.get('content-type') ?? content.mimeType,
        encoding: 'base64',
        text: bytes.toBase64(),
      }
      source = 'refetch'
    }
  }

  const url = new URL(entry.request.url)
  const path = outputPath(index, url, content.mimeType)
  const bytes =
    content.encoding === 'base64'
      ? Uint8Array.fromBase64(content.text ?? '')
      : new TextEncoder().encode(content.text ?? '')
  await Bun.write(join(output, 'files', path), bytes)
  manifest.push({
    index,
    method: entry.request.method,
    url: entry.request.url,
    status: entry.response.status,
    refetchStatus,
    source,
    file: `files/${path}`,
  })
}

await Bun.write(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

function outputPath(index: number, url: URL, mimeType = '') {
  const original = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index'
  const safe = original.replaceAll(/[^\p{L}\p{N}._/-]/gu, '_')
  const extension = extname(safe) || extensionFor(mimeType)
  const stem = extension ? safe.slice(0, -extension.length) : safe
  return `${String(index).padStart(3, '0')}-${url.hostname}/${stem}${extension}`
}

function extensionFor(mimeType: string) {
  if (mimeType.includes('html')) return '.html'
  if (mimeType.includes('json')) return '.json'
  if (mimeType.includes('javascript')) return '.js'
  if (mimeType.includes('css')) return '.css'
  if (mimeType.includes('svg')) return '.svg'
  if (mimeType.includes('png')) return '.png'
  if (mimeType.includes('gif')) return '.gif'
  return '.bin'
}
