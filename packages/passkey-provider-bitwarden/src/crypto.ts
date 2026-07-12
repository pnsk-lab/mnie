import { hashRawSync } from '@node-rs/argon2'
import { createDecipheriv, createHash, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto'

export interface BitwardenKdfConfig {
  kdfType: 0 | 1
  iterations: number
  memory?: number
  parallelism?: number
}

export interface SymmetricKey {
  enc: Buffer
  mac?: Buffer
}

interface EncString {
  type: 0 | 2
  iv: Buffer
  ciphertext: Buffer
  mac?: Buffer
}

// TODO: Replace @node-rs/argon2 with node:crypto argon2Sync once Bun exposes it.
const ARGON2ID = 2

export const deriveMasterKey = (
  password: string,
  email: string,
  config: BitwardenKdfConfig,
): SymmetricKey => {
  const normalizedEmail = email.trim().toLowerCase()
  if (config.kdfType === 0) {
    return {
      enc: pbkdf2Sync(password, normalizedEmail, config.iterations, 32, 'sha256'),
    }
  }
  if (config.kdfType === 1) {
    if (!config.memory) throw new Error('Bitwarden Argon2id memory is required')
    const salt = createHash('sha256').update(normalizedEmail).digest()
    return {
      enc: hashRawSync(Buffer.from(password), {
        algorithm: ARGON2ID,
        salt,
        parallelism: config.parallelism ?? 1,
        outputLen: 32,
        memoryCost: config.memory * 1024,
        timeCost: config.iterations,
      }),
    }
  }
  throw new Error(`unsupported Bitwarden KDF type: ${config.kdfType}`)
}

export const stretchKey = (key: SymmetricKey): SymmetricKey => {
  if (key.enc.length !== 32 || key.mac) {
    throw new Error('stretchKey requires a 32-byte key without a MAC key')
  }
  return {
    enc: hkdfExpand(key.enc, 'enc', 32),
    mac: hkdfExpand(key.enc, 'mac', 32),
  }
}

export const keyFromBytes = (value: Buffer | Uint8Array): SymmetricKey => {
  const bytes = Buffer.from(value)
  if (bytes.length === 32) return { enc: bytes }
  if (bytes.length === 64) {
    return {
      enc: bytes.subarray(0, 32),
      mac: bytes.subarray(32),
    }
  }
  throw new Error(`invalid Bitwarden key length: ${bytes.length} bytes`)
}

export const decryptString = (value: string, key: SymmetricKey): Buffer => {
  const parsed = parseEncString(value)
  return decrypt(parsed, key)
}

const hkdfExpand = (key: Buffer, info: string, length: number) => {
  const blocks: Buffer[] = []
  let previous = Buffer.alloc(0)
  for (let counter = 1; Buffer.concat(blocks).length < length; counter++) {
    previous = createHmac('sha256', key)
      .update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])]))
      .digest()
    blocks.push(previous)
  }
  return Buffer.concat(blocks).subarray(0, length)
}

const parseEncString = (value: string): EncString => {
  if (!value) throw new Error('empty Bitwarden EncString')
  const dot = value.indexOf('.')
  if (dot < 0) throw new Error('Bitwarden EncString has no type prefix')
  const type = Number(value.slice(0, dot))
  const parts = value.slice(dot + 1).split('|')

  if (type === 2) {
    if (parts.length !== 3) throw new Error(`Bitwarden EncString type 2 requires 3 segments`)
    return {
      type,
      iv: decodeBase64(parts[0], 'iv'),
      ciphertext: decodeBase64(parts[1], 'ciphertext'),
      mac: decodeBase64(parts[2], 'mac'),
    }
  }
  if (type === 0) {
    if (parts.length !== 2) throw new Error(`Bitwarden EncString type 0 requires 2 segments`)
    return {
      type,
      iv: decodeBase64(parts[0], 'iv'),
      ciphertext: decodeBase64(parts[1], 'ciphertext'),
    }
  }
  throw new Error(`unsupported Bitwarden EncString type: ${type}`)
}

const decodeBase64 = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`Bitwarden EncString ${label} segment is empty`)
  return Buffer.from(value, 'base64')
}

const decrypt = (value: EncString, key: SymmetricKey): Buffer => {
  if (value.type === 2) {
    if (!key.mac) throw new Error('Bitwarden EncString type 2 requires a MAC key')
    const expected = createHmac('sha256', key.mac)
      .update(value.iv)
      .update(value.ciphertext)
      .digest()
    if (
      !value.mac ||
      expected.length !== value.mac.length ||
      !timingSafeEqual(expected, value.mac)
    ) {
      throw new Error('Bitwarden EncString MAC verification failed')
    }
  }
  const decipher = createDecipheriv('aes-256-cbc', key.enc, value.iv)
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()])
}
