# provider-paypay-sec

PayPay Securities web client and Mnie provider.

Service origins are runtime configuration and are never hardcoded. Configure the PayPay Securities
web origin and passkey BFF origin:

```ini
PAYPAY_SEC_BASE_URL=https://trade.example.com
PAYPAY_SEC_PASSKEY_BFF_BASE_URL=https://passkey-bff.example.com
```

Both values must be origins without a path, query, or fragment.

## Passkey login from JSON

`connectWithPasskey()` accepts the same portable stored-credential shape as the SBI Securities
provider. The credential's `origin` is used as the WebAuthn client origin and must be an HTTPS
origin within its `rpId`.

```ts
import { readFile } from 'node:fs/promises'
import {
  connectWithPasskey,
  type PlaintextStoredWebAuthnCredential,
} from '@mnie/provider-paypay-sec'

const passkeyCredential = JSON.parse(
  await readFile('./workspace/passkey.json', 'utf8'),
) as PlaintextStoredWebAuthnCredential

const provider = await connectWithPasskey({ passkeyCredential })
console.log(await provider.invoke('assets.valuation.get', {}))
```

The private key is used only while creating the WebAuthn assertion. It is not retained in the
client or included in `exportSession()`.

## Bitwarden passkey login

Any structurally compatible passkey provider can be supplied, including `@mnie/auth-bitwarden`:

```ts
import { createBitwardenPasskeyProvider } from '@mnie/auth-bitwarden'
import { connectWithPasskey } from '@mnie/provider-paypay-sec'

const provider = await connectWithPasskey({
  passkeyProvider: createBitwardenPasskeyProvider({
    masterPassword: process.env.BITWARDEN_MASTER_PASSWORD!,
    rpId: process.env.PAYPAY_SEC_PASSKEY_RP_ID!,
    origin: process.env.PAYPAY_SEC_PASSKEY_ORIGIN!,
    credentialId: process.env.PAYPAY_SEC_PASSKEY_CREDENTIAL_ID,
  }),
})
```

If several passkeys match the RP ID, configure `credentialId` explicitly.

## Existing browser session

The previous cookie-based connection remains supported. Supply the web origin and authenticated
session cookies explicitly:

```ts
import { createPayPaySecClient } from '@mnie/provider-paypay-sec'

const client = createPayPaySecClient({
  baseURL: process.env.PAYPAY_SEC_BASE_URL,
  accountId: 'primary',
  cookies: {
    // Copy from an authenticated session at runtime. Never commit real values.
    session_cookie_name: process.env.PAYPAY_SEC_SESSION_COOKIE!,
  },
})

console.log(await client.account.valuation())
console.log(await client.portfolio.positions({ country: 'japan' }))
```

`baseURL` must be an origin without a path. The package intentionally has no hardcoded production
origin. `client.session.export()` contains authenticated cookies and must be treated as a secret.
It never contains a passkey private key, a trade password, a CSRF token copied into an order form,
or an order confirmation. The short-lived passkey callback cookie is removed before the reusable
session is exported.

## Orders

PayPay Securities accepts monetary amounts rather than whole-share quantities. The low-level
client and the Mnie `investments.orders.preview` / `investments.orders.create` operations both keep
preview and submission as separate calls. The server supplies a Keyring-held trade password; API
clients never send that password:

```ts
const preview = await client.orders.buy.preview({
  brandId: '101',
  amount: '1000',
  accountType: 2,
})

// Show preview to the user before making this call.
const receipt = await client.orders.buy.submit({
  confirmationId: preview.confirmationId,
  tradePassword: process.env.PAYPAY_SEC_TRADE_PASSWORD!,
  allowTransaction: true,
})
```

Confirmation IDs are short-lived, client-local, and single-use. Submission is never retried. An
`OrderOutcomeUnknownError` means the request may have reached PayPay Securities: do not submit it
again, and verify the outcome using trade history.

The initial implementation supports normal fixed-amount buys, fixed-amount sells, and sell-all.
Preorders, buy-all adjustment, profit-only sales, PayPay-linked order placement, and detailed US
history are intentionally unsupported until their request formats are observed. Settlement-history
paging is supported for provider-neutral buy and sell order and transaction history; cash movements,
fees, reservations, and other settlement summary types remain available only in the raw client data.

The final `*_complete_popup.json` endpoints only generate browser UI and are not called. The order
receipt comes from the actual `ajax_buy_complete` or `ajax_sell_complete` response.
