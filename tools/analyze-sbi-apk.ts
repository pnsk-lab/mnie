import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

interface ApiClass {
  file: string
  packageName: string | null
  className: string | null
  extendsName: string | null
  responseType: string | null
  trCodes: string[]
  paths: string[]
  method: string | null
  requestParams: string[]
  fixedFields: Array<{ line: number; width: number; value: string }>
  responseReads: Array<{ line: number; setter: string | null; width: number }>
}

interface Finding {
  generatedAt: string
  input: {
    jadx: string
    apktool: string
  }
  app: {
    packageName: string | null
    appClass: string | null
    networkSecurityConfig: string | null
    cleartextTrafficPermitted: boolean | null
    deepLinks: string[]
    permissions: string[]
    nativeLibs: string[]
  }
  urls: string[]
  resourceStrings: Record<string, string>
  api: {
    baseUrls: string[]
    appConfigUrls: string[]
    mts: {
      endpointPath: string
      loginPath: string
      logoutPath: string
      contentType: string
      encoding: string
      classes: ApiClass[]
    }
    otherClasses: ApiClass[]
  }
  notes: string[]
}

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1])
}

const jadxRoot = args.get('--jadx') ?? 'workspace/decoded/jadx'
const apktoolRoot = args.get('--apktool') ?? 'workspace/decoded/apktool'
const outDir = args.get('--out') ?? 'workspace/analysis'

function walk(dir: string, predicate = (_path: string) => true): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const st = statSync(path)
    if (st.isDirectory()) result.push(...walk(path, predicate))
    else if (predicate(path)) result.push(path)
  }
  return result
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function lineNo(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function readMaybe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function matchAll(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m)
  return out
}

function extractUrls(text: string): string[] {
  return unique(
    matchAll(/https?:\/\/[^\s"'<>),;]+/g, text)
      .map((m) => m[0].replace(/\\u0026/g, '&').replace(/[\\"]+$/g, ''))
      .sort(),
  )
}

function parseManifest(text: string) {
  const packageName = text.match(/\bpackage="([^"]+)"/)?.[1] ?? null
  const appTag = text.match(/<application\b[^>]+>/)?.[0] ?? ''
  const appClass = appTag.match(/android:name="([^"]+)"/)?.[1] ?? null
  const networkSecurityConfig =
    text.match(/android:networkSecurityConfig="@xml\/([^"]+)"/)?.[1] ?? null
  const permissions = unique(
    matchAll(/<uses-permission[^>]+android:name="([^"]+)"/g, text).map((m) => m[1]),
  )
  const deepLinks = unique(
    matchAll(/<data\b[^>]*\/>/g, text)
      .map((m) => {
        const tag = m[0]
        const scheme = tag.match(/android:scheme="([^"]+)"/)?.[1]
        const host = tag.match(/android:host="([^"]+)"/)?.[1]
        return scheme ? `${scheme}${host ? `://${host}` : ':'}` : null
      })
      .filter((s): s is string => Boolean(s)),
  )
  return { packageName, appClass, networkSecurityConfig, permissions, deepLinks }
}

function parseStringsXml(text: string): Record<string, string> {
  const strings: Record<string, string> = {}
  for (const m of matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g, text)) {
    const value = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    if (/https?:\/\/|token|api|firebase|sender|bucket|project|url/i.test(`${m[1]} ${value}`)) {
      strings[m[1]] = value
    }
  }
  return strings
}

