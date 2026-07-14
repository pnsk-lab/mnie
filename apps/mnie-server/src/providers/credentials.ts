import type { MobileSuicaSession } from '@mnie/provider-mobile-suica'
import type { PlaintextStoredWebAuthnCredential } from '@mnie/provider-sbi-sec'
import type {
  PayPaySecSession,
  PlaintextStoredWebAuthnCredential as PayPaySecPasskeyCredential,
} from '@mnie/provider-paypay-sec'

export type SbiPasskeySource =
  | { kind: 'json'; credential: PlaintextStoredWebAuthnCredential }
  | {
      kind: 'bitwarden'
      masterPassword: string
      rpId: string
      dataPath?: string
      origin?: string
      credentialId?: string
    }

export interface StoredSbiPasskeySecret {
  source?: SbiPasskeySource
  /** Legacy shape used before passkey sources were introduced. */
  credential?: PlaintextStoredWebAuthnCredential
  tradePassword?: string
  deviceId?: string
  session?: unknown
}

export interface StoredSmbcDirectSecret {
  user: string
  password: string
  accountItemCode?: string
  session?: unknown
}

export interface StoredPayPayBankSecret {
  branchNo: string
  accountNo: string
  password: string
  session?: unknown
}

export interface StoredPayPaySecSecret {
  credential: PayPaySecPasskeyCredential
  deviceId: string
  tradePassword?: string
  session?: PayPaySecSession
}

export interface StoredMobileSuicaSecret {
  session?: MobileSuicaSession
  user?: string
  password?: string
}

export interface StoredBitwardenAuthManagerSecret {
  dataPath?: string
}

export type StoredProfileSecret =
  | StoredSbiPasskeySecret
  | StoredSmbcDirectSecret
  | StoredPayPayBankSecret
  | StoredPayPaySecSecret
  | StoredMobileSuicaSecret
