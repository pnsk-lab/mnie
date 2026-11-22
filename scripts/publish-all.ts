import { PUBLISH_ORDER, askOtp, publishPackage, type Bump } from './publish-lib'

const [bumpArg, ...rest] = process.argv.slice(2)
const dryRun = rest.includes('--dry-run')
const bump: Bump = ['patch', 'minor', 'major'].includes(bumpArg ?? '') ? (bumpArg as Bump) : 'patch'

if (bumpArg && bumpArg !== bump && !rest.includes('--help')) {
  console.error('usage: bun scripts/publish-all.ts [patch|minor|major] [--dry-run] [--otp=<code>]')
  process.exit(1)
}

let otp = rest.find((a) => a.startsWith('--otp='))?.slice('--otp='.length) ?? process.env.NPM_OTP

const results: { name: string; version: string; status: string }[] = []
for (const name of PUBLISH_ORDER) {
  console.log(`\n=== ${name} ===`)
  try {
    const result = await publishPackage(name, {
      bump,
      dryRun,
      otp,
      otpProvider: process.stdin.isTTY ? async () => (otp = await askOtp()) : undefined,
    })
    results.push(result)
  } catch (error) {
    if (error instanceof Error) console.error(error.message)
    console.error(`\n${name} failed; aborting before dependents break further`)
    process.exitCode = 1
    break
  }
}

console.log('\n=== summary ===')
for (const r of results) console.log(`${r.status.padEnd(10)} ${r.name}@${r.version}`)
