# client-mnie

Remote `FinancialWorkspace` client for a Mnie server.

```ts
import { connectMnie } from '@repo/client-mnie'

const workspace = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'mnie_xxx',
})

try {
  const valuation = await workspace.invoke('portfolio.valuation.get', {
    baseCurrency: 'JPY',
  })
  const profiles = await workspace.profiles()
  const transactions = await workspace.profile(profiles[0].id).invoke('transactions.list', {})
  console.log({ valuation, transactions })
} finally {
  workspace.close()
}
```

The client uses one WebSocket and explicitly scopes requests as `workspace.invoke` or `profile.invoke`.
