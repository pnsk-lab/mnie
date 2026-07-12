export interface AuthManagerDescriptor {
  id: string
  name: string
}

export interface AuthCredentialQuery {
  origin: string
}

export interface AuthPasskeyCredential {
  credentialId: string
  rpId: string
  userName?: string
  portableCredential?: unknown
}

export interface AuthCredential {
  id: string
  name: string
  username?: string
  password?: string
  passkeys: AuthPasskeyCredential[]
}

export interface AuthPasskeyRequest {
  challenge: string
  rpId: string
  origin: string
  allowCredentialIds?: string[]
  userVerification?: 'required' | 'preferred' | 'discouraged'
}

export interface AuthPasskeyAssertion {
  credentialId: string
  authenticatorData: string
  clientDataJSON: string
  signature: string
  userHandle?: string
}

/** Provider-neutral access to credentials stored by an authentication manager. */
export interface AuthManager {
  readonly descriptor: AuthManagerDescriptor
  credentials(query: AuthCredentialQuery): Promise<AuthCredential[]>
  createPasskeyAssertion(
    credentialId: string,
    request: AuthPasskeyRequest,
  ): Promise<AuthPasskeyAssertion>
  close(): void | Promise<void>
}
