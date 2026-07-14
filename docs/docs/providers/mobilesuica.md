---
title: Mobile Suica
description: Retrieve SF (electronic money) usage history from Mobile Suica.
---

# Mobile Suica 🐧

`@mnie/provider-mobile-suica` signs in to the Mobile Suica website and exposes its SF usage history through the shared provider interface.

::: warning Unofficial client
This client does not use an official public API from Mobile Suica. Changes to the website or its internal protocol may break it.
:::

## Required Credentials

Provide the Mobile Suica website origin and account credentials. `MOBILE_SUICA_BASE_URL` must be an origin without a path, query, or fragment.

- Mobile Suica Base URL
- email address
- password

Example using `.env`:

```ini
MOBILE_SUICA_BASE_URL=https://mobilesuica.example.com
MOBILE_SUICA_USER=your-email@example.com
MOBILE_SUICA_PASS=your-password
```

The client accepts credentials explicitly as well. `onCaptcha` is responsible for returning the five-character CAPTCHA answer and can use either user input or an image recognition model.

## SDK

### Install

```ts
bun add @mnie/provider-mobile-suica
```

### Usage

```ts
import { captchaModelPath, createCaptchaSolver } from '@repo/capsolve-sp'
import { createProvider, login } from '@mnie/provider-mobile-suica'

const captchaSolver = await createCaptchaSolver(captchaModelPath())

const profile = await login({
  baseURL: process.env.MOBILE_SUICA_BASE_URL!,
  user: process.env.MOBILE_SUICA_USER!,
  password: process.env.MOBILE_SUICA_PASS!,
  onCaptcha: ({ image }) => captchaSolver.solve(image),
})

try {
  const provider = createProvider(profile)
  console.log(await provider.invoke('transactions.list', {}))
} finally {
  await profile.logout()
}
```

`@repo/capsolve-sp` is a private workspace package in this monorepo. Its model is downloaded by the root `bun install`; set `CAPSOLVE_MODEL_PATH` only when the model is stored somewhere other than the default location. A recognition error causes `login()` to reject rather than prompting for a fallback answer.

### CAPTCHA solver

The bundled `@repo/capsolve-sp` package recognizes the five-character CAPTCHA image returned by Mobile Suica. Run `bun install` at the repository root before starting the server; it downloads the ONNX model used by the solver.

The default model path is `../../models/model.onnx`, resolved from the process working directory. When running the SDK from another directory or when the model is stored elsewhere, provide its absolute path with `CAPSOLVE_MODEL_PATH`:

```ini
CAPSOLVE_MODEL_PATH=/absolute/path/to/model.onnx
```

For direct SDK use, create one solver and pass its `solve` method to `onCaptcha`, as in the example above. In the Mnie application this is already wired into the Mobile Suica login flow: it shows the CAPTCHA and fills a suggested answer. The account holder can review or replace that answer before submitting it.

`login()` reads `MOBILE_SUICA_USER` and `MOBILE_SUICA_PASS` when `user` and `password` are not supplied. CAPTCHA answers are not logged or retained by the client.

## Returned values

`getUsageHistory()` returns the SF history rows currently displayed by Mobile Suica. The website
does not expose pagination, but it supports searching for records on or before a selected date.
The provider repeats that search for `from` / `to` range requests. If a single day reaches the
100-record display limit, the provider throws instead of returning incomplete history.

| Property  | Description                                   |
| --------- | --------------------------------------------- |
| `date`    | Date displayed for the usage row              |
| `type`    | Usage type                                    |
| `detail`  | Location or other available detail            |
| `amount`  | Amount in JPY, or `null` when unavailable     |
| `balance` | SF balance in JPY, or `null` when unavailable |

The client is read-only: it supports usage-history retrieval and logout only. It does not support charging, ticket purchases, transfers, or any other Mobile Suica operation.
