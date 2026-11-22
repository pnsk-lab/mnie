import { connectMnie } from '@mnie/provider-mnie-server'

const client = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'your-token-here',
})

const _methods = await client.methods()
const _accounts = await client.accounts()
const _valuation = await client.call('portfolio.valuation.get', { baseCurrency: 'JPY' })
const _balances = await client.account('your-account-id').invoke('balances.list', {})

client.close()
