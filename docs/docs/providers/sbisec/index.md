---
title: SBI Securities
description: Connect to SBI Securities with a passkey and access market, account, and order operations.
---

# SBI Securities

`@repo/client-sbi` is a provider client that authenticates to SBI Securities with a passkey. After login, Mnie's shared typed interface provides access to account data, market data, positions, and orders.

::: warning Unofficial client
This client does not use an official public API from SBI Securities. Changes to the website or its internal protocol may break it. Always review the estimate before calling an order placement method.
:::

## Setup

Prepare a `passkey.json` containing your actual passkey credential and configure the service origins through environment variables. URLs must contain only an origin, without a path, query, or fragment.

```ini
SBI_AUTH_BASE_URL=https://auth.example.com
SBI_MTS_BASE_URL=https://trade.example.com
SBI_IZANAGI_BASE_URL=https://search.example.com
```

`SBI_AUTH_BASE_URL` and `SBI_MTS_BASE_URL` are required. Issue search requires `SBI_IZANAGI_BASE_URL`. US stocks, asset valuations, and foreign exchange operations require their respective additional endpoints.

## Login

```ts
import { readFile } from 'node:fs/promises'
import { loginWithPasskey, type PlaintextStoredWebAuthnCredential } from '@repo/client-sbi'

const passkeyCredential = JSON.parse(
  await readFile('./passkey.json', 'utf8'),
) as PlaintextStoredWebAuthnCredential

const profile = await loginWithPasskey(
  { passkeyCredential },
  { tradePassword: process.env.SBI_TRADE_PASSWORD },
)

const account = await profile.account.profile()
console.log(account)
```

A trading password is required to place orders. When an operation requires phone verification, use `tradeAuthentication.onRequired` to prompt the user to make the verification call.

## Capabilities

| Category              | Available operations                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Account               | Profile, buying power, cash and margin positions, profit and loss, and asset valuations               |
| Market                | Issue search, order books, charts, market overview, indexes, rankings, and news                       |
| Management            | Watchlists, order inquiries, and execution history                                                    |
| Domestic stocks       | Estimates, placement, correction, and cancellation for cash, margin, IFD, and theme investment orders |
| Foreign stocks and FX | US stock data and orders, exchange rates, and foreign exchange orders                                 |

Some operations are available only when their additional endpoints are configured. The client throws an explicit error when an endpoint is missing or a market is unsupported.

## Market data example

```ts
const board = await profile.market.issue.board({
  issueCode: '7203',
  market: 'XTKS',
})

const positions = await profile.account.positions.cash({ market: 'XTKS' })
```

To continuously retrieve the order book, consume the async iterator returned by `pollBoard()`. Pass an `AbortSignal` to stop polling.

## Order example

Validate an order with `estimate`, then explicitly pass `allowTrading: true` to `place`.

```ts
const order = {
  issueCode: '7203',
  market: 'XTKS' as const,
  side: 'buy' as const,
  quantity: 100,
  kind: 'limit' as const,
  price: 2500,
}

const preview = await profile.orders.cash.estimate(order)
console.log(preview)

const receipt = await profile.orders.cash.place({
  ...order,
  allowTrading: true,
})
```

`allowTrading` guards against accidental order placement. Prices and buying power may change between estimation and placement, so always inspect the returned result as well.
