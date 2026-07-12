import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  decryptString,
  deriveMasterKey,
  keyFromBytes,
  stretchKey,
  type BitwardenKdfConfig,
  type SymmetricKey,
} from './crypto'

export interface BitwardenPasskey {
  cipherId: string
  cipherName: string
  credentialId: string
  rpId: string
  rpName?: string
  userName?: string
  userHandle?: string
  userDisplay?: string
  counter: number
  discoverable: boolean
  keyValue: string
}

export interface BitwardenVault {
  userId: string
  email: string
  kdf: BitwardenKdfConfig
  unlock(masterPassword: string): SymmetricKey
  passkeys(userKey: SymmetricKey, rpId?: string): BitwardenPasskey[]
}

interface RawCipher {
  id?: unknown
  name?: unknown
  key?: unknown
  login?: {
    fido2Credentials?: unknown
  }
}

type RawFido2Credential = Record<string, unknown>

export const defaultBitwardenDataJsonPath = () =>
  join(
    homedir(),
    'Library',
    'Containers',
    'com.bitwarden.desktop',
    'Data',
    'Library',
    'Application Support',
    'Bitwarden',
    'data.json',
  )

export const openBitwardenVault = async (path = defaultBitwardenDataJsonPath()) =>
  openBitwardenVaultFromObject(JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>)

export const openBitwardenVaultFromObject = (data: Record<string, unknown>): BitwardenVault => {
  const userId = readString(data.global_account_activeAccountId) ?? detectUserId(data)
  if (!userId) throw new Error('Bitwarden active user ID was not found')

  const email = readString(data.global_loginEmail_storedEmail) ?? detectEmail(data, userId)
  if (!email) throw new Error('Bitwarden login email was not found')

  const kdf = readKdfConfig(data[userKey(userId, 'kdfConfig_kdfConfig')])

  return {
    userId,
    email,
    kdf,
    unlock: (masterPassword) => {
      const encryptedUserKey = readString(
        data[userKey(userId, 'masterPassword_masterKeyEncryptedUserKey')],
      )
      if (!encryptedUserKey) throw new Error('Bitwarden masterKeyEncryptedUserKey was not found')
      const masterKey = deriveMasterKey(masterPassword, email, kdf)
      const stretched = stretchKey(masterKey)
      return keyFromBytes(decryptString(encryptedUserKey, stretched))
    },
    passkeys: (userKeyValue, rpId) => {
      const ciphersValue = data[userKey(userId, 'ciphers_ciphers')]
      if (!ciphersValue) throw new Error('Bitwarden ciphers were not found')
      const ciphers = readObject(ciphersValue, 'Bitwarden ciphers')
      return Object.values(ciphers).flatMap((cipherValue) =>
        readCipherPasskeys(readObject(cipherValue, 'Bitwarden cipher'), userKeyValue, rpId),
      )
    },
  }
}

const readCipherPasskeys = (
  cipher: Record<string, unknown>,
  userKeyValue: SymmetricKey,
  rpId?: string,
): BitwardenPasskey[] => {
  const raw = cipher as RawCipher
  const login = raw.login && typeof raw.login === 'object' ? raw.login : undefined
  const credentials = Array.isArray(login?.fido2Credentials) ? login.fido2Credentials : []
  if (credentials.length === 0) return []

  const cipherId = readString(raw.id) ?? ''
  const cipherName = decryptText(
    requiredString(raw.name, `Bitwarden cipher ${cipherId} name`),
    userKeyValue,
  )
  const itemKey = raw.key
    ? keyFromBytes(decryptString(requiredString(raw.key, 'Bitwarden cipher key'), userKeyValue))
    : userKeyValue

  return credentials.flatMap((credentialValue) => {
    const credential = readObject(credentialValue, 'Bitwarden FIDO2 credential')
    const passkey = decryptPasskey(credential, itemKey, cipherId, cipherName)
    if (rpId && passkey.rpId !== rpId) return []
    return [passkey]
  })
}

const decryptPasskey = (
  credential: RawFido2Credential,
  key: SymmetricKey,
  cipherId: string,
  cipherName: string,
): BitwardenPasskey => ({
  cipherId,
  cipherName,
  credentialId: decryptField(credential, 'credentialId', key) ?? '',
  rpId: decryptField(credential, 'rpId', key) ?? '',
  rpName: decryptField(credential, 'rpName', key),
  userName: decryptField(credential, 'userName', key),
  userHandle: decryptField(credential, 'userHandle', key),
  userDisplay: decryptField(credential, 'userDisplayName', key),
  counter: Number.parseInt(decryptField(credential, 'counter', key) ?? '0', 10) || 0,
  discoverable: /^true$/iu.test(decryptField(credential, 'discoverable', key) ?? ''),
  keyValue: decryptField(credential, 'keyValue', key) ?? '',
})

const decryptField = (value: RawFido2Credential, field: string, key: SymmetricKey) => {
  const encrypted = readString(value[field])
  return encrypted ? decryptText(encrypted, key) : undefined
}

const decryptText = (value: string, key: SymmetricKey) => decryptString(value, key).toString('utf8')

const userKey = (userId: string, suffix: string) => `user_${userId}_${suffix}`

const readKdfConfig = (value: unknown): BitwardenKdfConfig => {
  const object = readObject(value, 'Bitwarden KDF config')
  const kdfType = readNumber(object.kdfType, 'Bitwarden KDF type')
  if (kdfType !== 0 && kdfType !== 1) throw new Error(`unsupported Bitwarden KDF type: ${kdfType}`)
  return {
    kdfType,
    iterations: readNumber(object.iterations, 'Bitwarden KDF iterations'),
    memory: optionalNumber(object.memory),
    parallelism: optionalNumber(object.parallelism),
  }
}

const detectUserId = (data: Record<string, unknown>) => {
  for (const key of Object.keys(data)) {
    const match = /^user_([0-9a-fA-F-]{36})_/u.exec(key)
    if (match?.[1]) return match[1]
  }
  return undefined
}

const detectEmail = (data: Record<string, unknown>, userId: string) => {
  const accounts = data.global_account_accounts
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return undefined
  const account = (accounts as Record<string, unknown>)[userId]
  if (!account || typeof account !== 'object' || Array.isArray(account)) return undefined
  return readString((account as Record<string, unknown>).email)
}

const readObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} was not an object`)
  }
  return value as Record<string, unknown>
}

const readString = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const requiredString = (value: unknown, label: string) => {
  const stringValue = readString(value)
  if (!stringValue) throw new Error(`${label} was not found`)
  return stringValue
}

const readNumber = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} was not a number`)
  return value
}

const optionalNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
