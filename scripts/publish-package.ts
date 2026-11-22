import { appendFileSync } from 'node:fs'
import { askOtp, publishPackage, type Bump } from './publish-lib'

const [target, bump, ...rest] = process.argv.slice(2)
const dryRun = rest.includes('--dry-run')
const otp = rest.find((a) => a.startsWith('--otp='))?.slice('--otp='.length)

if (!target || !['patch', 'minor', 'major'].includes(bump ?? '')) {
  console.error(
    'usage: bun scripts/publish-package.ts <package-name> <patch|minor|major> [--dry-run] [--otp=<code>]',
  )
  process.exit(1)
}

try {
  const result = await publishPackage(target, {
    bump: bump as Bump,
    dryRun,
    otp: otp ?? process.env.NPM_OTP,
    otpProvider: process.stdin.isTTY ? askOtp : undefined,
  })
  if (result.status === 'published') {
    console.log(`published ${result.name}@${result.version}`)
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${result.version}\ntag=${result.name}@${result.version}\n`,
      )
    }
  }
} catch (error) {
  if (error instanceof Error) console.error(error.message)
  process.exitCode = 1
}
