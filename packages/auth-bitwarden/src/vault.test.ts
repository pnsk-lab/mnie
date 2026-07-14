import { createCipheriv, createHash, createHmac } from 'node:crypto'
import { expect, test } from 'vite-plus/test'
import { keyFromBytes, type SymmetricKey } from './crypto'
import { openBitwardenVaultFromObject } from './vault'

const userId = '11111111-1111-4111-8111-111111111111'
const userKey = keyFromBytes(
  Buffer.from(
    '7f384a83cabd0fd0b08120a6dbe88be4e0009b991ad0a2eec287f78d72fd94cb46a79df112815a15a42ac9072f614ff9f0296c6f1ea2eeab53d1a32d47caeae5',
    'hex',
  ),
)
const itemKey = keyFromBytes(Buffer.from('22'.repeat(64), 'hex'))

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

const syntheticData = {
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
      name: encrypt('Example Login', userKey, 'cipher-name'),
      type: 1,
      key: encrypt(
        Buffer.concat([itemKey.enc, itemKey.mac ?? Buffer.alloc(0)]),
        userKey,
        'item-key',
      ),
      login: {
        fido2Credentials: [
          {
            credentialId: encrypt('00000000-0000-4000-8000-000000000000', itemKey, 'credentialId'),
            rpId: encrypt('example.com', itemKey, 'rpId'),
            rpName: encrypt('Example', itemKey, 'rpName'),
            userName: encrypt('alice', itemKey, 'userName'),
            userHandle: encrypt(
              Buffer.from('alice-handle').toString('base64url'),
              itemKey,
              'userHandle',
            ),
            userDisplayName: encrypt('Alice', itemKey, 'userDisplayName'),
            counter: encrypt('3', itemKey, 'counter'),
            discoverable: encrypt('true', itemKey, 'discoverable'),
            keyValue: encrypt('b64-private-key', itemKey, 'keyValue'),
          },
          {
            credentialId: encrypt('00000000-0000-4000-8000-000000000001', itemKey, 'credentialId2'),
            rpId: encrypt('other.example.com', itemKey, 'rpId2'),
            userName: encrypt('bob', itemKey, 'userName2'),
            discoverable: encrypt('false', itemKey, 'discoverable2'),
            keyValue: encrypt('b64-private-key-2', itemKey, 'keyValue2'),
          },
        ],
      },
    },
  },
}

test('opens active Bitwarden account and filters passkeys by rpId', () => {
  const vault = openBitwardenVaultFromObject(syntheticData)
  const unlocked = vault.unlock('correct horse battery staple')
  const passkeys = vault.passkeys(unlocked, 'example.com')

  expect(passkeys).toHaveLength(1)
  expect(passkeys[0]).toMatchObject({
    cipherId: 'cipher1',
    cipherName: 'Example Login',
    credentialId: '00000000-0000-4000-8000-000000000000',
    rpId: 'example.com',
    userName: 'alice',
    counter: 3,
    discoverable: true,
  })
})
