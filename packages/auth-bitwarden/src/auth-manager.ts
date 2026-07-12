import type { AuthManager } from '@mnie/types'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import {
  createBitwardenAssertion,
  decodeBitwardenKeyValue,
  parseBitwardenCredentialId,
} from './fido2'
import { openBitwardenVault } from './vault'

export interface BitwardenAuthManagerOptions {
  dataPath?: string
  masterPassword: string
}

export const createBitwardenAuthManager = (options: BitwardenAuthManagerOptions): AuthManager => ({
  descriptor: { id: 'bitwarden', name: 'Bitwarden' },
  credentials: async ({ origin }) => {
    const vault = await openBitwardenVault(options.dataPath)
    const userKey = vault.unlock(options.masterPassword)
    return vault.credentials(userKey, origin).map((credential) => ({
      id: credential.id,
      name: credential.name,
      username: credential.username,
      password: credential.password,
      passkeys: credential.passkeys.map((passkey) => ({
        credentialId: passkey.credentialId,
        rpId: passkey.rpId,
        userName: passkey.userName,
        portableCredential: portableCredential(passkey, origin),
      })),
    }))
  },
  createPasskeyAssertion: async (credentialId, request) => {
    const vault = await openBitwardenVault(options.dataPath)
    const userKey = vault.unlock(options.masterPassword)
    const matches = vault
      .passkeys(userKey, request.rpId)
      .filter((passkey) =>
        parseBitwardenCredentialId(passkey.credentialId).equals(
          parseBitwardenCredentialId(credentialId),
        ),
      )
    if (matches.length !== 1) {
      throw new Error(`expected one Bitwarden passkey for credentialId, found ${matches.length}`)
    }
    const assertion = createBitwardenAssertion(matches[0]!, request, {
      origin: request.origin,
      userVerification: request.userVerification !== 'discouraged',
      counterBump: true,
    })
    return { credentialId: assertion.id, ...assertion }
  },
  close: () => {},
})

const portableCredential = (passkey: import('./vault').BitwardenPasskey, origin: string) => {
  const privateKey = createPrivateKey({
    key: decodeBitwardenKeyValue(passkey.keyValue),
    format: 'der',
    type: 'pkcs8',
  })
  const privateJwk = privateKey.export({ format: 'jwk' })
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' })
  const now = new Date().toISOString()
  return {
    version: 1,
    kind: 'webauthn-credential',
    provider: 'sbi-sec',
    rpId: passkey.rpId,
    origin,
    credentialId: parseBitwardenCredentialId(passkey.credentialId).toString('base64url'),
    userHandle: passkey.userHandle,
    alg: privateKey.asymmetricKeyType === 'rsa' ? -257 : -7,
    publicKey: { format: 'jwk', jwk: publicJwk },
    authenticator: {
      signCount: passkey.counter,
      discoverable: passkey.discoverable,
      userVerification: 'preferred',
    },
    secretPlaintext: { privateKey: { format: 'jwk', jwk: privateJwk } },
    createdAt: now,
    updatedAt: now,
  }
}
