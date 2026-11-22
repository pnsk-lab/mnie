/**
 * Verifies the SBI Securities accountIsolation contract against a real
 * authenticated session. Places one far-below-market limit buy (which cannot
 * execute), confirms the snapshot/effect guarantees, then cancels it.
 *
 * Usage: bun scripts/verify-sbi-isolation.ts [--place-order]
 */
import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'
import { loadConfig } from '../apps/mnie-server/src/config'
import { readSecret } from '../apps/mnie-server/src/security/keyring'
import type { StoredSbiPasskeySecret } from '../apps/mnie-server/src/providers/credentials'
import { loginWithPasskey } from '../packages/provider-sbi-sec/src/session'
import { createProviderFromClient } from '../packages/provider-sbi-sec/src/provider'
import { createBitwardenPasskeyProvider } from '../packages/auth-bitwarden/src/index'
import type {
  InvestmentOrder,
  InvestmentOrderPlacement,
} from '../packages/mnie-types/src/financial'

const PLACE_ORDER = process.argv.includes('--place-order')
const INSTRUMENT = '1306'
const VENUE = 'XTKS'

const sqlite = new Database(
  resolve(process.env.MNIE_DATABASE_PATH ?? 'apps/mnie-app/data/mnie-app.sqlite'),
  { readonly: true, strict: true },
)
const profile = sqlite
  .query("SELECT keyring_account FROM account_profiles WHERE provider = 'sbisec' LIMIT 1")
  .get() as { keyring_account: string } | undefined
if (!profile) throw new Error('sbisec profile not found')
const secret = await readSecret<StoredSbiPasskeySecret>(profile.keyring_account)
const config = loadConfig()
const endpointOptions = {
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
const source = secret.source
const loginOptions = !source
  ? { ...endpointOptions, passkeyCredential: secret.credential }
  : source.kind === 'json'
    ? { ...endpointOptions, passkeyCredential: source.credential }
    : {
        ...endpointOptions,
        passkeyProvider: createBitwardenPasskeyProvider({
          dataPath: source.dataPath,
          masterPassword: source.masterPassword,
          rpId: source.rpId,
          origin: source.origin,
          credentialId: source.credentialId,
        }),
      }
const client = await loginWithPasskey(
  loginOptions as never,
  {
    tradePassword: secret.tradePassword,
    deviceId: secret.deviceId,
  } as never,
)
const provider = createProviderFromClient(client)

let failures = 0
const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) failures += 1
  console.log(
    `${condition ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`,
  )
}

const balances = async () =>
  (await provider.invoke('balances.list' as never, {} as never)) as Array<{
    type: string
    amount: { kind: string; money: { currency: string; value: string } }
  }>
const openOrders = async () =>
  (await provider.invoke('investments.orders.open' as never, {} as never)) as {
    items: InvestmentOrder[]
    complete?: boolean
  }

const initialBalances = await balances()
const initialCurrent = initialBalances.find((balance) => balance.type === 'current')
const initialPower = initialBalances.find((balance) => balance.type === 'buying-power')
check('balances.current = domestic deposit', initialCurrent !== undefined, initialCurrent)
check(
  'deposit equals buying power with no open orders',
  initialCurrent?.amount.money.value === initialPower?.amount.money.value,
  { deposit: initialCurrent?.amount.money.value, power: initialPower?.amount.money.value },
)

const initialOpen = await openOrders()
check('open-order snapshot complete', initialOpen.complete === true, {
  items: initialOpen.items.length,
})

if (!PLACE_ORDER) {
  console.log(
    '\nRead-only verification done. Re-run with --place-order to test the order lifecycle.',
  )
  await client.close?.()
  sqlite.close()
  process.exit(failures ? 1 : 0)
}

