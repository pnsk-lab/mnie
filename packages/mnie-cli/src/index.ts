#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { connectMnie } from '@repo/client-mnie'

interface Profile {
  origin: string
  apiKeyStorage: 'file' | 'keyring'
  apiKey?: string
  keyringAccount?: string
}

interface ProfilesFile {
  defaultProfile?: string
  profiles: Record<string, Profile>
}

const SERVICE = 'mnie-cli'
const configDir = join(homedir(), '.mnie-cli')
const configPath = join(configDir, 'profiles.json')

const help = `mnie cli

Usage:
  mnie --help
  mnie profile add <name> --origin <origin> --api-key <key> [--storage file|keyring]
  mnie profile list
  mnie profile use <name>
  mnie rpc methods [--profile <name>]
  mnie rpc call <method> [json-params] [--profile <name>] [--provider sbisec|smbc-direct] [--profile-id <id>]
  mnie login --origin <origin> [--profile <name>] [--scopes <scopes>] [--storage file|keyring]

Examples:
  mnie profile add local --origin http://127.0.0.1:8787 --api-key mnie_xxx
  mnie rpc call account.profile --provider sbisec --profile-id sbi_xxx
`

const parseOptions = (args: string[]) => {
  const positionals: string[] = []
  const options: Record<string, string | true> = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }
    options[key] = next
    index++
  }
  return { positionals, options }
}

const option = (options: Record<string, string | true>, key: string) => {
  const value = options[key]
  return typeof value === 'string' ? value : undefined
}

const isString = (value: string | undefined): value is string => typeof value === 'string'

const loadProfiles = async (): Promise<ProfilesFile> => {
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as ProfilesFile
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
      return { profiles: {} }
    }
    throw cause
  }
}

