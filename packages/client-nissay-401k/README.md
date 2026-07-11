# @mnie/client-nissay-401k

ニッセイ確定拠出年金インターネットサービスの Node.js クライアントです。

```ts
import { createNissay401kClient } from '@mnie/client-nissay-401k'

const client = createNissay401kClient({ baseURL: process.env.NISSAY_401K_BASE_URL! })
const profile = await client.login({ userId: '...', password: '...' })
console.log(await profile.invoke('pension.assets.current.get', {}))
await profile.close()
```

`baseURL` は origin のみを受け付けます。実サービスの URL はライブラリ内に保持しません。
