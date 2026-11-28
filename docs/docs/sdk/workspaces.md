# Workspaces and providers

Mnie has two scopes. A `FinancialProvider` represents one authenticated financial-service profile. A remote `MnieClient` exposes authorized Financial Accounts over the flat JSON-RPC method surface.

Method names: `account.<provider-method>` with `{ account }`, `profile.<provider-method>` with `{ profile }`, `portfolio.*`, `admin.*`.

## Direct provider

```ts
import { connectWithPasskey } from '@mnie/provider-sbi-sec'

const sbi = await connectWithPasskey({ passkeyCredential })
const positions = await sbi.invoke('investments.positions.list', {})
```

## Local client

```ts
import { createLocalClient } from '@mnie/sdk'
import type { FinancialAccountId } from '@mnie/types'

const client = createLocalClient([
  {
    account: {
      id: 'sbi-main' as FinancialAccountId,
      implementation: 'virtual-brokerage',
      category: 'brokerage',
      label: 'SBI Securities',
      kind: 'standard',
      status: 'active',
      capabilities: [],
      permissions: { read: true, trade: true, manage: true },
      version: 1,
    },
    provider: sbi,
  },
])

const valuation = await client.call('portfolio.valuation.get', { baseCurrency: 'JPY' })
```

The local client aggregates caller-owned providers. Server-side account isolation is supplied
by the remote client. Local aggregation rejects currencies that require conversion. It does not guess an exchange rate.

## Remote client

```ts
import { connectMnie } from '@mnie/provider-mnie-server'

const client = await connectMnie({ baseURL, token })
const accounts = await client.accounts()
const valuation = await client.call('portfolio.valuation.get', { baseCurrency: 'JPY' })
const transactions = await client.account(accounts[0].id).invoke('transactions.list', {})
```

The remote client uses one WebSocket by default. Pass `transport: 'rest'` to `connectMnie`
to send each call as a JSON-RPC request over `POST /api/rpc/{method}` instead. Calls use flat method names (`rpc.methods`, `portfolio.*`, `account.*`, `profile.*`, `admin.*`); there is no global active account.

`portfolio.valuation.get` returns components and errors. If a profile fails, `completeness` is `partial`; failures are not silently ignored.

## Account access and orders

API keys and OAuth grants can bind multiple virtual accounts with `accountBindings`. Each binding
has a `read` or `trade` role and its own `allowedMethods` list, using wire names such as
`account.investments.orders.preview` and `portfolio.accounts.positions`. A null per-account list
allows the existing account-scoped methods; an empty list denies them. The role, OAuth scopes and
account status still apply. Unbound keys cannot access account assets, and aggregate portfolio
requests must be permitted for every selected account. System / Unallocated accounts remain
owner-only.

Global `allowedMethods` controls common `portfolio.*` and `profile.*` methods and explicit
`admin.*` grants. A null global list does **not** grant admin or global ledger methods. Scoped
account administration additionally requires the same admin method in each affected account's
binding; a physical-account reconciliation requires permission on all affected non-system
accounts. Admin key-management permissions can grant additional privileges, so grant them only
to trusted callers. API-key time-window trade quotas are no longer enforced; per-order monetary
limits and virtual-account risk policies remain available.

On upgrade, each existing binding inherits the effective legacy account-method restrictions.
Previously inert `admin.*` and global ledger entries are removed from legacy keys and must be
granted explicitly. Legacy order methods that were blocked by the former additional unprefixed
check remain blocked until an owner explicitly grants them in the account binding.

Use `client.call('portfolio.accounts.balances', { account })`, `portfolio.accounts.positions`, `portfolio.accounts.orders`, or
`portfolio.accounts.history` for account projections. `portfolio.history.list` accepts
`accounts`; the `profiles` filter selects account profiles.

Preview an order before creating it. Submit the returned Mnie `confirmationToken`, the same order
parameters, `allowTransaction: true`, and a caller-generated `idempotencyKey`. A token-only create
request is accepted when the complete request is already held by its quote. Reuse the same
idempotency key when checking a previous submission; do not generate a new order after a
`submission_unknown` result. Query `investments.orders.get` using the public order ID.

The CLI supports `mnie account use <id>` to save an explicit default and
`mnie rpc call <method> --account <id>`. It does not select the first available trading account.

For authenticated runtime verification, add the provider session to the verification installation,
then run `scripts/verify-virtual-account-runtime.ts` with `MNIE_VERIFY_DATABASE_PATH`,
`MNIE_VERIFY_ORIGIN`, and `MNIE_VERIFY_ACCOUNT_ID`. It creates and revokes a temporary read-only
key, checks account visibility through the actual WebSocket SDK, and executes authenticated
provider reads without placing orders.
