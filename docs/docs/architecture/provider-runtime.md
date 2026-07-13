---
title: Provider runtime architecture
description: Server-side provider lifecycle, WebSocket RPC boundaries, and operation availability.
---

# Provider runtime architecture

Mnie treats every authenticated financial account as a profile. Application code does not import a
provider SDK directly. The server-side `ProviderRegistry` is the only component responsible for
opening a provider, importing or renewing its session, persisting the resulting session, and
describing its background refresh policy.

## Boundaries

- Provider packages implement `FinancialProvider` and own remote protocol details.
- `ProviderRegistry` owns provider construction and credential/session lifecycle.
- `workspace.invoke` aggregates multiple profiles without exposing their SDKs.
- `profile.invoke` invokes one operation advertised by one profile.
- `admin.invoke` manages local profiles, encrypted credentials, API keys, background jobs, and
  interactive authentication.
- HTTP is limited to application authentication, OAuth endpoints, and the WebSocket upgrade.
  Application data and administration do not have REST or MCP-over-HTTP endpoints.

Credentials and resumable sessions are stored in the platform keyring. SQLite stores only profile
metadata and the opaque keyring account identifier. The legacy `sbi_passkeys` table is read once by
the database migration and is not used by the runtime.

## Operation availability

Connection health and operation availability are separate. A provider can be logged in while one
specific operation is unavailable because of the instrument, market session, account, order mode,
or provider inventory.

Providers advertise operations with `operations()`. For static or request-specific restrictions,
they may implement `checkOperationAvailability({ operation, input })`. The result can include
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
4. Expose trading only through common `investments.orders.*` operations. Provider-native operations
   may remain available for diagnostics, but application UI must not depend on them.
5. Verify login, session export/import, availability, and at least one read operation using real
   credentials before declaring the provider supported.
