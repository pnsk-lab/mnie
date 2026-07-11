# client-paypay-bank

PayPay Bank web client for Mnie.

```ts
import { login } from '@mnie/provider-paypay-bank'

const profile = await login({
  branchNo: process.env.PAYPAY_BANK_BRANCH,
  accountNo: process.env.PAYPAY_BANK_ACCOUNT,
  password: process.env.PAYPAY_BANK_PASSWORD,
  baseURL: process.env.PAYPAY_BANK_BASE_URL,
})

console.log(await profile.getBalance())
await profile.logout()
```

`baseURL` must be an origin. Login credentials may instead be supplied through
the three environment variables shown above.
