# @mnie/starbucks-jp

Starbucks Japan Light Web App の Node.js クライアントです。

```ts
import { createStarbucksJpClient } from '@mnie/starbucks-jp'

const client = createStarbucksJpClient({
  apiOrigin: process.env.STARBUCKS_API_ORIGIN!,
  loginOrigin: process.env.STARBUCKS_LOGIN_ORIGIN!,
  appOrigin: process.env.STARBUCKS_APP_ORIGIN!,
})

const authorization = await client.beginAuthorization('/redirect?pageRedirect=/card/sbcardinfo')
console.log(authorization.url) // Open this URL and authenticate.

// Pass the resulting callback URL to completeAuthorization.
const session = await client.completeAuthorization(authorization, callbackURL)
const cards = await session.listCards()
console.log(cards)
```

認証情報をSDKへ渡さず、認可URLをブラウザまたは任意のOAuthクライアントで開いてください。サイト側がブラウザ生成のデバイスフィンガープリントを要求するため、ユーザー名・パスワードのHTTPフォーム再送はサポートしていません。

既存セッションは `client.importSession({ sessionId })` で再利用できます。すべての origin はパス、クエリ、フラグメントを含まない値を指定してください。
