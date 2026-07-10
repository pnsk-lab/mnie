---
title: PayPay Bank
description: Log in to PayPay Bank and retrieve an ordinary-deposit balance.
---

# PayPay Bank

`@repo/client-paypay-bank` is a provider client that connects to PayPay Bank and retrieves an ordinary-deposit balance.

::: warning Unofficial client
This client does not use an official public API from PayPay Bank. Changes to the website or its internal protocol may break it.
:::

## Setup

```ini
PAYPAY_BANK_BRANCH=123
PAYPAY_BANK_ACCOUNT=1234567
PAYPAY_BANK_PASSWORD=your-login-password
PAYPAY_BANK_BASE_URL=https://bank.example.com
```

The branch number must contain three digits and the account number seven digits. `PAYPAY_BANK_BASE_URL` must be an origin without a path, query, or fragment.

## Login and balance retrieval

```ts
import { login } from '@repo/client-paypay-bank'

const profile = await login()

try {
  const balance = await profile.getBalance()
  console.log(balance.amount)
} finally {
  await profile.logout()
}
```

Credentials can also be passed directly to `login()`.

```ts
const profile = await login({
  branchNo: '123',
  accountNo: '1234567',
  password: process.env.PAYPAY_BANK_PASSWORD,
  baseURL: process.env.PAYPAY_BANK_BASE_URL,
})
```

## Returned values

`getBalance()` returns the following values.

| Property         | Description               |
| ---------------- | ------------------------- |
| `currency`       | Currency; currently `JPY` |
| `amount`         | Current balance           |
| `monthlyAverage` | Average monthly balance   |
| `interest`       | Interest amount           |
| `interestPoints` | Interest points           |

The currently supported operations are balance retrieval and logout. Transaction history, transfers, term deposits, and other operations are not supported. Call `logout()` from a `finally` block after use to end the session.

## Reusing a client

Use `createPayPayBankClient()` when the endpoint is fixed and you need to log in multiple times.

```ts
import { createPayPayBankClient } from '@repo/client-paypay-bank'

const client = createPayPayBankClient({
  baseURL: process.env.PAYPAY_BANK_BASE_URL!,
})

const profile = await client.login({
  branchNo: '123',
  accountNo: '1234567',
  password: process.env.PAYPAY_BANK_PASSWORD,
})
```
