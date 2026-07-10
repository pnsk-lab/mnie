import { getBalance, getCashPositions, getIssueBoard } from 'mnie'
import { connectMnie } from '@repo/client-mnie'

const profile = await connectMnie({
  baseURL: 'https://mnie.example.com',
  token: 'your-token-here',
  passkeyId: 'your-sbi-passkey-id',
})

const _balance = await getBalance({
  profile,
})

const _positions = await getCashPositions({ profile })
const _board = await getIssueBoard({
  profile,
  issueCode: '7203',
  market: 'XTKS',
})

profile.close()
