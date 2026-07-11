---
title: Nissay 401k client
description: Log in to Nissay's corporate defined-contribution pension service and retrieve assets, contributions, and history.
---

# Nissay 401k client

`@mnie/client-nissay-401k` connects to the Nissay corporate defined-contribution pension website. Its implementation is based on the request flow and parsers in [fa0311/nissay_401k_app](https://github.com/fa0311/nissay_401k_app).

::: warning Unofficial client
This package does not use an official public API. Website, authentication-flow, or HTML changes can break it.
:::

## Create a client

The endpoint is deliberately not embedded in the package. Supply an origin without a path, query, or fragment.

```ini
NISSAY_401K_BASE_URL=https://example.com
NISSAY_401K_USER_ID=your-user-id
NISSAY_401K_PASSWORD=your-password
```

```ts
import { createNissay401kClient } from '@mnie/client-nissay-401k'

const client = createNissay401kClient({
  baseURL: process.env.NISSAY_401K_BASE_URL!,
})
```

`timeoutMs` changes the default 15-second request timeout. `fetch` can be supplied for runtime integration or testing.

## Login and retrieve data

```ts
const profile = await client.login({
  userId: process.env.NISSAY_401K_USER_ID!,
  password: process.env.NISSAY_401K_PASSWORD!,
})

try {
  const [header, current, contribution, history] = await Promise.all([
    profile.getHeader(),
    profile.getCurrentAssets(),
    profile.getContribution(),
    profile.getHistoricalAssets(),
  ])

  console.log(header.name)
  console.log(current.totalAsset, current.holdings)
  console.log(contribution.contributionAmount, contribution.allocations)
  console.log(history.entries)
} finally {
  await profile.logout()
}
```

Authentication failures throw `Nissay401kAuthError`. Unexpected responses, missing HTML elements, invalid numeric values, and redirect errors throw `Nissay401kError`; the client does not return partial fallback data.

## Returned data

| Method                  | Result                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `getHeader()`           | Participant name                                                                                         |
| `getCurrentAssets()`    | Plan, last login, valuation date, total assets, cumulative contributions, profit/loss, ROI, and holdings |
| `getContribution()`     | Next contribution amount/date and product allocation ratios                                              |
| `getHistoricalAssets()` | Monthly cumulative contributions, total assets, and profit/loss                                          |

All dates are returned as JavaScript `Date` values. Monetary values are integer yen amounts; ratios and ROI are numbers. The parser supports the service's full-width `＋` and `▲` positive/negative notation.

## Export and restore a session

```ts
const saved = profile.session.export()

const restored = client.importSession(saved)
const current = await restored.getCurrentAssets()
```

The exported value contains credentials and cookies. Store it as a secret and never log or commit it. `importSession()` also verifies that its origin matches the client origin.

## Supported runtime

The package targets Node.js and depends on a Fetch-compatible runtime. It maintains cookies itself and follows redirects while validating the final response path.
