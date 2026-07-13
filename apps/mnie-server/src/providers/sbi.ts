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
import { accountProfiles } from '../db/schema'
import { readSecret, saveSecret } from '../security/keyring'
import type { StoredSbiPasskeySecret } from './credentials'

const nonEmpty = (value: string | undefined) => value?.trim() || undefined

export const connectSbi = async (
  db: Db,
  config: ServerConfig,
  profileId: string,
): Promise<FinancialProvider<OperationMap>> => {
  const [row] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, profileId))
    .limit(1)
  if (!row || row.provider !== 'sbisec') throw new Error('SBI profile not found')

  const secret = await readSecret<StoredSbiPasskeySecret>(row.keyringAccount)
  const clientOptions: SbiClientOptions = {
    tradePassword: nonEmpty(secret.tradePassword),
    deviceId: nonEmpty(secret.deviceId),
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
  const provider = await connectWithPasskey(
    passkeyLoginOptions(secret, endpointOptions),
    clientOptions,
  )
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
