import { createCipheriv, createHash, createHmac, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { keyFromBytes, type SymmetricKey } from './crypto'
import { createBitwardenPasskeyProvider } from './provider'

const userId = '11111111-1111-4111-8111-111111111111'
const userKey = keyFromBytes(
  Buffer.from(
    '7f384a83cabd0fd0b08120a6dbe88be4e0009b991ad0a2eec287f78d72fd94cb46a79df112815a15a42ac9072f614ff9f0296c6f1ea2eeab53d1a32d47caeae5',
    'hex',
  ),
)
const itemKey = keyFromBytes(Buffer.from('33'.repeat(64), 'hex'))

const encrypt = (value: string | Buffer, key: SymmetricKey, label: string) => {
  const iv = createHash('sha256').update(label).digest().subarray(0, 16)
  const cipher = createCipheriv('aes-256-cbc', key.enc, iv)
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
  const mac = createHmac('sha256', key.mac ?? Buffer.alloc(0))
    .update(iv)
    .update(ciphertext)
    .digest()
  return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`
}

const createVaultFile = () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' })
  const credentials = [
    {
      credentialId: '00000000-0000-4000-8000-000000000000',
      userName: 'alice',
    },
    {
      credentialId: '00000000-0000-4000-8000-000000000001',
      userName: 'alice-alt',
    },
  ]
  const data = {
    global_account_activeAccountId: userId,
    global_loginEmail_storedEmail: 'User@Example.com',
    [`user_${userId}_kdfConfig_kdfConfig`]: {
      kdfType: 0,
      iterations: 100000,
    },
    [`user_${userId}_masterPassword_masterKeyEncryptedUserKey`]:
      '2.DBdWiLu3dxhvyQx/ts1muQ==|797bDUbt4/oi6mzN+Xjq0G7Olzd5aOVI/t+0TBnfGaHS11HegHWVdmT/U27LrmRi/SMVOQ005UmngfAgX+QYUZ75/KVcZiDDbInKoxTodaU=|C6cXaDy8tVfJxSsKmTVWX8GnXwjKauqkBPv1JQfMfZU=',
    [`user_${userId}_ciphers_ciphers`]: {
      cipher1: {
        id: 'cipher1',
        name: encrypt('Example Login', userKey, 'provider-cipher-name'),
        type: 1,
        key: encrypt(
          Buffer.concat([itemKey.enc, itemKey.mac ?? Buffer.alloc(0)]),
          userKey,
          'provider-item-key',
        ),
        login: {
          fido2Credentials: credentials.map((credential, index) => ({
            credentialId: encrypt(
              credential.credentialId,
              itemKey,
              `provider-credentialId-${index}`,
            ),
            rpId: encrypt('example.com', itemKey, `provider-rpId-${index}`),
            userName: encrypt(credential.userName, itemKey, `provider-userName-${index}`),
            userHandle: encrypt(
              Buffer.from(credential.userName).toString('base64url'),
              itemKey,
              `provider-userHandle-${index}`,
            ),
            counter: encrypt('0', itemKey, `provider-counter-${index}`),
            discoverable: encrypt('true', itemKey, `provider-discoverable-${index}`),
            keyValue: encrypt(
              privateKeyDer.toString('base64url'),
              itemKey,
              `provider-keyValue-${index}`,
            ),
          })),
        },
      },
    },
  }

  const dir = mkdtempSync(join(tmpdir(), 'mnie-bitwarden-provider-'))
  const path = join(dir, 'data.json')
  writeFileSync(path, JSON.stringify(data))
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('Bitwarden provider selects the requested credential ID', async () => {
  const vault = createVaultFile()
  try {
    const provider = createBitwardenPasskeyProvider({
      dataPath: vault.path,
      masterPassword: 'correct horse battery staple',
      rpId: 'example.com',
      origin: 'https://example.com',
      credentialId: '00000000-0000-4000-8000-000000000000',
    })
    const assertion = await provider.createAssertion({
      challenge: Buffer.from('challenge').toString('base64url'),
      rpId: 'example.com',
    })
    expect(assertion.id).toBe(
      Buffer.from('00000000000040008000000000000000', 'hex').toString('base64url'),
    )
  } finally {
    vault.cleanup()
  }
})

test('Bitwarden provider rejects ambiguous rpId matches', async () => {
  const vault = createVaultFile()
  try {
    const provider = createBitwardenPasskeyProvider({
      dataPath: vault.path,
      masterPassword: 'correct horse battery staple',
      rpId: 'example.com',
      origin: 'https://example.com',
    })

    await expect(
      provider.createAssertion({
        challenge: Buffer.from('challenge').toString('base64url'),
        rpId: 'example.com',
      }),
    ).rejects.toThrow(
      'multiple Bitwarden passkeys matched rpId=example.com; configure credentialId',
    )
  } finally {
    vault.cleanup()
  }
})
