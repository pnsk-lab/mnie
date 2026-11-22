# provider-mnie-server

Remote `MnieClient` for a Mnie server.

```ts
import { connectMnie } from '@mnie/provider-mnie-server'

const client = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'mnie_xxx',
})

try {
  const valuation = await client.call('portfolio.valuation.get', {
    baseCurrency: 'JPY',
  })
  const accounts = await client.accounts()
  const transactions = await client.account(accounts[0].id).invoke('transactions.list', {})
  console.log({ valuation, transactions })
} finally {
  client.close()
}
```

Calls map to flat wire method names: `client.call('portfolio.valuation.get')` sends `portfolio.valuation.get`, and the `account(id)` / `profile(id)` proxies prefix provider methods as `account.<method>` / `profile.<method>` with the matching selector. The client uses one WebSocket by default; pass `transport: 'rest'` to send each call as a JSON-RPC request over `POST /api/rpc/{method}` instead.
