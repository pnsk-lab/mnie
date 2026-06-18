import { eq } from 'drizzle-orm'
import { loginWithPasskey } from '@repo/sbi-client'
import type { SbiClientMethods, SbiClientOptions } from '@repo/sbi-client'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { sbiPasskeys } from '../db/schema'
import type { StoredSbiPasskeySecret } from '../routes/admin'
import { readSecret } from '../security/keyring'
import { effectiveSbiDeviceId, effectiveSbiTradePassword } from '../security/sbi-credentials'

export const connectSbi = async (
  db: Db,
  config: ServerConfig,
  passkeyId: string,
): Promise<SbiClientMethods> => {
  const [row] = await db.select().from(sbiPasskeys).where(eq(sbiPasskeys.id, passkeyId)).limit(1)
  if (!row) throw new Error('SBI passkey not found')

  const secret = await readSecret<StoredSbiPasskeySecret>(row.keyringAccount)
  const clientOptions: SbiClientOptions = {
    tradePassword: effectiveSbiTradePassword(secret),
    deviceId: effectiveSbiDeviceId(secret),
  }
  return loginWithPasskey(
    {
      passkeyCredential: secret.credential,
      authBaseUrl: config.authBaseUrl,
      mtsBaseUrl: config.mtsBaseUrl,
      izanagiBaseUrl: config.izanagiBaseUrl,
    },
    clientOptions,
  )
}
