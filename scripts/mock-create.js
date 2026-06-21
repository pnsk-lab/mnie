;(() => {
  if (!globalThis.navigator?.credentials?.create) {
    throw new Error('navigator.credentials.create is not available on this page')
  }

  if (navigator.credentials.__sbiClientMockCreateInstalled) {
    console.warn('[sbi-client] mock navigator.credentials.create is already installed')
    return
  }

  const originalCreate = navigator.credentials.create.bind(navigator.credentials)
  const textEncoder = new TextEncoder()
  const credentialLabel = 'mnie'

  const base64Url = (value) => {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const fromBase64Url = (value) => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  const toBytes = (value) => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    if (Array.isArray(value)) return new Uint8Array(value)
    if (typeof value === 'string') return fromBase64Url(value)
    throw new Error('unsupported binary value')
  }

  const concat = (...parts) => {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }

  const sha256 = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', value))

  const randomBytes = (length) => {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  }

  const cborUInt = (major, value) => {
    if (value < 24) return Uint8Array.of((major << 5) | value)
    if (value < 0x100) return Uint8Array.of((major << 5) | 24, value)
    if (value < 0x10000) return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff)
    return Uint8Array.of(
      (major << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    )
  }

  const cborEncode = (value) => {
    if (value === null) return Uint8Array.of(0xf6)
    if (value === false) return Uint8Array.of(0xf4)
    if (value === true) return Uint8Array.of(0xf5)
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) throw new Error('CBOR encoder only supports integers')
      return value >= 0 ? cborUInt(0, value) : cborUInt(1, -1 - value)
    }
    if (typeof value === 'string') {
      const bytes = textEncoder.encode(value)
      return concat(cborUInt(3, bytes.length), bytes)
    }
    if (value instanceof Uint8Array) return concat(cborUInt(2, value.length), value)
    if (Array.isArray(value)) return concat(cborUInt(4, value.length), ...value.map(cborEncode))
    if (value && typeof value === 'object') {
      const entries = value instanceof Map ? [...value.entries()] : Object.entries(value)
      const encoded = entries.flatMap(([key, item]) => [cborEncode(key), cborEncode(item)])
      return concat(cborUInt(5, entries.length), ...encoded)
    }
    throw new Error('unsupported CBOR value')
  }

  const derToRawP256 = (spki) => {
    const bytes = new Uint8Array(spki)
    const marker = Uint8Array.of(0x03, 0x42, 0x00, 0x04)
    for (let i = 0; i <= bytes.length - marker.length - 64; i++) {
      if (marker.every((byte, index) => bytes[i + index] === byte)) {
        return bytes.slice(i + marker.length, i + marker.length + 64)
      }
    }
    throw new Error('could not extract P-256 public key from SPKI')
  }

  const selectAlgorithm = (params = []) => {
    if (params.some((param) => param.type === 'public-key' && param.alg === -7)) return -7
    throw new Error('mock-create currently supports ES256 only')
  }

  const makeCredential = async (publicKey) => {
    const alg = selectAlgorithm(publicKey.pubKeyCredParams)
    const rpId = publicKey.rp?.id || location.hostname
    const origin = location.origin
    const challenge = toBytes(publicKey.challenge)
    const credentialId = randomBytes(32)
    const userHandle = publicKey.user?.id ? toBytes(publicKey.user.id) : undefined

    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const rawPublicKey = derToRawP256(spki)
    const cosePublicKey = cborEncode(
      new Map([
        [1, 2],
        [3, alg],
        [-1, 1],
        [-2, rawPublicKey.slice(0, 32)],
        [-3, rawPublicKey.slice(32, 64)],
      ]),
    )

    const clientDataJSON = textEncoder.encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64Url(challenge),
        origin,
        crossOrigin: false,
      }),
    )

    const rpIdHash = await sha256(textEncoder.encode(rpId))
    const flags = Uint8Array.of(0x45)
    const signCount = Uint8Array.of(0, 0, 0, 0)
    const aaguid = new Uint8Array(16)
    const credentialIdLength = Uint8Array.of(
      (credentialId.length >> 8) & 0xff,
      credentialId.length & 0xff,
    )
    const authenticatorData = concat(
      rpIdHash,
      flags,
      signCount,
      aaguid,
      credentialIdLength,
      credentialId,
      cosePublicKey,
    )
    const attestationObject = cborEncode(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authenticatorData],
      ]),
    )

    const now = new Date().toISOString()
    const vaultObject = {
      version: 1,
      kind: 'webauthn-credential',
      provider: 'sbi-sec',
      label: credentialLabel,
      rpId,
      origin,
      credentialId: base64Url(credentialId),
      userHandle: userHandle ? base64Url(userHandle) : undefined,
      alg,
      publicKey: {
        format: 'jwk',
        jwk: publicJwk,
      },
      authenticator: {
        aaguid: '00000000-0000-0000-0000-000000000000',
        signCount: 0,
        discoverable:
          publicKey.residentKey === 'required' ||
          publicKey.authenticatorSelection?.residentKey === 'required',
        userVerification:
          publicKey.userVerification ||
          publicKey.authenticatorSelection?.userVerification ||
          'preferred',
        transports: ['internal'],
        backupEligible: false,
        backupState: false,
      },
      secretPlaintext: {
        privateKey: {
          format: 'jwk',
          jwk: privateJwk,
        },
        registration: {
          attestationObject: base64Url(attestationObject),
          clientDataJSON: base64Url(clientDataJSON),
        },
      },
      createdAt: now,
      updatedAt: now,
    }

    const credential = {
      id: base64Url(credentialId),
      rawId: credentialId.buffer.slice(
        credentialId.byteOffset,
        credentialId.byteOffset + credentialId.byteLength,
      ),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        attestationObject: attestationObject.buffer.slice(
          attestationObject.byteOffset,
          attestationObject.byteOffset + attestationObject.byteLength,
        ),
        clientDataJSON: clientDataJSON.buffer.slice(
          clientDataJSON.byteOffset,
          clientDataJSON.byteOffset + clientDataJSON.byteLength,
        ),
        getAuthenticatorData: () =>
          authenticatorData.buffer.slice(
            authenticatorData.byteOffset,
            authenticatorData.byteOffset + authenticatorData.byteLength,
          ),
        getPublicKey: () => spki,
        getPublicKeyAlgorithm: () => alg,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
      toJSON: () => ({
        id: base64Url(credentialId),
        rawId: base64Url(credentialId),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response: {
          attestationObject: base64Url(attestationObject),
          clientDataJSON: base64Url(clientDataJSON),
          authenticatorData: base64Url(authenticatorData),
          publicKey: base64Url(new Uint8Array(spki)),
          publicKeyAlgorithm: alg,
          transports: ['internal'],
        },
        clientExtensionResults: {},
      }),
    }

    return { credential, vaultObject }
  }

  const openJsonTab = (value) => {
    const json = JSON.stringify(value, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const tab = window.open(url, '_blank', 'noopener,noreferrer')
    if (!tab) {
      console.warn('[sbi-client] could not open JSON tab; popup may have been blocked')
      URL.revokeObjectURL(url)
      return
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  navigator.credentials.create = async (options) => {
    if (!options?.publicKey) return originalCreate(options)

    const { credential, vaultObject } = await makeCredential(options.publicKey)
    globalThis.__sbiClientLastCreatedCredential = vaultObject
    console.log('[sbi-client] created mock WebAuthn credential')
    console.log(JSON.stringify(vaultObject, null, 2))
    openJsonTab(vaultObject)
    return credential
  }

  Object.defineProperty(navigator.credentials, '__sbiClientMockCreateInstalled', {
    value: true,
    enumerable: false,
  })

  globalThis.__sbiClientRestoreCreate = () => {
    navigator.credentials.create = originalCreate
    delete globalThis.__sbiClientRestoreCreate
    console.log('[sbi-client] restored native navigator.credentials.create')
  }

  console.log('[sbi-client] installed mock navigator.credentials.create')
})()
