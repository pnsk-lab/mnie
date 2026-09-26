---
title: VPass
description: Connect to VPass with an app-compatible login and retrieve cards and statements.
---

# VPass

`@mnie/provider-vpass` connects to VPass (三井住友カード) using the Android
app's internal authentication protocol. It exposes cards and statement
transactions through Mnie's common provider operations.

::: warning Unofficial, reverse-engineered client
This provider does not use a public SMBC API. The app protocol, RSA keys,
response shapes, and bot-management behavior can change without notice. The
reconstructed login and session flow has completed a live verification, but that
does not guarantee compatibility with future app/service versions or every
deployment environment.
:::

## Server configuration

Set the two service origins before creating or opening a VPass profile:

```ini
VPASS_API_BASE_URL=https://app-api.example.com
VPASS_WEB_BASE_URL=https://member.example.com
VPASS_APP_VERSION=<app protocol version>
# Optional overrides:
VPASS_OS_VERSION=<Android release>
VPASS_USER_AGENT=<full app prefix and runtime WebView User-Agent>
```

- `VPASS_API_BASE_URL` is the Android app API origin used for authentication.
- `VPASS_WEB_BASE_URL` is the member-site origin used for cards and statements.
  It is also the origin Mnie gives an Auth Manager when looking up a matching
  Bitwarden item.
- `VPASS_APP_VERSION` is required and selected by the deployment; the provider does not silently choose a potentially stale app version.
- `VPASS_OS_VERSION` and `VPASS_USER_AGENT` are optional overrides. By default the provider uses its live-verified Android 15/WebView profile and composes the `com.smbc_card.vpass.android_v<appVersion> ` prefix from `VPASS_APP_VERSION`.

Both URLs must be HTTPS origins only: no credentials, path, query, or fragment.
Real service endpoints are deliberately not compiled into Mnie.

Credentials are entered through the VPass provider form in Settings. Select
**VPass ID** or **統合ID (FA)** to match the identifier being entered. The
server stores the login ID, password, stable device UUID, and resumable session
in Mnie's encrypted keyring; SQLite contains only profile metadata and the
keyring account name.

## SDK usage

```ts
import { connect, createProvider } from '@mnie/provider-vpass'

const profile = await connect({
  apiBaseURL: process.env.VPASS_API_BASE_URL!,
  webBaseURL: process.env.VPASS_WEB_BASE_URL!,
  appVersion: process.env.VPASS_APP_VERSION!,
  loginId: process.env.VPASS_ID!,
  password: process.env.VPASS_PASSWORD!,
  idKind: 'vpass', // or 'fa'
})

const provider = createProvider(profile)
const accounts = await provider.invoke('accounts.list', {})
const transactions = await provider.invoke('transactions.list', {
  from: '2026-06-01',
  to: '2026-08-31',
})
```

The standalone SDK requires explicit origins. It never substitutes production
hosts when configuration is absent.

## Available operations

| Operation           | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `accounts.list`     | Lists cards from the member site's multi-card response       |
| `transactions.list` | Reads statement rows and normalizes them as JPY transactions |
| `history.list`      | Returns the same transactions as common history items        |

The provider advertises `accounts:read`, `transactions:read`, and `cards:read`.
It deliberately does **not** implement `balances.list`: the service reports
billed and unbilled statement totals, not an account balance, and treating one
as the other would be misleading.

Statement periods and usage dates do not necessarily align. A date-range
request widens the range by one billing month on each side and then filters rows
by usage date. Charges delayed by more than that window may require a wider
caller-supplied range. Negative statement rows are represented as credit/deposit
transactions. Rows without usage dates, such as headings and subtotals, are
omitted.

VPass rows do not expose a stable upstream transaction ID. Mnie therefore uses
an `ordered-snapshot` observation policy with a fingerprint over usage date,
merchant, and amount. The billing month is excluded because a re-billed charge
can move between statements. Transaction ids additionally contain the returned
statement period and row index, so repeated reads of the same statement are
stable but duplicate charges across genuinely different periods are not
certain to collapse.

`accounts.list` may report more than one card. Statement requests currently use
the authenticated/default card only; selecting transactions independently for
each listed card is not implemented.

## Auto-login and session lifecycle

A successful credential login returns an auto-login token. A later process can
resume with it instead of presenting the password:

```ts
import { resume } from '@mnie/provider-vpass'

const profile = await resume(savedSession)
await saveSession(profile.session)
```

The token rotates on every successful login. Persist the newly returned session
immediately; do not run concurrent consumers with the same token. A session
also carries a stable device UUID and the cookies shared by the app and member
origins. After additional member calls, direct SDK users should persist
`provider.exportSession()` rather than the original `profile.session`, because
the live cookie jar may have changed. Treat the entire session as a credential.

`ProviderRegistry` manages this automatically:

1. the first credential login generates one UUID-shaped device ID;
2. `open()` first tries the stored token unless forced to log in;
3. only an authentication failure falls back to the stored login ID/password;
4. immediately after authentication, the rotated token and device ID are written
   to the keyring, then later provider use also persists the current live cookie
   snapshot; and
5. availability and connection checks can force a credential login when the
   resumed session is no longer usable.

The password fallback is important because a failed token attempt may leave the
old token unusable. Other transport and parsing failures are not hidden by a
credential retry.