function parseApiClass(path: string, text: string): ApiClass {
  const packageName = text.match(/^package\s+([^;]+);/m)?.[1] ?? null
  const cls = text.match(/\bclass\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$]+))?/)
  const responseType = text.match(/mo562b\(([A-Za-z0-9_.$]+)\.class\)/)?.[1] ?? null
  const paths = unique(
    matchAll(/mo2914w\(\)[\s\S]*?return\s+"([^"]+)"/g, text)
      .map((m) => m[1])
      .filter((s) => s.startsWith('/')),
  )
  const trCodes = unique(matchAll(/return\s+"([A-Z][0-9]{4})"/g, text).map((m) => m[1]))
  const method = text.match(/mo2912u\(\)[\s\S]*?return\s+"(GET|POST|PUT|DELETE)"/)?.[1] ?? null
  const requestParams = unique(matchAll(/m2906n\("([^"]+)"/g, text).map((m) => m[1]))
  const fixedFields = matchAll(/m904(?:7H|8I|9J)\((\d+),\s*([^)]+)\)/g, text).map((m) => ({
    line: lineNo(text, m.index),
    width: Number(m[1]),
    value: m[2].trim(),
  }))
  const responseReads = matchAll(/(?:(set[A-Za-z0-9_]+)\()?m9051V\((\d+)\)/g, text).map((m) => ({
    line: lineNo(text, m.index),
    setter: m[1] ?? null,
    width: Number(m[2]),
  }))

  return {
    file: relative(process.cwd(), path),
    packageName,
    className: cls?.[1] ?? null,
    extendsName: cls?.[2] ?? null,
    responseType,
    trCodes,
    paths,
    method,
    requestParams,
    fixedFields,
    responseReads,
  }
}

function toMarkdown(finding: Finding): string {
  const lines: string[] = []
  lines.push('# SBI APK API analysis')
  lines.push('')
  lines.push(`Generated: ${finding.generatedAt}`)
  lines.push('')
  lines.push('## App')
  lines.push('')
  lines.push(`- Package: \`${finding.app.packageName ?? 'unknown'}\``)
  lines.push(`- Application: \`${finding.app.appClass ?? 'unknown'}\``)
  lines.push(`- Cleartext traffic: \`${finding.app.cleartextTrafficPermitted}\``)
  lines.push(`- Network security config: \`${finding.app.networkSecurityConfig ?? 'none'}\``)
  lines.push(`- Deep links: ${finding.app.deepLinks.map((s) => `\`${s}\``).join(', ')}`)
  lines.push(`- Native libs: ${finding.app.nativeLibs.map((s) => `\`${s}\``).join(', ')}`)
  lines.push('')
  lines.push('## Important URLs')
  lines.push('')
  for (const url of finding.urls) lines.push(`- ${url}`)
  lines.push('')
  lines.push('## MTS protocol')
  lines.push('')
  lines.push(`- Base URL default: \`${finding.api.baseUrls[0] ?? 'unknown'}\``)
  lines.push(`- AppConfig: \`${finding.api.appConfigUrls[0] ?? 'unknown'}\``)
  lines.push(`- Main endpoint: \`POST ${finding.api.mts.endpointPath}\``)
  lines.push(`- Login endpoint: \`POST ${finding.api.mts.loginPath}\``)
  lines.push(`- Logout endpoint: \`POST ${finding.api.mts.logoutPath}\``)
  lines.push(
    `- Content-Type: \`${finding.api.mts.contentType}\`, encoding: \`${finding.api.mts.encoding}\``,
  )
  lines.push('')
  lines.push(
    'MTS requests are form-encoded. Common fields are `SID`, `TRCODE`, `FSTIME`, and `TRIN`; `TRIN` is a Shift_JIS fixed-width concatenation built by `m9047H/m9049J`.',
  )
  lines.push('')
  lines.push('## MTS classes and TRCODEs')
  lines.push('')
  lines.push('| Class | Response | TRCODE(s) | Request widths | Response reads | File |')
  lines.push('|---|---|---:|---:|---:|---|')
  for (const c of finding.api.mts.classes) {
    lines.push(
      `| \`${c.className ?? ''}\` | \`${c.responseType ?? ''}\` | ${c.trCodes.map((x) => `\`${x}\``).join(', ')} | ${c.fixedFields.length} | ${c.responseReads.length} | \`${c.file}\` |`,
    )
  }
  lines.push('')
  lines.push('## Resource strings')
  lines.push('')
  for (const [k, v] of Object.entries(finding.resourceStrings)) lines.push(`- \`${k}\`: \`${v}\``)
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  for (const note of finding.notes) lines.push(`- ${note}`)
  lines.push('')
  return lines.join('\n')
}

