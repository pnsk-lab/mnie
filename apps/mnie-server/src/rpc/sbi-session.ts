import { eq } from 'drizzle-orm'
import { loginWithPasskey } from '@mnie/provider-sbi-sec'
import type { SbiClientMethods, SbiClientOptions } from '@mnie/provider-sbi-sec'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { sbiPasskeys } from '../db/schema'
import type { StoredSbiPasskeySecret } from '../routes/admin'
import { readSecret, saveSecret } from '../security/keyring'
import { effectiveSbiDeviceId, effectiveSbiTradePassword } from '../security/sbi-credentials'

export const connectSbi = async (
  db: Db,
  config: ServerConfig,
  profileId: string,
): Promise<SbiClientMethods> => {
  const [row] = await db.select().from(sbiPasskeys).where(eq(sbiPasskeys.id, profileId)).limit(1)
  if (!row) throw new Error('SBI passkey not found')

  const secret = await readSecret<StoredSbiPasskeySecret>(row.keyringAccount)
  const clientOptions: SbiClientOptions = {
    tradePassword: effectiveSbiTradePassword(secret),
    deviceId: effectiveSbiDeviceId(secret),
  }
  const client = await loginWithPasskey(
    {
      passkeyCredential: secret.credential,
      authBaseUrl: config.authBaseUrl,
      mtsBaseUrl: config.mtsBaseUrl,
      izanagiBaseUrl: config.izanagiBaseUrl,
      foreignStockBaseUrl: config.foreignStockBaseUrl,
      usStockBaseUrl: config.usStockBaseUrl,
      foreignStockRestUrl: config.foreignStockRestUrl,
      foreignStockGraphqlBffUrl: config.foreignStockGraphqlBffUrl,
      foreignStockGraphqlIntUrl: config.foreignStockGraphqlIntUrl,
      mainSiteBaseUrl: config.mainSiteBaseUrl,
      mainSiteEtGatePath: config.mainSiteEtGatePath,
      mainSiteAssetsValuationsPath: config.mainSiteAssetsValuationsPath,
      mainSiteExchangeOrderInputPath: config.mainSiteExchangeOrderInputPath,
      mainSiteExchangeOrderPasswordPath: config.mainSiteExchangeOrderPasswordPath,
      mainSiteExchangeOrderConfirmPath: config.mainSiteExchangeOrderConfirmPath,
      mainSiteExchangeOrderCompletePath: config.mainSiteExchangeOrderCompletePath,
    },
    clientOptions,
  )
  await saveSecret(row.keyringAccount, { ...secret, session: await client.session.export() })
  return client
}
