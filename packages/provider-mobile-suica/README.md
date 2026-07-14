# client-mobilesuica

Mobile Suica web client for Mnie. It reads SF (electronic money) usage history. Mobile Suica has
no pagination, but supports searching for records on or before a selected date; range requests
repeat that search to retrieve older history.

```ts
import { login } from '@mnie/provider-mobile-suica'

const profile = await login({
  user: process.env.MOBILE_SUICA_USER,
  password: process.env.MOBILE_SUICA_PASS,
  baseURL: process.env.MOBILE_SUICA_BASE_URL,
  onCaptcha: async ({ image, contentType }) => {
    // Display `image` to the account holder and return their answer.
    return askAccountHolder(image, contentType)
  },
})

console.log(await profile.getUsageHistory())
await profile.logout()
```

`baseURL` must be an origin. Credentials can instead be set through
`MOBILE_SUICA_USER` and `MOBILE_SUICA_PASS`. CAPTCHA answers are never logged
or retained by this package.
