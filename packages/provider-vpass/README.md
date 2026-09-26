# @mnie/provider-vpass

VPass (三井住友カード) provider. It uses the Android app API for authentication
and the member site's JSON API for cards and statements, without scraping the
member website's HTML.

```ts
import { connect, createProvider } from '@mnie/provider-vpass'

const profile = await connect({
  apiBaseURL: process.env.VPASS_API_BASE_URL!, // app API origin
  webBaseURL: process.env.VPASS_WEB_BASE_URL!, // member-site origin
  // Selected by the deployment; the provider supplies its verified OS/WebView profile.
  appVersion: process.env.VPASS_APP_VERSION!,
  loginId: process.env.VPASS_ID!,
  password: process.env.VPASS_PASSWORD!,
})

const provider = createProvider(profile)
const { items } = await provider.invoke('transactions.list', {
  from: '2026-06-01',
  to: '2026-08-31',
})

// Export immediately after login. If member calls run afterwards, export from
// the provider so any cookies updated by those calls are included.
const session = provider.exportSession()
```

## Auto-login

A successful login mints a token that stands in for the password. Persist the
whole session and resume with it:

```ts
import { resume } from '@mnie/provider-vpass'

const profile = await resume(savedSession)
const provider = createProvider(profile)
await store(provider.exportSession()) // the token rotates on every login
```

Two things must be carried across runs for this to work:

- **`token`** — rotates on each login, so always write back the exported session
  after connecting. Resuming with a stale token fails.
- **`deviceId`** — a UUID generated on first connect. It is part of the signed
  payload, so a new one on every run looks like a new device each time. Persist
  it alongside the token.

`deviceToken` is the app's FCM registration token. There is no way to mint one
outside a real Play-services install, so it defaults to empty. The live check
succeeded with that empty value and `push: false`.

## How authentication works

Credentials never cross the wire in the clear, and not in a form the member
website would accept either. The app wraps them in a hybrid envelope that this
package reimplements:

```
request : base64( iv[16] ‖ AES-128-CBC/PKCS#7(plaintext, k) ‖ RSA-OAEP-SHA256(k)[256] )
response: base64( iv[16] ‖ AES-128-CBC/PKCS#7(plaintext, k) ‖ RSA-PKCS#1(k)[256]      )
```

The AES key is fresh per request. On the way out it is sealed _to_ the issuer,
so a captured request cannot be read back without their private key. On the way
in the issuer encrypts the key with its private key and the client recovers it
with the public key — which is why `decryptPayload` needs nothing but the
bundled public key.

The plaintext is eight `|`-separated fields: identifier, password, device id
with a check digit, device token, an always-empty slot, card company code, unix
seconds, and a SHA-256 digest whose inputs are ordered differently for
credential and token logins.

The envelope, the key selection, and the field layout were recovered from
`EncryptedMethods`, `AesEncryption`, `RsaEncryption` and `BaseAuthAPI` — classes
that do not ship in the APK's DEX files, but AES-encrypted inside
`assets/fjcnwlye`. `VpassFucker/tooling/postprocess/decrypt_dexguard_asset.py`
in the sibling repo extracts them offline.

## Two APIs, one session

The app API (`/api/v3/…`) authenticates. Its login response also sets the
member-site session cookies, so the member-site API (`/memapi/jaxrs/…`) — where
statements actually live — works off the same jar with no second sign-on. That
is why `VpassClient` keeps one flat cookie jar across both origins.

Member-site calls carry `requestHash`, which is an Adler-32 of the request path.
It is a checksum, not a signature; no secret is involved.

## Operations

| Operation           | Source                                                   |
| ------------------- | -------------------------------------------------------- |
| `accounts.list`     | `multicard/get_multicard_data`                           |
| `transactions.list` | `web_meisai/web_meisai_top`, one call per billing period |
| `history.list`      | derived from `transactions.list`                         |

`balances.list` is deliberately absent. A VPass statement reports billing
information rather than a card balance; reporting one as the other would be
wrong. The current parser exposes statement rows but does not normalize billed
or unbilled totals.

Statements are addressed by **billing period**, not by date, and the two do not
line up. `transactions.list` widens the requested range by one billing month on
each side and then filters rows by usage date. Charges delayed by more than that
window may require a wider caller-supplied date range.

Rows carry no upstream identifier, so the observation policy is
`ordered-snapshot` with a fingerprint over date, merchant and amount. The
billing month is excluded from the fingerprint because a re-billed charge moves
between statements. Transaction ids also contain the returned statement period
and row index; duplicate suppression is reliable within repeated reads of the
same returned statement, but cross-period duplicates are not guaranteed to
collapse.

`accounts.list` can report multiple cards, but statement requests currently use
the authenticated/default card only. Per-card transaction selection is not yet
implemented.

## Verification status

Read this before trusting a failure.

**Verified against captured traffic:**

- the envelope layout, in both directions
- the response key (`assets/f2hKiZCtFQdbfuiVGduZ.pem`) and the PKCS#1 unwrap —
  a real `login_token` decrypts cleanly and yields the documented field layout
- `requestHash` reproduces the captured values exactly
- the statement and multicard response shapes

**Verified against the live service:**

- credential `Fauth` accepts the reconstructed request key, plaintext field
  order, digest inputs, envelope and flags
- authentication succeeds with an empty `deviceToken` and `push: false`
- the resulting cookies support card and latest-statement reads
- token login succeeds, rotates the token, and preserves a working member session

The successful check used app version `5.13.0`, Android 15, and the provider's
generic WebView request profile. FA/Vauth, push registration, per-card statements,
broad-history completeness, other deployment environments, and future service
compatibility remain unverified.

**Also worth knowing:** the member-site origin sits behind Akamai Bot Manager.
`VpassClient` detects an HTML challenge and reports it as such rather than
surfacing a JSON parse error, but it does not attempt to solve one.

## Configuration

Origins and `appVersion` are required options, never baked in — pass
`apiBaseURL` and `webBaseURL` as bare origins and select the app version in the
deployment. Both origins are validated to reject paths, queries and fragments.
The provider defaults to its verified Android 15/WebView request profile;
`osVersion` and `userAgent` remain optional overrides.

## Live verification script

From the repository root, set these in `.env` (Bun loads it automatically):

```dotenv
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

```sh
bun run verify:vpass
bun run verify:vpass --resume
bun run verify:vpass --help
```

The first command checks password login, card listing, latest-period transactions,
then token login and an authenticated session check. `--resume` loads the saved
session and checks cards and transactions without requiring the password. Neither
mode retries failed authentication. An empty statement is a successful read with
count zero; it does not establish that every transaction is present.

Mnie server/UI setup, registry session behavior, and the current Bitwarden Auth
Manager integration are documented in `docs/docs/providers/vpass.md`.

Sessions are saved atomically to `data/vpass/session.json` with mode `0600`,
immediately after each login so a later failure does not lose the rotated token.
The directory is gitignored. Do not share this file or run concurrent checks with
the same token. Set `VPASS_SESSION_FILE` to use another location. A default run
generates one device UUID and saves it in the session; `--resume` retains that
identity on later runs.

Set both `VPASS_VERIFY_FROM` and `VPASS_VERIFY_TO` (`YYYY-MM-DD`) to check a usage
date range. `--help` lists overrides for the ID kind, authentication endpoint,
device identity/token, OS version and User-Agent. In resume mode the saved device
and ID kind are used. Logs contain stage names, HTTP status/path and counts, excluding
credentials, cookies, tokens and transaction details. A failure exits with code 1;
provider errors omit raw messages and bodies because those may contain secrets.
