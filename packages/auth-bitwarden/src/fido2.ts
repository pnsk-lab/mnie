import { createHash, createPrivateKey, sign } from 'node:crypto'
import type { WebAuthnAssertion, WebAuthnAssertionRequest } from '@mnie/provider-sbi-sec'
import type { BitwardenPasskey } from './vault'

export const parseBitwardenCredentialId = (value: string) => {
  if (value.startsWith('b64.')) return Buffer.from(value.slice(4), 'base64url')
  const hex = value.replaceAll('-', '')
  if (!/^[0-9a-fA-F]{32}$/u.test(hex)) throw new Error(`invalid Bitwarden credential ID: ${value}`)
  return Buffer.from(hex, 'hex')
}

export const decodeBitwardenKeyValue = (value: string) =>
  Buffer.from(value.replace(/=+$/u, ''), 'base64url')

export const createBitwardenAssertion = (
  passkey: BitwardenPasskey,
  request: WebAuthnAssertionRequest,
  options: { origin: string; userVerification: boolean; counterBump: boolean },
): WebAuthnAssertion => {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: request.challenge,
      origin: options.origin,
    }),
  )
  const rawCredentialId = parseBitwardenCredentialId(passkey.credentialId)
  const counter = options.counterBump && passkey.counter > 0 ? passkey.counter + 1 : passkey.counter
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(request.rpId).digest(),
    Buffer.from([options.userVerification ? 0x1d : 0x19]),
    uint32be(counter),
  ])
  const signatureBase = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataJSON).digest(),
  ])
  const privateKey = createPrivateKey({
    key: decodeBitwardenKeyValue(passkey.keyValue),
    format: 'der',
    type: 'pkcs8',
  })

  return {
    id: rawCredentialId.toString('base64url'),
    rawId: rawCredentialId.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    authenticatorData: authenticatorData.toString('base64url'),
    signature: sign('sha256', signatureBase, privateKey).toString('base64url'),
    userHandle: passkey.userHandle
      ? Buffer.from(passkey.userHandle.replace(/=+$/u, ''), 'base64url').toString('base64url')
      : '',
  }
}

const uint32be = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}
