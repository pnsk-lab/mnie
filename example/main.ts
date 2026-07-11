import { connectMnie } from '@repo/client-mnie'

const profile = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'your-token-here',
  provider: 'sbisec',
  profileId: 'your-sbi-profile-id',
})

const _accounts = await profile.invoke('accounts.list', {})
const _balances = await profile.invoke('balances.list', {})

profile.close()
