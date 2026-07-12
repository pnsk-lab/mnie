import { expect, test } from 'vitest'
import { decryptString, deriveMasterKey, stretchKey } from './crypto'

const ref = {
  password: 'correct horse battery staple',
  email: 'User@Example.com',
  iter: 100000,
  masterKey: 'a69d536a06ad85726e4173a146710f671fcc245c23226099326470a8eda63eb0',
  encKey: 'c10ad79ad020c7d5b1d20265fe6d29d6b12f0af254ad805500802f1fecb8553f',
  macKey: '7455d0cc8fdb1162fb4603d93637e9b56a901fcf6ecd0b89149b76f446849e9d',
  userKey:
    '7f384a83cabd0fd0b08120a6dbe88be4e0009b991ad0a2eec287f78d72fd94cb46a79df112815a15a42ac9072f614ff9f0296c6f1ea2eeab53d1a32d47caeae5',
  encUserKey:
    '2.DBdWiLu3dxhvyQx/ts1muQ==|797bDUbt4/oi6mzN+Xjq0G7Olzd5aOVI/t+0TBnfGaHS11HegHWVdmT/U27LrmRi/SMVOQ005UmngfAgX+QYUZ75/KVcZiDDbInKoxTodaU=|C6cXaDy8tVfJxSsKmTVWX8GnXwjKauqkBPv1JQfMfZU=',
}

test('derives Bitwarden PBKDF2 master key', () => {
  const key = deriveMasterKey(ref.password, ref.email, { kdfType: 0, iterations: ref.iter })
  expect(key.enc.toString('hex')).toBe(ref.masterKey)
})

test('stretches master key with HKDF expand labels', () => {
  const stretched = stretchKey({ enc: Buffer.from(ref.masterKey, 'hex') })
  expect(stretched.enc.toString('hex')).toBe(ref.encKey)
  expect(stretched.mac?.toString('hex')).toBe(ref.macKey)
})

test('decrypts Bitwarden type 2 EncString', () => {
  const master = deriveMasterKey(ref.password, ref.email, { kdfType: 0, iterations: ref.iter })
  const stretched = stretchKey(master)
  expect(Buffer.from(decryptString(ref.encUserKey, stretched)).toString('hex')).toBe(ref.userKey)
})
