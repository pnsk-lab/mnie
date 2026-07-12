import { eq } from 'drizzle-orm'
import { createBitwardenPasskeyProvider } from '@mnie/auth-bitwarden'
import { connectWithPasskey } from '@mnie/provider-sbi-sec'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import type {
  LoginWithPasskeyOptions,
  SbiClientOptions,
  SbiEndpointOptions,
} from '@mnie/provider-sbi-sec'
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
): Promise<FinancialProvider<OperationMap>> => {
  const [row] = await db.select().from(sbiPasskeys).where(eq(sbiPasskeys.id, profileId)).limit(1)
  if (!row) throw new Error('SBI passkey not found')

  const secret = await readSecret<StoredSbiPasskeySecret>(row.keyringAccount)
  const clientOptions: SbiClientOptions = {
    tradePassword: effectiveSbiTradePassword(secret),
    deviceId: effectiveSbiDeviceId(secret),
  }
  const endpointOptions: SbiEndpointOptions = {
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
  }
  const passkeyOptions = passkeyLoginOptions(secret, endpointOptions)
  const provider = await connectWithPasskey(passkeyOptions, clientOptions)
  await saveSecret(row.keyringAccount, { ...secret, session: await provider.exportSession() })
  return provider as FinancialProvider<OperationMap>
}

const passkeyLoginOptions = (
  secret: StoredSbiPasskeySecret,
  endpointOptions: SbiEndpointOptions,
): LoginWithPasskeyOptions => {
  const source = secret.source
  if (!source) {
    if (!secret.credential) throw new Error('SBI passkey source is missing')
    return { ...endpointOptions, passkeyCredential: secret.credential }
  }

  if (source.kind === 'json') {
    return { ...endpointOptions, passkeyCredential: source.credential }
  }

  return {
    ...endpointOptions,
    passkeyProvider: createBitwardenPasskeyProvider({
      dataPath: source.dataPath,
      masterPassword: source.masterPassword,
      rpId: source.rpId,
      origin: source.origin,
      credentialId: source.credentialId,
    }),
  }
}
