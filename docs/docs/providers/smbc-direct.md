---
title: SMBC Direct
description: Connect to SMBC Direct with app approval and retrieve account data.
---

# SMBC Direct

`@mnie/provider-smbc-direct` is the SMBC Direct provider. After QR approval, it exposes common balances and transaction operations.

::: warning Unofficial client
This client does not use an official public API from SMBC. Changes to the website or its internal protocol may break it.
:::

## Setup

```ini
SMBC_USER=123-1234567
SMVC_PASS=your-login-password
SMBC_DIRECT_BASE_URL=https://direct.example.com
SMBC_DIRECT_LOGIN_BASE_URL=https://login.example.com
```

Format `SMBC_USER` as `<branch>-<account>`. The password environment variable is named `SMVC_PASS` to match the implementation. Each endpoint must be an origin without a path.

## Login

```ts
import { loginWithPasskey } from '@mnie/provider-smbc-direct'

const challenge = await loginWithPasskey()

// Display challenge.qrurl as an image or open challenge.url in the SMBC app.
console.log(challenge.url)

// Call this within the approval window after approving in the app.
const profile = await challenge.finished2fa()
```

`qrurl` is a PNG Data URL, while `url` is a deep link for the SMBC app. Calling `finished2fa()` before approval or after the approval window has expired throws an error.

## Available operations

| Method                        | Description                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `getAccounts()`               | Retrieve the configured ordinary-deposit account                     |
| `getBalance()`                | Retrieve the ordinary-deposit balance                                |
| `getTransactions()`           | Retrieve transactions and deposit/withdrawal totals for a date range |
| `getTransferRecipients()`     | Retrieve saved and previously used transfer recipients               |
| `getTransferRecipient(index)` | Retrieve one previously used recipient                               |
| `estimateTransferFee()`       | Estimate only the transfer fee                                       |
| `logout()`                    | End the session                                                      |

Recipient methods and fee estimation do not confirm or execute a transfer. This client does not support executing transfers.

## Balance and transactions

```ts
const balance = await profile.getBalance()

const history = await profile.getTransactions({
  startDate: '20260701',
  endDate: '20260710',
})

console.log(balance.amount, history.transactions)
await profile.logout()
```

Dates use the `YYYYMMDD` format. The account list currently returns only the ordinary-deposit account used to log in. If the account uses a non-default item code, pass it with `loginWithPasskey({ accountItemCode: '...' })`.

## Fee estimation

```ts
const fee = await profile.estimateTransferFee({
  amount: 10_000,
  recipientName: 'YAMADA TARO',
})
```

`amount` must be a positive safe integer in JPY. The result is the bank's native response and is not currently normalized to a provider-neutral type.
