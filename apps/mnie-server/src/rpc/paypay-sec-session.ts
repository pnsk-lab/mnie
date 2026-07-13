import { eq } from 'drizzle-orm'
import { connectWithPasskey } from '@mnie/provider-paypay-sec'
import type { PayPaySecSession } from '@mnie/provider-paypay-sec'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { accountProfiles } from '../db/schema'
import type { StoredPayPaySecSecret } from '../providers/credentials'
import { readSecret, saveSecret } from '../security/keyring'
import { payPaySecConnectionOptions } from './paypay-sec-options'

export const connectPayPaySec = async (
  db: Db,
  config: ServerConfig,
  profileId: string,
): Promise<FinancialProvider<OperationMap>> => {
  const [row] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, profileId))
    .limit(1)
  if (!row || row.provider !== 'paypay-sec') throw new Error('PayPay Securities profile not found')
  const secret = await readSecret<StoredPayPaySecSecret>(row.keyringAccount)
  const options = payPaySecConnectionOptions(config, row.id, secret)
  const provider = await connectWithPasskey(options.login, options.client, {
    tradePassword: secret.tradePassword,
  })
  await saveSecret(row.keyringAccount, {
    ...secret,
    session: (await provider.exportSession()) as PayPaySecSession,
  } satisfies StoredPayPaySecSecret)
  return provider as FinancialProvider<OperationMap>
}
