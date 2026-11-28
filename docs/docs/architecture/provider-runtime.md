---
title: Provider runtime architecture
description: Server-side provider lifecycle, WebSocket RPC boundaries, and operation availability.
---

# Provider runtime architecture

Mnie treats an authenticated provider session as a connection and exposes Financial Accounts as operation targets. Application code does not import a
provider SDK directly. The server-side `ProviderRegistry` is the only component responsible for
opening a provider, importing or renewing its session, persisting the resulting session, and
describing its background refresh policy.

## Boundaries

- Provider packages implement `FinancialProvider` and own remote protocol details.
- Providers report projected and committed physical asset changes for mutating methods; they do
  not read or update virtual accounts.
- `ProviderRegistry` owns provider construction and credential/session lifecycle.
- `portfolio.*` methods read only accounts visible to their caller. `FinancialAccountService` applies
  account ACLs and policies; `OrderCoordinator` persists quotes, reservations, and order state.
- `account.<method>` invokes one provider method for one virtual account (`params.account`
  selects it). `PhysicalAccountGateway` is the
  only account execution component that holds a raw provider and exposes separate read, preview,
  place, replace, and cancel commands.
- `profile.<method>` invokes one provider method for one account profile (`params.profile`
  selects it), as a raw passthrough with no virtual-account layer.
- `admin.*` manages local profiles, encrypted credentials, API keys, background jobs, and
  interactive authentication.
- HTTP exposes application authentication, OAuth endpoints, the WebSocket upgrade, REST RPC at
  `/api/rpc/{method}` (POST-only; the request body is a JSON-RPC request whose `method` must
  match the path), and
  Streamable HTTP MCP at `/api/mcp` (also available at `/mcp`). MCP tools delegate
  to the same RPC handler, including account access, scopes, and per-order monetary limits.
  API keys may call explicitly granted `admin.*` methods. Account-scoped admin methods also
  require an explicit grant for each affected virtual account; legacy unrestricted keys do not
  implicitly receive admin or global ledger access. There are no application REST endpoints.

## Physical and virtual balances

Providers only report physical snapshots and operation effects. They do not know that virtual
accounts exist. Before trading, the account service refreshes the physical asset cache and reconciles it against
virtual allocations. Read operations use account projections. Background snapshots follow each
provider's refresh interval; unresolved orders are checked separately.

Every physical account has one system-owned `Unallocated` account. It has no stored holdings of its
own: its displayed amount is the cached physical amount minus the available, reserved, and pending
amounts allocated to all other virtual accounts. An external increase therefore increases
`Unallocated`; an external decrease reduces it.

Standard virtual accounts share one account kind. On startup, SQLite converts legacy `personal` and
`agent` values to `standard` while preserving account IDs, labels, allocations, and key grants.
API key grants can include `Unallocated` with a read role and an explicit set of methods. Scoped
administrative operations on `Unallocated` require an explicit grant on that account, including
for existing keys that previously accessed it indirectly.

If any derived `Unallocated` amount becomes negative, every virtual account below that physical
account enters `reconciliation_required` and mutating provider operations are blocked. The lock is
not removed automatically. An owner must return enough allocation to `Unallocated`, then approve
the reconciliation through the admin API or UI.

Credentials and resumable sessions are stored in the platform keyring. SQLite stores only profile
metadata and the opaque keyring account identifier. The legacy `sbi_passkeys` table is read once by
the database migration and is not used by the runtime.

## Operation availability

Connection health and operation availability are separate. A provider can be logged in while one
specific operation is unavailable because of the instrument, market session, account, order mode,
or provider inventory.

Providers advertise methods with `methods()`. For static or request-specific restrictions,
they may implement `checkMethodAvailability({ method, params })`. The result can include
provider-neutral investment order rules:

