# client-mnie

Connection client for a Mnie server. It exposes the typed finance methods from
`@repo/mnie-types` after selecting a provider profile session.

```ts
import { connectMnie } from '@repo/client-mnie'

const client = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'mnie_xxx',
  provider: 'sbisec',
  profileId: 'sbi_xxx',
})

try {
  const profile = await client.account.profile()
  console.log(profile)
} finally {
  client.close()
}
```
