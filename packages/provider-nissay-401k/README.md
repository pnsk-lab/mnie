# @mnie/provider-nissay-401k

ニッセイ確定拠出年金インターネットサービスの provider です。

```ts
import { connect } from '@mnie/provider-nissay-401k'

const provider = await connect({
  baseURL: process.env.NISSAY_401K_BASE_URL!,
  userId: process.env.NISSAY_401K_USER_ID!,
  password: process.env.NISSAY_401K_PASSWORD!,
})
console.log(await provider.invoke('pension.assets.current.get', {}))
await provider.close()
```

`login()` は認証済みの `Nissay401kProfile` を返し、`createProvider(profile)` が
provider 中立 API へ変換します。認証情報は `NISSAY_401K_USER_ID` /
`NISSAY_401K_PASSWORD` / `NISSAY_401K_BASE_URL` からも読み取れます。

`baseURL` は origin のみを受け付けます。実サービスの URL はライブラリ内に保持しません。
