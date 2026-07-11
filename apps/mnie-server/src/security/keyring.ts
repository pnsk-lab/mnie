import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

const SERVICE = 'mnie'
const ENCRYPTION_KEY_ACCOUNT = 'credential-encryption-key:v1'
const LEGACY_SERVICES = ['csbie'] as const
const SQLITE_BACKEND = 'sqlite'
const PLATFORM_BACKEND = 'platform'

type KeyringBackend = typeof PLATFORM_BACKEND | typeof SQLITE_BACKEND

type Keytar = typeof import('@napi-rs/keyring/keytar')

let keytar: Keytar | undefined
let sqlite: Database | undefined

const keyringBackend = (): KeyringBackend => {
  const backend = process.env.MNIE_KEYRING_BACKEND ?? PLATFORM_BACKEND
  if (backend === PLATFORM_BACKEND || backend === SQLITE_BACKEND) return backend
  throw new Error(`unsupported MNIE_KEYRING_BACKEND: ${backend}`)
}

const loadKeytar = async () => {
  keytar ??= await import('@napi-rs/keyring/keytar')
  return keytar
}

const sqlitePath = () =>
  resolve(
    process.env.MNIE_KEYRING_SQLITE_PATH ??
      process.env.MNIE_DATABASE_PATH?.replace(/\.sqlite$/u, '.keyring.sqlite') ??
      './data/mnie-app.keyring.sqlite',
  )

const sqliteKey = () => {
  const secret = process.env.MNIE_KEYRING_SECRET
  if (!secret) {
    throw new Error('MNIE_KEYRING_SECRET is required when MNIE_KEYRING_BACKEND=sqlite')
  }
  return createHash('sha256').update(secret).digest()
}

const keyringDb = () => {
  if (sqlite) return sqlite
  const path = sqlitePath()
  mkdirSync(dirname(path), { recursive: true })
  sqlite = new Database(path, { create: true, strict: true })
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS keyring_secrets (
      service TEXT NOT NULL,
      account TEXT NOT NULL,
      nonce TEXT NOT NULL,
      tag TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (service, account)
    )
  `)
  return sqlite
}

const encrypt = (plaintext: string) => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sqliteKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

const decrypt = (row: { nonce: string; tag: string; ciphertext: string }) => {
  const decipher = createDecipheriv('aes-256-gcm', sqliteKey(), Buffer.from(row.nonce, 'base64url'))
  decipher.setAuthTag(Buffer.from(row.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Keeps the data-encryption key separate from the credential payload.  On a
 * desktop installation this lives in the OS keyring; the SQLite keyring
 * backend encrypts it with its explicitly configured deployment secret.
 */
const encryptionKey = async (): Promise<Buffer> => {
  if (keyringBackend() === PLATFORM_BACKEND) {
    const { getPassword, setPassword } = await loadKeytar()
    const existing = await getPassword(SERVICE, ENCRYPTION_KEY_ACCOUNT)
    if (existing) {
      const key = Buffer.from(existing, 'base64url')
      if (key.length !== 32) throw new Error('stored credential encryption key is invalid')
      return key
    }
    const key = randomBytes(32)
    await setPassword(SERVICE, ENCRYPTION_KEY_ACCOUNT, key.toString('base64url'))
    return key
  }

  const query = keyringDb().query<
    { nonce: string; tag: string; ciphertext: string },
    [string, string]
  >('SELECT nonce, tag, ciphertext FROM keyring_secrets WHERE service = ? AND account = ?')
  const existing = query.get(SERVICE, ENCRYPTION_KEY_ACCOUNT)
  if (existing) {
    const key = Buffer.from(decrypt(existing), 'base64url')
    if (key.length !== 32) throw new Error('stored credential encryption key is invalid')
    return key
  }
  const key = randomBytes(32)
  const sealed = encrypt(key.toString('base64url'))
  keyringDb()
    .query(
      'INSERT INTO keyring_secrets (service, account, nonce, tag, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(SERVICE, ENCRYPTION_KEY_ACCOUNT, sealed.nonce, sealed.tag, sealed.ciphertext, Date.now())
  return key
}

const sealCredential = async (payload: string) => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return JSON.stringify({
    version: 1,
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  })
}

const openCredential = async (payload: string) => {
  const value: unknown = JSON.parse(payload)
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    // Existing installations used the keyring payload directly. It is read
    // once for migration compatibility and rewritten encrypted on the next save.
    return payload
  }
  const sealed = value as { nonce: string; tag: string; ciphertext: string }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    await encryptionKey(),
    Buffer.from(sealed.nonce, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export const saveSecret = async (account: string, secret: unknown) => {
  const payload = await sealCredential(JSON.stringify(secret))
  if (keyringBackend() === PLATFORM_BACKEND) {
    const { setPassword } = await loadKeytar()
    await setPassword(SERVICE, account, payload)
    return
  }

  const encrypted = encrypt(payload)
  keyringDb()
    .query(
      `
        INSERT INTO keyring_secrets (service, account, nonce, tag, ciphertext, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(service, account) DO UPDATE SET
          nonce = excluded.nonce,
          tag = excluded.tag,
          ciphertext = excluded.ciphertext,
          updated_at = excluded.updated_at
      `,
    )
    .run(SERVICE, account, encrypted.nonce, encrypted.tag, encrypted.ciphertext, Date.now())
}

export const readSecret = async <T>(account: string): Promise<T> => {
  if (keyringBackend() === PLATFORM_BACKEND) {
    const { getPassword } = await loadKeytar()
    const secret = await getPassword(SERVICE, account)
    if (!secret) throw new Error(`secret not found: ${account}`)
    return JSON.parse(await openCredential(secret)) as T
  }

  const query = keyringDb().query<
    { nonce: string; tag: string; ciphertext: string },
    [string, string]
  >(
    `
        SELECT nonce, tag, ciphertext
        FROM keyring_secrets
        WHERE service = ? AND account = ?
      `,
  )
  const row =
    query.get(SERVICE, account) ??
    LEGACY_SERVICES.map((service) => query.get(service, account)).find(Boolean)
  const secret = row ? decrypt(row) : undefined
  if (!secret) throw new Error(`secret not found: ${account}`)
  return JSON.parse(await openCredential(secret)) as T
}

export const deleteSecret = async (account: string) => {
  if (keyringBackend() === PLATFORM_BACKEND) {
    const { deletePassword } = await loadKeytar()
    await deletePassword(SERVICE, account)
    return
  }

  keyringDb()
    .query('DELETE FROM keyring_secrets WHERE service = ? AND account = ?')
    .run(SERVICE, account)
}