const board = (await client.market.issue.board({ issueCode: INSTRUMENT, market: VENUE })) as {
  quote?: { price?: { value: number | null } }
}
const price = board.quote?.price?.value
if (price == null) throw new Error('current price unavailable')
// Roughly 20% below market: inside the daily price band but unfillable in practice.
const limit = Math.floor(price * 0.8)
console.log(`instrument ${INSTRUMENT} price ${price}, limit ${limit}`)

const request: InvestmentOrderPlacement = {
  account: 'primary',
  instrumentId: INSTRUMENT,
  instrumentVenue: VENUE,
  side: 'buy',
  quantity: '1',
  positionType: 'cash',
  accountType: 'specific',
  execution: {
    priceType: 'limit',
    limitPrice: { currency: 'JPY', value: String(limit) },
    venue: VENUE,
    timeInForce: 'day',
  },
  confirmationToken: '',
}
const preview = (await provider.invoke(
  'investments.orders.preview' as never,
  request as never,
)) as {
  confirmationToken?: string
  projectedAssetChanges?: unknown[]
}
check('preview projected changes', (preview.projectedAssetChanges?.length ?? 0) > 0)
if (!preview.confirmationToken) throw new Error('preview did not return a confirmation token')
request.confirmationToken = preview.confirmationToken

const created = (await provider.invoke(
  'investments.orders.create' as never,
  request as never,
)) as InvestmentOrder
check('receipt has stable order id', Boolean(created.id), created.id)
check('receipt effects reference the order id', created.effects?.referenceId === created.id)
check('receipt reports reserved cash', (created.effects?.changes.length ?? 0) > 0, created.effects)

const whileOpen = await openOrders()
const placed = whileOpen.items.find((item) => item.id === created.id)
check('snapshot contains the placed order', placed !== undefined, whileOpen.items.length)
check(
  'snapshot order carries effects',
  Boolean(placed?.effects?.changes.some((change) => change.reservedDelta !== '0')),
  placed?.effects,
)

const fetched = (await provider.invoke(
  'investments.orders.get' as never,
  {
    orderId: created.id,
    instrumentId: INSTRUMENT,
    venue: VENUE,
  } as never,
)) as InvestmentOrder
check('orders.get resolves domestic order', fetched.id === created.id, fetched.status)
check('orders.get carries effects', Boolean(fetched.effects), fetched.effects?.referenceId)

const duringBalances = await balances()
const duringCurrent = duringBalances.find((balance) => balance.type === 'current')
const duringPower = duringBalances.find((balance) => balance.type === 'buying-power')
check(
  'deposit unchanged while order is open (reservation-inclusive cash)',
  duringCurrent?.amount.money.value === initialCurrent?.amount.money.value,
  { before: initialCurrent?.amount.money.value, during: duringCurrent?.amount.money.value },
)
check(
  'buying power decreased by the reservation',
  Number(duringPower?.amount.money.value) < Number(initialPower?.amount.money.value),
  { before: initialPower?.amount.money.value, during: duringPower?.amount.money.value },
)

const cancelled = (await provider.invoke(
  'investments.orders.cancel' as never,
  {
    account: 'primary',
    orderId: created.id,
    instrumentId: INSTRUMENT,
    venue: VENUE,
  } as never,
)) as InvestmentOrder & { confirmed?: boolean }
check('cancel confirmed', cancelled.confirmed === true && cancelled.status === 'cancelled', {
  status: cancelled.status,
  confirmed: cancelled.confirmed,
})

const afterOpen = await openOrders()
check(
  'snapshot no longer lists the order',
  afterOpen.complete === true && !afterOpen.items.some((item) => item.id === created.id),
  afterOpen.items.length,
)

const finalBalances = await balances()
check(
  'buying power restored after cancel',
  finalBalances.find((balance) => balance.type === 'buying-power')?.amount.money.value ===
    initialPower?.amount.money.value,
  finalBalances.find((balance) => balance.type === 'buying-power')?.amount.money.value,
)

await client.close?.()
sqlite.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
