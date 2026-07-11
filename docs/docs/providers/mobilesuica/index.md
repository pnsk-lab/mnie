---
title: Mobile Suica
description: Retrieve SF (electronic money) usage history from Mobile Suica.
---

# Mobile Suica

`@mnie/client-mobilesuica` is a provider client that signs in to the Mobile Suica website and retrieves its SF (electronic money) usage history.

::: warning Unofficial client
This client does not use an official public API from Mobile Suica. Changes to the website or its internal protocol may break it.
:::

## Setup

Provide the Mobile Suica website origin and account credentials. `MOBILE_SUICA_BASE_URL` must be an origin without a path, query, or fragment.

```ini
MOBILE_SUICA_BASE_URL=https://mobilesuica.example.com
MOBILE_SUICA_USER=your-email@example.com
MOBILE_SUICA_PASS=your-password
```

The client accepts credentials explicitly as well. The CAPTCHA answer must always be supplied by the account holder.

## Retrieve usage history

```ts
import { login } from '@mnie/client-mobilesuica'

const profile = await login({
  baseURL: process.env.MOBILE_SUICA_BASE_URL!,
  onCaptcha: async ({ image, contentType }) => {
    // Display `image` to the account holder and return their answer.
    return askAccountHolder(image, contentType)
  },
})

try {
  console.log(await profile.getUsageHistory())
} finally {
  await profile.logout()
}
```

`login()` reads `MOBILE_SUICA_USER` and `MOBILE_SUICA_PASS` when `user` and `password` are not supplied. CAPTCHA answers are not logged or retained by the client.

## Returned values

`getUsageHistory()` returns the 100 SF history rows displayed by Mobile Suica.

| Property  | Description                                   |
| --------- | --------------------------------------------- |
| `date`    | Date displayed for the usage row              |
| `type`    | Usage type                                    |
| `detail`  | Location or other available detail            |
| `amount`  | Amount in JPY, or `null` when unavailable     |
| `balance` | SF balance in JPY, or `null` when unavailable |

The client is read-only: it supports usage-history retrieval and logout only. It does not support charging, ticket purchases, transfers, or any other Mobile Suica operation.
