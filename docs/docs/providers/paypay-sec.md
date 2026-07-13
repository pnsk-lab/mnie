---
title: PayPay Securities
description: Connect to PayPay Securities with a passkey and access assets, positions, history, instruments, and orders.
---

# PayPay Securities

`@mnie/provider-paypay-sec` authenticates to PayPay Securities with a passkey and exposes the shared provider interface.

::: warning Unofficial client
This client does not use an official public API from PayPay Securities. Changes to the website or its internal protocol may break it. Always inspect an order preview before submitting an order.
:::

## Setup

Configure the PayPay Securities web and passkey BFF origins. Both values must be origins without a path, query, or fragment.

```ini
PAYPAY_SEC_BASE_URL=https://trade.example.com
PAYPAY_SEC_PASSKEY_BFF_BASE_URL=https://passkey-bff.example.com
```

Credentials, session cookies, and trade passwords are secrets and must be supplied at runtime.

## JSON passkey login

`connectWithPasskey()` accepts a portable stored WebAuthn credential. The credential's `origin` must be an HTTPS origin within its `rpId`.

```ts
import { readFile } from 'node:fs/promises'
import {
  connectWithPasskey,
  type PlaintextStoredWebAuthnCredential,
} from '@mnie/provider-paypay-sec'

const passkeyCredential = JSON.parse(
  await readFile('./workspace/passkey.json', 'utf8'),
) as PlaintextStoredWebAuthnCredential

const provider = await connectWithPasskey(
  { passkeyCredential },
  {},
  { tradePassword: process.env.PAYPAY_SEC_TRADE_PASSWORD },
)

try {
  const valuation = await provider.invoke('assets.valuation.get', {})
  console.log(valuation)
} finally {
  await provider.close()
}
```

The private key is used only to create the WebAuthn assertion. It is not retained by the client or included in `exportSession()`.

## Bitwarden passkey login

Use `@mnie/auth-bitwarden` to supply a compatible passkey provider.

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

If multiple passkeys match the RP ID, set `credentialId` explicitly.

## Capabilities

| Category    | Available operations                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| Account     | Account, buying power, withdrawable balance, and total asset valuation              |
| Investments | Japanese and US positions, instrument search and details, orders, and trade history |
| Trading     | Fixed-amount buys, fixed-amount sells, and sell-all                                 |

Supported instrument markets are `japan`, `japan-etf`, `usa`, and `usa-etf`. Margin positions are not supported.

## Positions and instruments

```ts
const positions = await provider.invoke('investments.positions.list', {})

const instruments = await provider.invoke('investments.instruments.search', {
  query: 'Apple',
  market: 'usa',
})
```

The provider also exposes `accounts.list`, `balances.list`, `transactions.list`, `history.list`, `investments.orders.list`, and `investments.instruments.get`. Date-range filtering is not available for order or transaction history in the observed API. `history.list` supports transaction history only.

## Orders

PayPay Securities orders use monetary amounts instead of whole-share quantities. Preview and submission are deliberately separate operations. The trade password is configured in the provider runtime and is never sent by an API caller.

```ts
const preview = await provider.invoke('investments.orders.preview', {
  instrumentId: '101',
  side: 'buy',
  amount: { currency: 'JPY', value: '1000' },
  accountType: '2',
})

console.log(preview)

const receipt = await provider.invoke('investments.orders.create', {
  confirmationToken: preview.confirmationToken,
  allowTransaction: true,
})
```

`allowTransaction: true` is required for submission. Confirmation tokens are short-lived, client-local, and single-use. Submission is never retried. If an `OrderOutcomeUnknownError` is thrown, do not submit the order again; verify its outcome in trade history.

Preorders, buy-all adjustment, profit-only sales, and PayPay-linked orders are not supported.

## Existing browser session

You can also create a low-level client from authenticated session cookies.

```ts
import { createPayPaySecClient } from '@mnie/provider-paypay-sec'

const client = createPayPaySecClient({
  baseURL: process.env.PAYPAY_SEC_BASE_URL,
  accountId: 'primary',
  cookies: {
    session_cookie_name: process.env.PAYPAY_SEC_SESSION_COOKIE!,
  },
})

console.log(await client.account.valuation())
console.log(await client.portfolio.positions({ country: 'japan' }))
```

`client.session.export()` contains authenticated cookies and must be handled as a secret. It does not contain the passkey private key, trade password, order-form CSRF token, or an order confirmation.
