import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const deviceId = '8e15abae-2918-4237-84f5-11c456415883'
const userAgent =
  'com.smbc_card.vpass.android_v5.13.0 Mozilla/5.0 (Linux; Android 16; Test) AppleWebKit/537.36'
const generatedDeviceId = '7d5b34e1-9412-4d2a-8b6e-946cc04af522'
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), 'vpass-verify-'))
  directories.push(directory)
  const sessionPath = join(directory, 'session.json')
  const preload = join(directory, 'mock.ts')
  const observedPath = join(directory, 'observed.json')
  const entry = resolve(import.meta.dir, '../packages/provider-vpass/src/index.ts')
  const script = resolve(import.meta.dir, 'verify-vpass.ts')
  writeFileSync(
    preload,
    `import { mock } from 'bun:test'
    import { writeFileSync } from 'node:fs'
    class VpassError extends Error {
      constructor(message, metadata = {}) {
        super(message)
        this.name = 'VpassError'
        Object.assign(this, metadata)
      }
    }
    const profile = (session) => ({
      session,
      client: { jar: { export: () => ({ cookie: 'secret-cookie' }) } },
      continueSession: async () => {},
    })
    mock.module(${JSON.stringify(entry)}, () => ({
      VpassError,
      normalizeOrigin: (value) => new URL(value).origin,
      connect: async (options) => {
        writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({
          appVersion: options.appVersion,
          osVersion: options.osVersion,
          userAgent: options.userAgent,
          deviceId: options.deviceId,
          endpoint: options.endpoint,
          push: options.push,
        }))
        if (process.env.FAIL_CONNECT) {
          throw new VpassError(
            'secret-token secret-cookie secret-password server-description raw-body',
            { httpStatus: 400, providerStatus: 410, providerType: 'login_invalid' },
          )
        }
        return profile({
          ...options, loginId: undefined, password: undefined, fetch: undefined,
          deviceId: options.deviceId ?? ${JSON.stringify(generatedDeviceId)}, deviceToken: '', cardCompanyCode: '001',
          endpoint: options.endpoint ?? 'Fauth', push: options.push ?? false,
          idKind: options.idKind ?? 'vpass', apiBaseURL: String(options.apiBaseURL),
          webBaseURL: String(options.webBaseURL), appVersion: options.appVersion,
          token: 'secret-token', cookies: {},
        })
      },
      resume: async (session) => {
        if (![${JSON.stringify(deviceId)}, ${JSON.stringify(generatedDeviceId)}].includes(session.deviceId)) throw new Error('Lost device identity')
        return profile({ ...session, token: session.token + '-rotated' })
      },
      createProvider: () => ({ invoke: async (name) => {
        if (process.env.FAIL_STATEMENT && name === 'transactions.list') {
          throw new VpassError('secret-token secret-cookie secret-password')
        }
        return { items: name === 'accounts.list' ? [{}] : [] }
      } }),
    }))`,
  )
  const run = (args: string[] = [], env: Record<string, string | undefined> = {}) => {
    const baseEnv: Record<string, string | undefined> = {
      ...process.env,
      VPASS_API_BASE_URL: 'https://app.example.test',
      VPASS_WEB_BASE_URL: 'https://member.example.test',
      VPASS_ID: 'secret-id',
      VPASS_PASSWORD: 'secret-password',
      VPASS_SESSION_FILE: sessionPath,
      VPASS_DEVICE_ID: undefined,
      VPASS_OS_VERSION: undefined,
      VPASS_USER_AGENT: undefined,
      FAIL_CONNECT: undefined,
      FAIL_STATEMENT: undefined,
      VPASS_APP_VERSION: '5.13.0',
      VPASS_AUTH_ENDPOINT: undefined,
      VPASS_ID_KIND: undefined,
      VPASS_PUSH: undefined,
      VPASS_VERIFY_FROM: undefined,
      VPASS_VERIFY_TO: undefined,
      ...env,
    }
    const childEnv = Object.fromEntries(
      Object.entries(baseEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    const result = Bun.spawnSync([process.execPath, '--preload', preload, script, ...args], {
      cwd: directory,
      env: childEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    }
  }
  const session = () => JSON.parse(readFileSync(sessionPath, 'utf8'))
  const observed = () => JSON.parse(readFileSync(observedPath, 'utf8'))
  return { run, session, observed, sessionPath }
}

test('persists the rotated token with private permissions and accepts an empty statement', () => {
  const { run, session, sessionPath } = setup()
  const result = run()
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain('"stage":"complete","ok":true')
  expect(result.output).toContain('"count":0')
  expect(result.output).not.toContain('secret-')
  expect(session().token).toBe('secret-token-rotated')
  expect(session().cookies).toEqual({ cookie: 'secret-cookie' })
  expect(statSync(sessionPath).mode & 0o777).toBe(0o600)
})

test('requires an external app version and lets the provider own request defaults', () => {
  const { run, observed } = setup()
  expect(run().code).toBe(0)
  expect(observed()).toEqual({
    appVersion: '5.13.0',
    endpoint: 'Fauth',
    push: false,
  })

  const missing = run([], { VPASS_APP_VERSION: undefined })
  expect(missing.code).toBe(1)
  expect(missing.output).toContain('VPASS_APP_VERSION is required')
  expect(missing.output).not.toContain('"stage":"connect"')
})

test('forwards explicit request-profile overrides', () => {
  const { run, observed } = setup()
  expect(
    run([], {
      VPASS_DEVICE_ID: deviceId,
      VPASS_OS_VERSION: '16',
      VPASS_USER_AGENT: userAgent,
    }).code,
  ).toBe(0)
  expect(observed()).toEqual({
    appVersion: '5.13.0',
    osVersion: '16',
    userAgent,
    deviceId,
    endpoint: 'Fauth',
    push: false,
  })
})

test('persists a generated device and resumes without password credentials', () => {
  const { run, session } = setup()
  expect(run().code).toBe(0)
  expect(session().deviceId).toBe(generatedDeviceId)
  const result = run(['--resume'], {
    VPASS_ID: '',
    VPASS_PASSWORD: '',
  })
  expect(result.code, result.output).toBe(0)
  expect(session().deviceId).toBe(generatedDeviceId)
  expect(session().token).toBe('secret-token-rotated-rotated')
})

test('keeps the fresh token when statement fetching fails and hides server error text', () => {
  const { run, session } = setup()
  const result = run([], { FAIL_STATEMENT: '1' })
  expect(result.code).toBe(1)
  expect(result.output).toContain('"stage":"transactions.list","ok":false')
  expect(result.output).not.toContain('secret-')
  expect(session().token).toBe('secret-token')
})

test('reports provider metadata separately without leaking provider text', () => {
  const { run } = setup()
  const result = run([], { FAIL_CONNECT: '1' })
  expect(result.code).toBe(1)
  expect(result.output).toContain('"providerStatus":410')
  expect(result.output).toContain('"providerType":"login_invalid"')
  expect(result.output).not.toContain('secret-')
  expect(result.output).not.toContain('server-description')
  expect(result.output).not.toContain('raw-body')
})

test('rejects invalid date ranges before authentication', () => {
  const { run } = setup()
  const result = run([], { VPASS_VERIFY_FROM: '2026-02-30', VPASS_VERIFY_TO: '2026-03-01' })
  expect(result.code).toBe(1)
  expect(result.output).toContain('VPASS_VERIFY_FROM must be a valid YYYY-MM-DD date')
  expect(result.output).not.toContain('"stage":"connect"')
})

test('refuses to send a saved token to different configured origins', () => {
  const { run } = setup()
  expect(run().code).toBe(0)
  const result = run(['--resume'], { VPASS_API_BASE_URL: 'https://other.example.test' })
  expect(result.code).toBe(1)
  expect(result.output).toContain('Saved session origins do not match configured origins')
})

test('rejects malformed request-profile settings before authentication', () => {
  const { run } = setup()
  expect(run([], { VPASS_DEVICE_ID: 'not-a-uuid' }).output).toContain(
    'VPASS_DEVICE_ID must be a canonical lowercase UUID',
  )
  expect(run([], { VPASS_PUSH: 'true' }).output).toContain('VPASS_PUSH must be 0 or 1')
  expect(run([], { VPASS_OS_VERSION: '15\nInjected' }).output).toContain(
    'VPASS_OS_VERSION must be a single HTTP header value',
  )
  expect(run([], { VPASS_USER_AGENT: `${userAgent}\rInjected` }).output).toContain(
    'VPASS_USER_AGENT must be a single HTTP header value',
  )
  expect(run([], { VPASS_AUTH_ENDPOINT: 'Vauth', VPASS_ID_KIND: 'fa' }).output).toContain(
    'Vauth does not support VPASS_ID_KIND=fa',
  )
  expect(run([], { VPASS_SESSION_FILE: '' }).output).toContain(
    'VPASS_SESSION_FILE must not be empty',
  )
})
