import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

export const root = resolve(import.meta.dir, '..')

/** Publishable packages in dependency order. */
export const PUBLISH_ORDER = [
  '@mnie/types',
  '@mnie/provider-sbi-sec',
  '@mnie/provider-mobile-suica',
  '@mnie/provider-paypay',
  '@mnie/provider-paypay-bank',
  '@mnie/provider-paypay-sec',
  '@mnie/provider-smbc-direct',
  '@mnie/provider-vpass',
  '@mnie/provider-nissay-401k',
  '@mnie/provider-starbucks-jp',
  '@mnie/provider-mnie-server',
  '@mnie/sdk',
  '@mnie/auth-bitwarden',
  '@mnie/cli',
] as const

export type Bump = 'patch' | 'minor' | 'major'

const run = (cmd: string, cwd = root) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

const npmView = (spec: string) => {
  try {
    return run(`npm view ${spec} version --registry https://registry.npmjs.org`)
  } catch {
    return ''
  }
}

export const askOtp = () =>
  new Promise<string>((resolvePromise) => {
    process.stdout.write('npm one-time password: ')
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', (data) => resolvePromise(data.trim()))
  })

export interface PublishOptions {
  bump: Bump
  dryRun?: boolean
  /** OTP to try first (may be stale; otpProvider is asked on failure). */
  otp?: string
  /** Called when an OTP is required or the current one was rejected. */
  otpProvider?: () => string | Promise<string>
}

export interface PublishResult {
  name: string
  version: string
  status: 'published' | 'skipped' | 'dry-run'
}

export const publishPackage = async (
  name: string,
  opts: PublishOptions,
): Promise<PublishResult> => {
  const pkgDir = run(`pnpm --filter "${name}" exec pwd`)
  if (!pkgDir) throw new Error(`package not found in workspace: ${name}`)

  const pkgPath = resolve(pkgDir, 'package.json')
  const original = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(original)

  if (pkg.private || !pkg.name.startsWith('@mnie/')) {
    throw new Error(`${pkg.name} is not publishable (private or non-@mnie scope)`)
  }

  try {
    const latest = npmView(pkg.name)
    if (latest) {
      run(`npm version "${latest}" --no-git-tag-version --allow-same-version`, pkgDir)
    } else {
      console.log(`${pkg.name} is not published on npm yet; bumping from local ${pkg.version}`)
    }
    const next = run(`npm version "${opts.bump}" --no-git-tag-version`, pkgDir).replace(/^v/, '')
    if (npmView(`${pkg.name}@${next}`)) {
      console.log(`${pkg.name}@${next} is already published; skipping`)
      return { name: pkg.name, version: next, status: 'skipped' }
    }
    console.log(`${pkg.name}: ${latest || pkg.version} -> ${next}`)

    const updated = JSON.parse(readFileSync(pkgPath, 'utf8'))
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dep, spec] of Object.entries(updated[field] ?? {})) {
        if (!String(spec).startsWith('workspace:')) continue
        if (!dep.startsWith('@mnie/')) {
          throw new Error(`${dep} is an internal workspace package and cannot be resolved on npm`)
        }
        const depVersion = npmView(dep)
        if (!depVersion) {
          throw new Error(`${dep} is not published on npm yet. Publish it first.`)
        }
        updated[field][dep] = `^${depVersion}`
      }
    }
    delete updated.devDependencies
    if (updated.peerDependencies) {
      delete updated.peerDependencies.typescript
      if (!Object.keys(updated.peerDependencies).length) delete updated.peerDependencies
    }
    writeFileSync(pkgPath, `${JSON.stringify(updated, null, 2)}\n`)

    execSync(`pnpm exec vp run --no-cache "${updated.name}#build"`, {
      cwd: root,
      stdio: 'inherit',
    })

    if (opts.dryRun) {
      execSync('pnpm pack', { cwd: pkgDir, stdio: 'inherit' })
      return { name: updated.name, version: next, status: 'dry-run' }
    }

    const doPublish = (otp?: string) =>
      execSync(`pnpm publish --no-git-checks${otp ? ` --otp ${otp}` : ''}`, {
        cwd: pkgDir,
        stdio: 'inherit',
      })
    try {
      doPublish(opts.otp)
    } catch {
      const otp = await opts.otpProvider?.()
      if (!otp) throw new Error('publish failed (npm 2FA requires --otp)')
      doPublish(otp)
    }
    return { name: updated.name, version: next, status: 'published' }
  } finally {
    writeFileSync(pkgPath, original)
  }
}
