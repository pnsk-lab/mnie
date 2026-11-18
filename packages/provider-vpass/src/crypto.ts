import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicDecrypt,
  publicEncrypt,
  randomInt,
} from 'node:crypto'

/**
 * The envelope VPass puts around authentication payloads in both directions.
 *
 * Recovered from `EncryptedMethods`, `AesEncryption` and `RsaEncryption`, none
 * of which ship in the APK's DEX files — they are AES-encrypted inside
 * `assets/fjcnwlye` and decrypted into memory at startup.
 *
 * Requests:  base64( iv[16] ‖ AES-128-CBC(plaintext, k) ‖ RSA-OAEP-SHA256(k)[256] )
 * Responses: base64( iv[16] ‖ AES-128-CBC(plaintext, k) ‖ RSA-PKCS1(k)[256]       )
 *
 * The two directions are not symmetric. Requests seal the AES key *to* the
 * issuer with OAEP, so a captured request cannot be read back without their
 * private key. Responses go the other way: the issuer encrypts the key with its
 * private key and the client recovers it with the public key. That is a
 * signature-shaped operation rather than a confidentiality one, and it is why
 * {@link decryptPayload} works with nothing but the bundled public key.
 *
 * Base64 is the app's `NO_WRAP | NO_PADDING`: standard alphabet, no line
 * breaks, trailing `=` stripped.
 */

/**
 * Alphabet the app draws the AES key and IV from — printable ASCII minus
 * `"`, `,`, `.`, `/`, the digits, `:`, `;`, `[`, `\`, `]`, `` ` ``, `{` and `}`.
 * Exactly 72 characters, matching the `nextInt(72)` in the app's generator.
 *
 * AES does not care which bytes these are. We match the app so generated
 * traffic is not trivially distinguishable from the real client.
 */
export const KEY_ALPHABET =
  "!#$%&'()*+-<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ^_abcdefghijklmnopqrstuvwxyz|~"

/**
 * `assets/f2hKiZCtFQdbfuiVGduZ.pem`.
 *
 * The APK carries four RSA public keys and picks one from a build flag and a
 * per-call boolean. This is the one the authentication path resolves to: it is
 * confirmed to unwrap real `login_token` responses, and since request-wrap and
 * response-unwrap are the same key lookup with the same argument, it is also
 * the key requests must be sealed to.
 */
export const VPASS_AUTH_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzH33qeBhL5Mg1QG49Lsj
eC39RWTyPXk95fsdqRPQRXJ902TLY6Y7D62uPiTXnhHF3/sMleNEdvOw8eDl7nDw
rB9PSa87Uo8oSUZNgfzOKhPhW8+nPbtW6qZmwhMheqKwlf0kg0EBtsaNNHkEzMkS
tjJ6xGaMf/APH2UO7/nccMlnR3gxpAztqPUPFdvCvy3+Blzb2/dZtrTIM6uJbgo2
uPyA3n5u6Dpk+EV7mob/rqK8FtiToYBScoqAlvK0PQOk7ieEGKNGGCrFMl9xSD/P
QEjWVQG6iywYAWKbDltNQU3RPj2fQah6hEYnqsc1IcGoDJZ/qWaUwS7HuD5AkNoy
awIDAQAB
-----END PUBLIC KEY-----`

const BLOCK_SIZE = 16
const RSA_BLOCK_SIZE = 256

/** 16 characters from {@link KEY_ALPHABET}, as the app's `SecureRandom` loop does. */
const randomMaterial = (length = BLOCK_SIZE) => {
  let value = ''
  for (let index = 0; index < length; index++) {
    value += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]
  }
  return Buffer.from(value, 'utf8')
}

/** `Base64.NO_WRAP | Base64.NO_PADDING`. */
const encodeBase64 = (value: Buffer) => value.toString('base64').replace(/=+$/, '')

export interface KeyOptions {
  /** PEM public key. Defaults to {@link VPASS_AUTH_PUBLIC_KEY_PEM}. */
  publicKeyPem?: string
}

/**
 * Wraps `plaintext` for transmission.
 *
 * `RSA/NONE/OAEPPadding` is called with an explicit `OAEPParameterSpec` naming
 * SHA-256 for both the digest and MGF1 — not the SHA-1 that bare `OAEPPadding`
 * would default to. Getting this wrong produces a block the issuer silently
 * cannot unwrap.
 */
export const encryptPayload = (plaintext: string, options: KeyOptions = {}): string => {
  const key = randomMaterial()
  const iv = randomMaterial()

  const cipher = createCipheriv('aes-128-cbc', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  const wrapped = publicEncrypt(
    {
      key: options.publicKeyPem ?? VPASS_AUTH_PUBLIC_KEY_PEM,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    key,
  )
  if (wrapped.length !== RSA_BLOCK_SIZE) {
    throw new Error(`expected a ${RSA_BLOCK_SIZE}-byte RSA block, got ${wrapped.length}`)
  }

  return encodeBase64(Buffer.concat([iv, body, wrapped]))
}

/**
 * Reads a payload the issuer produced, such as `login_token`.
 *
 * The AES key is recovered with a public-key PKCS#1 operation, which Node
 * exposes as `publicDecrypt`.
 */
export const decryptPayload = (encoded: string, options: KeyOptions = {}): string => {
  const { iv, body, wrappedKey } = splitEnvelope(encoded)

  const key = publicDecrypt(
    {
      key: options.publicKeyPem ?? VPASS_AUTH_PUBLIC_KEY_PEM,
      padding: constants.RSA_PKCS1_PADDING,
    },
    wrappedKey,
  )
  if (key.length !== BLOCK_SIZE) {
    throw new Error(`unwrapped key was ${key.length} bytes, expected ${BLOCK_SIZE}`)
  }

  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

export interface EnvelopeParts {
  iv: Buffer
  body: Buffer
  wrappedKey: Buffer
}

/** Splits an envelope into its three parts without decrypting anything. */
export const splitEnvelope = (encoded: string): EnvelopeParts => {
  const raw = Buffer.from(encoded, 'base64')
  const bodyLength = raw.length - BLOCK_SIZE - RSA_BLOCK_SIZE
  if (bodyLength <= 0 || bodyLength % BLOCK_SIZE !== 0) {
    throw new Error(`not a VPass auth envelope: ${raw.length} bytes`)
  }
  return {
    iv: raw.subarray(0, BLOCK_SIZE),
    body: raw.subarray(BLOCK_SIZE, BLOCK_SIZE + bodyLength),
    wrappedKey: raw.subarray(BLOCK_SIZE + bodyLength),
  }
}