const manifestText = readMaybe(join(apktoolRoot, 'AndroidManifest.xml')) ?? ''
const manifest = parseManifest(manifestText)
const networkXml = manifest.networkSecurityConfig
  ? readMaybe(join(apktoolRoot, 'res/xml', `${manifest.networkSecurityConfig}.xml`))
  : null
const cleartext = networkXml?.includes('cleartextTrafficPermitted="false"')
  ? false
  : networkXml?.includes('cleartextTrafficPermitted="true"')
    ? true
    : null
const strings = parseStringsXml(readMaybe(join(apktoolRoot, 'res/values/strings.xml')) ?? '')
const nativeLibs = walk(join(apktoolRoot, 'lib'), (p) => p.endsWith('.so'))
  .map((p) => relative(join(apktoolRoot, 'lib'), p))
  .sort()

const javaFiles = walk(join(jadxRoot, 'sources'), (p) => p.endsWith('.java'))
const allJavaText = javaFiles.map((p) => readFileSync(p, 'utf8')).join('\n')
const c1209a = readMaybe(join(jadxRoot, 'sources/p109L4/C1209a.java')) ?? ''
const apiFiles = javaFiles.filter(
  (p) => p.includes('/jp/co/sbisec/sbikabu/api/') || p.includes('/p118M4/'),
)
const parsed = apiFiles.map((p) => parseApiClass(p, readFileSync(p, 'utf8')))
const mtsClasses = parsed
  .filter((c) => c.trCodes.length > 0 || c.paths.some((p) => p.includes('mtsmobile')))
  .sort((a, b) =>
    (a.trCodes[0] ?? a.className ?? '').localeCompare(b.trCodes[0] ?? b.className ?? ''),
  )

const urls = unique([
  ...extractUrls(allJavaText),
  ...extractUrls(Object.values(strings).join('\n')),
  ...extractUrls(
    readMaybe(join(apktoolRoot, 'assets/fraudalert/FraudAlertSDK_Setting_Prod.json')) ?? '',
  ),
]).sort()

const finding: Finding = {
  generatedAt: new Date().toISOString(),
  input: { jadx: jadxRoot, apktool: apktoolRoot },
  app: {
    packageName: manifest.packageName,
    appClass: manifest.appClass,
    networkSecurityConfig: manifest.networkSecurityConfig,
    cleartextTrafficPermitted: cleartext,
    deepLinks: manifest.deepLinks,
    permissions: manifest.permissions,
    nativeLibs,
  },
  urls,
  resourceStrings: strings,
  api: {
    baseUrls: extractUrls(c1209a),
    appConfigUrls: extractUrls(c1209a).filter((u) => u.endsWith('/AppConfig.json')),
    mts: {
      endpointPath: '/mtsmobile/commgate',
      loginPath: '/mtsmobile/loginesgate',
      logoutPath: '/mtsmobile/logoutgate',
      contentType: 'application/x-www-form-urlencoded',
      encoding: 'Shift_JIS',
      classes: mtsClasses,
    },
    otherClasses: parsed.filter(
      (c) => !mtsClasses.includes(c) && (c.paths.length > 0 || c.responseType),
    ),
  },
  notes: [
    'Eversafe and FraudAlert SDKs are present. Eversafe includes trustkit/pinning code and native libraries.',
    'MTS API classes are obfuscated, but response class names and TRCODE constants are recoverable from jadx output.',
    'The production AppConfig can override MTS and related URLs at runtime via AppConfigResponse.AppConfig.mtsURL.',
  ],
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'sbi-apk-api-analysis.json'), `${JSON.stringify(finding, null, 2)}\n`)
writeFileSync(join(outDir, 'sbi-apk-api-analysis.md'), toMarkdown(finding))

console.log(`Wrote ${join(outDir, 'sbi-apk-api-analysis.json')}`)
console.log(`Wrote ${join(outDir, 'sbi-apk-api-analysis.md')}`)
console.log(`MTS classes: ${finding.api.mts.classes.length}`)
console.log(`URLs: ${finding.urls.length}`)
