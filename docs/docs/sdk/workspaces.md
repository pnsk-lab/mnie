# Workspaces and providers

Mnie has two scopes. A `FinancialProvider` represents one authenticated financial-service profile. A `FinancialWorkspace` owns multiple profiles and implements cross-profile operations.

## Direct provider

```ts
import { connectWithPasskey } from '@mnie/provider-sbi-sec'

const sbi = await connectWithPasskey({ passkeyCredential })
const positions = await sbi.invoke('investments.positions.list', {})
```

## Local workspace

```ts
import { createLocalWorkspace } from '@mnie/sdk'

const workspace = createLocalWorkspace([
  {
    profile: { id: 'sbi-main', label: 'SBI Securities', provider: sbi.descriptor },
    provider: sbi,
  },
])

const valuation = await workspace.invoke('portfolio.valuation.get', { baseCurrency: 'JPY' })
```

Local aggregation rejects currencies that require conversion. It does not guess an exchange rate.

## Remote workspace

```ts
import { connectMnie } from '@repo/client-mnie'

const workspace = await connectMnie({ baseURL, token })
const profiles = await workspace.profiles()
const valuation = await workspace.invoke('portfolio.valuation.get', { baseCurrency: 'JPY' })
const transactions = await workspace.profile(profiles[0].id).invoke('transactions.list', {})
```

The remote workspace uses one WebSocket. Calls are explicitly scoped as `workspace.invoke` or `profile.invoke`; there is no global active profile.

`portfolio.valuation.get` returns components and errors. If a profile fails, `completeness` is `partial`; failures are not silently ignored.
