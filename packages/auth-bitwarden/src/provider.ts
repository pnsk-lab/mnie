import type { PasskeyAssertionProvider } from '@mnie/provider-sbi-sec'
import { createBitwardenAssertion, parseBitwardenCredentialId } from './fido2'
import { openBitwardenVault } from './vault'
import type { BitwardenPasskey } from './vault'

export interface BitwardenPasskeyProviderOptions {
  dataPath?: string
  masterPassword: string
  rpId: string
  origin?: string
  credentialId?: string
  userVerification?: boolean
  counterBump?: boolean
}

export const createBitwardenPasskeyProvider = (
  options: BitwardenPasskeyProviderOptions,
): PasskeyAssertionProvider => ({
  rpId: options.rpId,
  origin: options.origin ?? `https://${options.rpId}`,
  createAssertion: async (request) => {
    const vault = await openBitwardenVault(options.dataPath)
    const userKey = vault.unlock(options.masterPassword)
    const passkeys = vault.passkeys(userKey, options.rpId)
    const matched = options.credentialId
      ? passkeys.filter((passkey) => matchesCredentialId(passkey, options.credentialId ?? ''))
      : passkeys

    if (matched.length === 0) throw new Error(`no Bitwarden passkey matched rpId=${options.rpId}`)
    if (matched.length > 1) {
      throw new Error(
        `multiple Bitwarden passkeys matched rpId=${options.rpId}; configure credentialId`,
      )
    }

    return createBitwardenAssertion(matched[0] as BitwardenPasskey, request, {
      origin: options.origin ?? `https://${options.rpId}`,
      userVerification: options.userVerification ?? true,
      counterBump: options.counterBump ?? true,
    })
  },
})

const matchesCredentialId = (passkey: BitwardenPasskey, credentialId: string) =>
  parseBitwardenCredentialId(passkey.credentialId).equals(parseBitwardenCredentialId(credentialId))