const saveProfiles = async (profiles: ProfilesFile) => {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(profiles, null, 2)}\n`, { mode: 0o600 })
  await chmod(configPath, 0o600)
}

const keyring = async () => import('@napi-rs/keyring/keytar')

const saveApiKey = async (
  name: string,
  origin: string,
  apiKey: string,
  storage: 'file' | 'keyring',
) => {
  if (storage === 'file') return { apiKey, apiKeyStorage: storage } as const
  const account = `profile:${name}`
  const { setPassword } = await keyring()
  await setPassword(SERVICE, account, JSON.stringify({ origin, apiKey }))
  return { keyringAccount: account, apiKeyStorage: storage } as const
}

const readApiKey = async (name: string, profile: Profile) => {
  if (profile.apiKeyStorage === 'file') {
    if (!profile.apiKey) throw new Error(`profile ${name} has no file api key`)
    return profile.apiKey
  }
  if (!profile.keyringAccount) throw new Error(`profile ${name} has no keyring account`)
  const { getPassword } = await keyring()
  const payload = await getPassword(SERVICE, profile.keyringAccount)
  if (!payload) throw new Error(`profile ${name} api key was not found in keyring`)
  return (JSON.parse(payload) as { apiKey: string }).apiKey
}

const requireProfile = async (name?: string) => {
  const profiles = await loadProfiles()
  const selected = name ?? profiles.defaultProfile
  if (!selected) throw new Error('profile is required')
  const profile = profiles.profiles[selected]
  if (!profile) throw new Error(`profile not found: ${selected}`)
  return { name: selected, profile, apiKey: await readApiKey(selected, profile) }
}

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const addProfile = async (args: string[]) => {
  const { positionals, options } = parseOptions(args)
  const name = positionals[0]
  const origin = option(options, 'origin')
  const apiKey = option(options, 'api-key')
  const storage = option(options, 'storage') ?? 'file'
  if (!name || !origin || !apiKey)
    throw new Error('profile add requires name, --origin and --api-key')
  if (storage !== 'file' && storage !== 'keyring')
    throw new Error('--storage must be file or keyring')
  const profiles = await loadProfiles()
  profiles.profiles[name] = {
    origin: new URL(origin).origin,
    ...(await saveApiKey(name, new URL(origin).origin, apiKey, storage)),
  }
  profiles.defaultProfile ??= name
  await saveProfiles(profiles)
  printJson({ ok: true, profile: name })
}

const login = async (args: string[]) => {
  const { options } = parseOptions(args)
  const origin = option(options, 'origin')
  if (!origin) throw new Error('login requires --origin')
  const profileName = option(options, 'profile') ?? 'default'
  const scopes = option(options, 'scopes') ?? 'mcp read write trade'
  const storage = option(options, 'storage') ?? 'file'
  if (storage !== 'file' && storage !== 'keyring')
    throw new Error('--storage must be file or keyring')

  const callback = await listenForOAuthCallback()
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const client = await registerOAuthClient(new URL(origin).origin, redirectUri, scopes)
  const authorize = new URL('/authorize', origin)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', client.client_id)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('scope', scopes)

  console.error(`Open this URL to approve Mnie CLI:\n${authorize.toString()}`)
  openBrowser(authorize.toString())
  const code = await callback.code
  const tokens = await exchangeCode(new URL(origin).origin, {
    clientId: client.client_id,
    redirectUri,
    code,
    verifier,
  })
  const profiles = await loadProfiles()
  profiles.profiles[profileName] = {
    origin: new URL(origin).origin,
    ...(await saveApiKey(profileName, new URL(origin).origin, tokens.access_token, storage)),
  }
  profiles.defaultProfile = profileName
  await saveProfiles(profiles)
  printJson({ ok: true, profile: profileName, scope: tokens.scope })
}

const listenForOAuthCallback = async () => {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const error = url.searchParams.get('error')
    const value = url.searchParams.get('code')
    queueMicrotask(() => server.close())
    if (error) {
      rejectCode(new Error(error))
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Mnie login failed. You can close this tab.')
      return
    }
    if (!value) {
      rejectCode(new Error('oauth callback did not include a code'))
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Mnie login failed. You can close this tab.')
      return
    }
    resolveCode(value)
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Mnie login complete. You can close this tab.')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('failed to bind oauth callback')
  return { port: address.port, code }
}

const registerOAuthClient = async (origin: string, redirectUri: string, scopes: string) => {
  const response = await fetch(new URL('/register', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Mnie CLI',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: scopes,
    }),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<{ client_id: string }>
}

const exchangeCode = async (
  origin: string,
  options: { clientId: string; redirectUri: string; code: string; verifier: string },
) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code: options.code,
    code_verifier: options.verifier,
  })
  const response = await fetch(new URL('/token', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<{ access_token: string; scope?: string }>
}

const openBrowser = (url: string) => {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

const rpc = async (args: string[]) => {
  const { positionals, options } = parseOptions(args)
  const { name, profile, apiKey } = await requireProfile(option(options, 'profile'))
  const client = await connectMnie({ baseURL: profile.origin, token: apiKey })
  try {
    if (positionals[0] === 'methods') {
      printJson(await client.methods())
      return
    }
    if (positionals[0] !== 'call' || !positionals[1])
      throw new Error('rpc requires methods or call')
    const provider = option(options, 'provider')
    const profileId = option(options, 'profile-id')
    if (provider || profileId) {
      if (!provider || !profileId)
        throw new Error('--provider and --profile-id are required together')
      const connection = (await client.connectProvider(
        provider as 'sbisec' | 'smbc-direct',
        profileId,
      )) as { requires2fa?: boolean }
      if (connection.requires2fa) {
        throw new Error(
          'SMBC Direct requires QR approval and is not available through this non-interactive CLI command',
        )
      }
    }
    const params = positionals[2] ? JSON.parse(positionals[2]) : undefined
    const method = positionals[1]
    const result = await method.split('.').reduce<unknown>((target, key) => {
      if (!target || (typeof target !== 'object' && typeof target !== 'function')) return undefined
      return (target as Record<string, unknown>)[key]
    }, client)
    if (typeof result !== 'function') throw new Error(`method is not callable: ${method}`)
    printJson(await result(params))
  } finally {
    client.close()
    console.error(`profile: ${name}`)
  }
}

const main = async () => {
  const [command, subcommand, ...rest] = process.argv.slice(2)
  if (!command || command === '--help' || command === '-h') {
    console.log(help)
    return
  }
  if (command === 'profile' && subcommand === 'add') return addProfile(rest)
  if (command === 'profile' && subcommand === 'list') return printJson(await loadProfiles())
  if (command === 'profile' && subcommand === 'use') {
    const [name] = rest
    if (!name) throw new Error('profile use requires a name')
    const profiles = await loadProfiles()
    if (!profiles.profiles[name]) throw new Error(`profile not found: ${name}`)
    profiles.defaultProfile = name
    await saveProfiles(profiles)
    return printJson({ ok: true, profile: name })
  }
  if (command === 'rpc') return rpc([subcommand, ...rest].filter(isString))
  if (command === 'login') return login([subcommand, ...rest].filter(isString))
  throw new Error(`unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
