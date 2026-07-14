import { eq } from 'drizzle-orm'
import {
  connectWithPasskey,
  createProvider,
  importSession,
  normalizePayPaySecOrigin,
  type PayPaySecSession,
} from '@mnie/provider-paypay-sec'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { accountProfiles } from '../db/schema'
import { readSecret, saveSecret } from '../security/keyring'
import type { StoredPayPaySecSecret } from './credentials'
import { payPaySecConnectionOptions } from './paypay-sec-options'

export const openPayPaySec = async (
  db: Db,
  config: ServerConfig,
  profileId: string,
  options: { forceLogin?: boolean } = {},
): Promise<{
  provider: FinancialProvider<OperationMap>
  persist(): Promise<void>
}> => {
  const [row] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, profileId))
    .limit(1)
  if (!row || row.provider !== 'paypay-sec') throw new Error('PayPay Securities profile not found')

  const secret = await readSecret<StoredPayPaySecSecret>(row.keyringAccount)
  const connection = payPaySecConnectionOptions(config, row.id, secret)
  let provider
  if (!options.forceLogin && secret.session) {
    const expectedOrigin = normalizePayPaySecOrigin(connection.login.baseURL)
    if (normalizePayPaySecOrigin(secret.session.baseURL) !== expectedOrigin) {
      throw new Error('stored PayPay Securities session origin does not match configuration')
    }
    if (secret.session.accountId !== row.id) {
      throw new Error('stored PayPay Securities session belongs to a different profile')
    }
    provider = createProvider(await importSession(secret.session), {
      tradePassword: secret.tradePassword,
    })
  } else {
    provider = await connectWithPasskey(connection.login, connection.client, {
      tradePassword: secret.tradePassword,
    })
  }

  return {
    provider: provider as FinancialProvider<OperationMap>,
    persist: async () =>
      saveSecret(row.keyringAccount, {
        ...secret,
        session: (await provider.exportSession()) as PayPaySecSession,
      } satisfies StoredPayPaySecSecret),
  }
}
