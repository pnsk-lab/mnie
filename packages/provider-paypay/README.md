# client-paypay

PayPay wallet client for Mnie. It calls the read-only wallet-display endpoint identified in the
PayPay Android app. PayPay's app login requires device-bound state and integrity material, so this
package does not implement an ID/password login. Supply an already authenticated session's access
token and required app headers for each account.

```ts
import { createPayPayClient } from '@mnie/provider-paypay'

const client = createPayPayClient({
  baseURL: process.env.PAYPAY_BASE_URL!,
  accounts: [
    {
      accountId: 'personal',
      accessToken: process.env.PAYPAY_PERSONAL_ACCESS_TOKEN!,
      headers: JSON.parse(process.env.PAYPAY_PERSONAL_HEADERS_JSON!),
    },
    {
      accountId: 'business',
      accessToken: process.env.PAYPAY_BUSINESS_ACCESS_TOKEN!,
      headers: JSON.parse(process.env.PAYPAY_BUSINESS_HEADERS_JSON!),
    },
  ],
})

const profiles = await client.loginAll()
console.log(await Promise.all(profiles.map((profile) => profile.getBalance())))
```

For one account, `login()` reads `PAYPAY_BASE_URL`, `PAYPAY_ACCESS_TOKEN`, optional
`PAYPAY_ACCOUNT_ID`, and optional `PAYPAY_HEADERS_JSON`. The base URL must be an origin only.
`PAYPAY_HEADERS_JSON` must be a JSON object of string values; use it for device, integrity, and
other app-specific headers. `Authorization` is intentionally rejected there: provide the token
through `accessToken` instead.