The app normally includes an FCM registration token. The SDK can accept a
captured `deviceToken`, but the Mnie registry sends an empty value; live
credential and token login succeeded with that empty value and `push: false`.
The registry requires an externally selected app version and otherwise uses the
provider's Android OS/User-Agent defaults; it does not expose an authentication-endpoint override.

Creating a profile does not start an initial history sync; data is read when the
profile is invoked or an explicit history sync is requested. The UI can save a
profile before the two origins are configured, but opening it then fails with an
explicit configuration error.

## Bitwarden Auth Manager

Registering a provider does not automatically make it work with Bitwarden.
Mnie's Auth Manager flow needs both:

1. an origin for vault matching; and
2. a UI mapping from the selected credential to the provider form.

For VPass, the server maps `vpass` to the origin of `VPASS_WEB_BASE_URL`, and
the UI maps the Bitwarden item's username and password to the VPass login ID and
password fields. The Bitwarden login item therefore needs a URI matching the
member-site origin. The app API origin is not used for credential matching.

Bitwarden is an **import source**, not the provider's runtime credential store:

1. the user selects a configured Bitwarden Auth Manager and enters its master
   password;
2. Mnie unlocks the desktop vault and looks for exactly one login item matching
   the configured origin;
3. username and password are copied into the provider form; and
4. saving the profile copies those credentials into Mnie's encrypted keyring.

VPass does not reopen Bitwarden on every login, and passkeys are not involved.

In the VPass form, choose **Bitwarden から読み込む**, select the configured Auth
Manager, and enter its master password. Choose **Auth Manager から読み込む** to
fill the login ID and password, then close the dialog and save the profile.
The ID kind remains the value selected in the VPass form; choose **Vpass ID** or
**統合ID** to match the imported login. Credentials can also be entered manually.

## Authentication protocol summary

The request body carries an eight-field, pipe-delimited plaintext record inside
a hybrid envelope:

```text
request:
Base64.NO_WRAP | NO_PADDING(
  IV[16]
  || AES-128-CBC-PKCS7(plaintext, randomKey, IV)
  || RSA-2048-OAEP-SHA256(randomKey)[256]
)

response login_token:
Base64(
  IV[16]
  || AES-128-CBC-PKCS7(plaintext, randomKey, IV)
  || RSA-2048-PKCS1-v1_5-private-encrypted(randomKey)[256]
)
```

The public key comes from APK asset `assets/f2hKiZCtFQdbfuiVGduZ.pem`. Both the
AES key and IV are fresh 16-byte printable-ASCII values. Credential and token
logins use different SHA-256 digest input orderings. The app API login response
also seeds the cookies needed by the member API, so one cookie jar is replayed
across both origins.

The member API's `requestHash` is Adler-32 of the exact pathname. It is a
checksum, not a secret or signature.

Implementation details and the evidence trail are documented in:

- `packages/provider-vpass/README.md` in this repository; and
- `docs/authentication.md` in the sibling VPassFucker research repository.

## Verification

### Offline and captured-traffic verification

The following have been checked without making a live authentication request:

- request/response envelope partitioning and cipher behavior;
- RSA OAEP with SHA-256 and MGF1-SHA256 on requests;
- response key selection and PKCS#1 v1.5 recovery using a captured
  `login_token`;
- the ten-field decrypted response layout;
- `requestHash` values for the observed member paths;
- card and statement response parsing;
- credential/token request flags, date filtering, year-boundary period
  arithmetic, refund direction, and duplicate suppression in local tests; and
- atomic, mode-`0600` session-file behavior in the verification-script tests.

### Live verification

An authorized end-to-end check using app version `5.13.0`, Android 15, the
generic WebView profile, an empty FCM `deviceToken`, and `push: false` verified:

- credential `Fauth` acceptance of the reconstructed request key, plaintext,
  digest, envelope, and flags;
- card listing and latest-statement access through the shared cookie jar;
- token login and token rotation; and
- a subsequent authenticated member-session check.

FA/Vauth, push registration, per-card statements, broad-history completeness,
other deployment environments, and future service compatibility remain
unverified. Akamai behavior can differ between environments.

A non-JSON member response can be an HTML bot-management challenge rather than
a JSON or authentication bug. The provider reports that distinction but does
not try to bypass the challenge.

## Live verification script

A deliberately explicit script exists for an authorized account. From the
repository root, set a private `.env`:

```ini
VPASS_API_BASE_URL=<app API origin>
VPASS_WEB_BASE_URL=<member-site origin>
VPASS_APP_VERSION=<app protocol version>
VPASS_ID=<login ID>
VPASS_PASSWORD=<password>
# Optional diagnostic overrides:
# VPASS_DEVICE_ID=<stable lowercase UUID>
# VPASS_OS_VERSION=<Android release>
# VPASS_USER_AGENT=<full app prefix and runtime WebView User-Agent>
```

Then run:

```sh
bun run verify:vpass
bun run verify:vpass --resume
bun run verify:vpass --help
```

The default run performs password login, saves the new session, reads cards and
the latest statement, performs token login, saves the rotated token, and checks
the authenticated member session. `--resume` uses the saved session without
requiring the password.

The session defaults to `data/vpass/session.json`, is written atomically with
mode `0600`, and is gitignored. On first login the provider generates one device
UUID and the script saves it for later resumes. `VPASS_SESSION_FILE` overrides
the path. The script logs only stage names, HTTP path/status metadata, and counts; it avoids
credentials, cookies, tokens, transaction details, raw provider messages, and
response bodies.

Do not run live verification concurrently and do not commit its `.env` or
session file.
