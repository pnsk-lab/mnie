# client-smbc-direct

SMBC Direct client for Mnie.

Set `SMBC_USER` to `<branch>-<account>` and `SMVC_PASS` to the login password.
The login challenge remains valid only for the short period specified by SMBC.

```ts
import { getBalance, loginWithPasskey } from '@repo/client-smbc-direct'

const { finished2fa, qrurl, url } = await loginWithPasskey()

// Display `qrurl` or open `url` with the SMBC app, then wait for approval.
const profile = await finished2fa()
const balance = await getBalance({ profile })
```

`getBalance` currently supports the ordinary-deposit balance endpoint observed
in the captured flow. Use `accountItemCode` in `loginWithPasskey` when the
account does not use the default item code.