- quantity sizing, including minimum, increment, maximum, and board lot;
- notional amount sizing with currency, minimum, and increment;
- market or limit pricing;
- realtime or opening execution;
- venue and time-in-force choices;
- correction and cancellation support.

An implementation must reject an unavailable operation before submitting an order. It must not
silently replace the requested mode with another mode.

## Brokerage examples

The model intentionally supports materially different brokerage execution models:

- PayPay Securities accepts amount-specified stock orders and can represent fractional ownership
  because it acts as principal in an over-the-counter transaction. This maps to `sizing.kind =
"amount"`; provider inventory or quoting restrictions are request-specific availability failures.
  See [PayPay Securities app trading instructions](https://www.paypay-sec.co.jp/tool/trade/use/)
  and its [official FAQ](https://www.paypay-sec.co.jp/support/faq/faq.html).
- Rakuten Securities' Kabumini odd-lot service supports quantity orders below the board lot and has
  distinct realtime and opening executions. Realtime supports market and limit prices; opening
  execution is market-only. Instrument eligibility and realtime market-making are request-specific.
  See the [official Kabumini trading rules](https://www.rakuten-sec.co.jp/web/domestic/ols/rule/).
- Rakuten SOR is a venue-routing choice for eligible whole-lot orders, not an odd-lot fallback. Its
  supported venues and execution conditions map to `execution.venue` and operation availability.
  See the [official SOR rules](https://www.rakuten-sec.co.jp/smartphone/domestic/sor/rule/ground_rules.html).

These names are examples, not core-domain enum values. Adding a provider must not require adding
provider-specific fields to workspace, portfolio, history, or UI state.

## Adding a provider

1. Implement the common provider contract in a `provider-*` package.
2. Register its construction, session persistence, credential form, and refresh policy in
   `ProviderRegistry`.
3. Implement request-specific availability when trading rules cannot be inferred from advertised
   operations.
4. Expose trading only through common `investments.orders.*` methods. Provider-native methods
   may remain available for diagnostics, but application UI must not depend on them.
5. Verify login, session export/import, availability, and at least one read operation using real
   credentials before declaring the provider supported.

## Durable order boundary

Public confirmation tokens are Mnie quote IDs, bound to an account, principal, request hash,
account version, expiry, and one-time consumption. Broker tokens are encrypted in SQLite using the
credential keyring encryption key. Changes to account settings, access, or the selected account
invalidate outstanding quotes.

Creation reserves assets and inserts a `submitting` order in the same SQLite transaction. The
broker call runs after commit. Transport errors retain the reservation as `submission_unknown`;
startup recovery also preserves ambiguous submissions. An idempotency key cannot submit twice.
Cancellation receipts retain reservations until terminal broker state is confirmed. Replacements
reserve additional assets first and restore the original reservation on a definite rejection.

A provider must explicitly declare the `accountIsolation` contract before virtual-account trading
or automated brokerage migration is enabled. It must provide cash totals including reservations,
stable broker order references, attributable cumulative settlement effects, and a complete open
order snapshot. Amount estimates alone do not establish safe market-buy limits.

The SBI Securities adapter declares the contract: its `current` balance is the domestic deposit
total (which still contains cash reserved by open orders), order references come from the broker's
order number/sub-number, order snapshots carry cumulative effects computed from exact executed
quantities and prices, and the open-order inquiry returns every recent order (flagged incomplete
only at the 999-row cap or on inquiry errors). Order placement still requires a successful broker
preview, so trading remains unavailable while SBI does not issue confirmations (for example, for
next-business-day orders outside trading hours).

The PayPay Securities adapter does not declare the contract. Its order-submission response exposes
no stable broker order reference and no open-order endpoint has been observed, so coordinated
trading stays disabled for that provider.

The boundary is tested in `account-architecture.bun.test.ts`; durable reservations, idempotency,
ACL isolation, timeout handling, partial fills, cancellation, and replacement are tested against
SQLite in `account-boundaries.bun.test.ts`.
