import { describe, expect, it } from 'vitest'
import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  privateDecrypt,
  privateEncrypt,
  randomBytes,
} from 'node:crypto'
import { KEY_ALPHABET, decryptPayload, encryptPayload, splitEnvelope } from './crypto'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

describe('KEY_ALPHABET', () => {
  it('has the 72 characters the app draws from', () => {
    expect(KEY_ALPHABET).toHaveLength(72)
    expect(new Set(KEY_ALPHABET).size).toBe(72)
  })

  it('excludes the characters never observed in captured traffic', () => {
    for (const excluded of '",./0123456789:;[\\]`{}') {
      expect(KEY_ALPHABET).not.toContain(excluded)
    }
  })
})

describe('encryptPayload', () => {
  it('lays out iv, ciphertext and wrapped key in that order', () => {
    const parts = splitEnvelope(encryptPayload('a|b|c', { publicKeyPem }))
    expect(parts.iv).toHaveLength(16)
    expect(parts.wrappedKey).toHaveLength(256)
    expect(parts.body.length % 16).toBe(0)
  })

  it('draws the iv from the app alphabet', () => {
    const { iv } = splitEnvelope(encryptPayload('x', { publicKeyPem }))
    for (const character of iv.toString('utf8')) expect(KEY_ALPHABET).toContain(character)
  })

  it('emits unpadded base64 with no line breaks', () => {
    const encoded = encryptPayload('x', { publicKeyPem })
    expect(encoded).not.toContain('=')
    expect(encoded).not.toContain('\n')
  })

  it('wraps the key with OAEP-SHA256, so the holder can unwrap it', () => {
    const { wrappedKey } = splitEnvelope(encryptPayload('field-one|field-two', { publicKeyPem }))
    // SHA-1 OAEP would throw here rather than return a 16-byte key.
    const key = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      wrappedKey,
    )
    expect(key).toHaveLength(16)
  })

  it('never repeats key material across calls', () => {
    const first = splitEnvelope(encryptPayload('x', { publicKeyPem }))
    const second = splitEnvelope(encryptPayload('x', { publicKeyPem }))
    expect(first.iv.equals(second.iv)).toBe(false)
    expect(first.body.equals(second.body)).toBe(false)
  })
})

describe('splitEnvelope', () => {
  it('rejects a blob that is not envelope-shaped', () => {
    expect(() => splitEnvelope(Buffer.alloc(64).toString('base64'))).toThrow(/not a VPass/)
  })
})

describe('decryptPayload', () => {
  it('reads a payload the issuer produced', () => {
    // The issuer signs the AES key with its private key and the client recovers
    // it with the public key, so this direction is reproducible locally.
    const key = Buffer.from('0123456789abcdef')
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-128-cbc', key, iv)
    const body = Buffer.concat([cipher.update('token|gid', 'utf8'), cipher.final()])
    const wrapped = privateEncrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, key)

    const encoded = Buffer.concat([iv, body, wrapped]).toString('base64').replace(/=+$/, '')
    expect(decryptPayload(encoded, { publicKeyPem })).toBe('token|gid')
  })

  it('rejects a wrapped key of the wrong size', () => {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-128-cbc', Buffer.from('0123456789abcdef'), iv)
    const body = Buffer.concat([cipher.update('x', 'utf8'), cipher.final()])
    const wrapped = privateEncrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.alloc(8),
    )
    const encoded = Buffer.concat([iv, body, wrapped]).toString('base64').replace(/=+$/, '')
    expect(() => decryptPayload(encoded, { publicKeyPem })).toThrow(/unwrapped key was 8 bytes/)
  })
})
