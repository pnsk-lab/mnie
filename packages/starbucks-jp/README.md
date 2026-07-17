# @mnie/starbucks-jp

Starbucks Japan Light Web App の Node.js クライアントです。

```ts
import { createStarbucksJpClient } from '@mnie/starbucks-jp'

const client = createStarbucksJpClient({
  apiOrigin: process.env.STARBUCKS_API_ORIGIN!,
  loginOrigin: process.env.STARBUCKS_LOGIN_ORIGIN!,
  appOrigin: process.env.STARBUCKS_APP_ORIGIN!,
})

const authorization = await client.beginAuthorization('/redirect?pageRedirect=/card/sbcardinfo')
console.log(authorization.url) // Open this URL and authenticate.

// Pass the resulting callback URL to completeAuthorization.
const session = await client.completeAuthorization(authorization, callbackURL)
const cards = await session.listCards()
console.log(cards)
```

通常は `beginAuthorization()` で作った URL をブラウザまたは任意の OAuth クライアントで開き、
コールバック URL を `completeAuthorization()` に渡します。既存セッションは
`client.importSession({ sessionId })` で再利用できます。すべての origin はパス、クエリ、
フラグメントを含まない値を指定してください。

有効なログイン済み cookie（例: `BARISTA_REMEMBER_ME`）を安全に保持している場合は、ブラウザを
起動せず OAuth の redirect と code exchange まで実行できます。

```ts
const session = await client.loginWithCookies({
  cookies: { BARISTA_REMEMBER_ME: process.env.STARBUCKS_REMEMBER_COOKIE! },
})
```

cookie が無効な場合は `/login` で明示的にエラーになります。パスワードをHTTPフォームへ再送して
ログインを迂回するのではなく、`loginWithCredentials()` はログインページから取得した rotating
anti-bot bundle を QuickJS の隔離ブラウザ realm で処理し、6 個の `gQHuspkwZ2-{a,b,c,d,f,z}` hidden
input が揃った場合だけフォームを送信します。bundle の取得・実行に失敗した場合は stale script や空文字列で続行せず、明示的なエラーになります。
iOvation WDP runtime（または明示的な `deviceFingerprint`）が必須です。

```ts
import {
  createStarbucksIoBlackboxRuntimeFromLogin,
  createStarbucksJpClient,
} from '@mnie/starbucks-jp'

const ioBlackboxRuntime = await createStarbucksIoBlackboxRuntimeFromLogin(
  process.env.STARBUCKS_LOGIN_ORIGIN!,
)
const client = createStarbucksJpClient({
  apiOrigin: process.env.STARBUCKS_API_ORIGIN!,
  loginOrigin: process.env.STARBUCKS_LOGIN_ORIGIN!,
  appOrigin: process.env.STARBUCKS_APP_ORIGIN!,
  ioBlackboxRuntime,
})
const session = await client.loginWithCredentials({
  username: process.env.STARBUCKS_USER!,
  password: process.env.STARBUCKS_PASSWORD!,
})
```

`createStarbucksIoBlackboxRuntimeFromLogin()` は login origin の FP WDP と、static WDP が
静的に参照する remote TP WDP の両方を取得し、`IO;FP` の二つの `0400` blackbox を結合します。
remote origin は bundle 内の encoded literal から抽出し、SDK に実サービス origin を埋め込みません。
必要な場合だけ `fetchRemoteWdp: false` を明示して FP 単体にできます。
実ブラウザを渡さない場合は、`width`/`height`/`colorDepth`/`userAgent`/`language` とセッション固有の
`signals` を明示してください。生成値を分解して確認する場合は
`decodeStarbucksIoBlackboxes()` を使えます（戻り値は `[IOPlaintext, FPPlaintext]`）。

ログイン bundle は毎回取得した最新 source を QuickJS realm で実行して検証します。realm が要求する
未対応 API や WDP の取得失敗は明示的なエラーになり、古い HAR の script や空文字列への fallback は行いません。

## Anti-bot runtime (教育目的)

QuickJS の検証用 realm は `createStarbucksQuickJsBrowserRuntime()` で取得できます。これは
`navigator`、`location`、DOM、Event、form controls、タイマー、Blob/URL、canvas/WebGL の shim を
isolated realm に用意します。現在のログインページでは host fetch で取得した iOvation WDP と
動的 anti-bot bundle をこの realm で実行し、6 個の hidden input を生成できます。realm 内の任意の
network fetch、WebAssembly 実行、Worker 本体の実行は未接続なので、未対応 API は明示的にエラーに
なります。未生成の fingerprint や hidden input を空文字列で送信する fallback はありません。

`isolated-vm` に置き換えてもこの DOM/API bridge は必要です。さらに `isolated-vm` は Node の V8
native addon であり、この Bun パッケージから直接ロードできないため、使うなら Node sidecar と
realm bridge を別途用意する構成になります。現在の QuickJS realm は Bun 内で同じ処理を完結できる
ため、ログインページの検証にはこちらを使います。

runtime は本パッケージ内の TypeScript 製 DOM / Worker shim と `wasm-lite.ts` を使い、`happy-dom`、
Node の `vm`、`eval`、`new Function`、実行時の `WebAssembly.Module` には依存しません。KXZ の
handler、table、dispatcher、memory は loader が取得した本文から `acorn` で実行時に抽出し、
プロセス内の一時データとして VM に渡します。取得した vendor 本文や生成済みデータは配布物に含めません。

`createStarbucksKxzRuntime()` は取得した KXZ bundle の bootstrap literal を検証し、本文からその場で
抽出した契約を純粋な TypeScript VM に渡して `KXZ2x4Fzkp-{a,b,c,d,f,z}` の 6 header を生成します。
契約を抽出できない bundle は明示的なエラーになります。seed、origin、script version は loader から取得します。

`loginWithCredentials()` は login HTML に含まれる rotating inline bundle を QuickJS の隔離ブラウザ realm
で実行し、DOM、Worker、completion event、6 個の `gQHuspkwZ2-*` hidden input を生成します。
通常は app HTML から KXZ の `single → async → seed付き async` chain を取得します。取得した本文は
hash/bootstrap の検証と runtime の入力にだけ使います。loader は `src/anti-bot-loader.ts`、
runtime は `src/anti-bot.ts`、HAR の解析・保存は
`tools/analyze-starbucks-har.mjs` 以下に分離されています。

vendor script が更新されても起動ごとに本文から契約を再抽出します。未知の構造は古いデータへ
fallback せず、明示的なエラーになります。

現行（WASM-less）KXZ と login inline bundle の静的抽出器は、HAR を調査するときだけ使います。
runtime 用の生成済み TS データをリポジトリへ保存する必要はありません。

```bash
node tools/analyze-kxz-contract.mjs \
  /tmp/starbucks-static-analysis/kxz-main.js \
  /tmp/starbucks-static-analysis/kxz-instrumentation.js \
  /tmp/starbucks-static-analysis/kxz-bootstrap.js \
  /tmp/starbucks-kxz-contract
```

```ts
import { createStarbucksKxzRuntimeFromApp } from '@mnie/starbucks-jp'

const kxzRuntime = await createStarbucksKxzRuntimeFromApp(process.env.STARBUCKS_APP_ORIGIN!)
const client = createStarbucksJpClient({
  apiOrigin: process.env.STARBUCKS_API_ORIGIN!,
  loginOrigin: process.env.STARBUCKS_LOGIN_ORIGIN!,
  appOrigin: process.env.STARBUCKS_APP_ORIGIN!,
  kxzRuntime,
})
```

実ブラウザの realm を保持している場合は `createStarbucksKxzRuntime(..., {
browserEnvironment: window })` として渡せます。この場合 VM はその realm の Request/DOM/
Web API を読むため、shim の固定値ではなく実ブラウザの host telemetry を使います。realm がない
場合は TypeScript shim を使いますが、実ブラウザ固有値の byte-level 一致は保証されません。

iOvationのhidden input (`ioBlackBox`) と `X-SAPIG-DeviceFingerPrint` は、WDP の長さ接頭辞と
DES 暗号化プロトコルを TypeScript で生成します。`dyn_wdp.js` と `logo.js` の登録値は JavaScript を
評価せずに `parseStarbucksIoDynamicScript()` / `parseStarbucksIoLogoScript()` で抽出できます。
canvas/WebGL/audio、イベント列などブラウザ・セッション固有の値は自動生成せず、`signals` または
`dynamicFields` として明示的に渡す必要があります。未指定値を Node の値で偽装する fallback はありません。

```ts
import { createStarbucksIoBlackboxRuntime, getFingerPrintHeaders } from '@mnie/starbucks-jp'

const ioBlackboxRuntime = await createStarbucksIoBlackboxRuntime(
  await readFile(process.env.STARBUCKS_IOVATION_WDP!, 'utf8'),
  {
    pageURL: process.env.STARBUCKS_LOGIN_ORIGIN!,
    dynamicScript: await readFile(process.env.STARBUCKS_IOVATION_DYN_WDP!, 'utf8'),
    logoScript: await readFile(process.env.STARBUCKS_IOVATION_LOGO_JS!, 'utf8'),
    signals: {
      JSTOKEN: process.env.STARBUCKS_IO_JSTOKEN!,
      LSTOKEN: process.env.STARBUCKS_IO_LSTOKEN!,
    },
  },
)
const headers = await getFingerPrintHeaders({ ioBlackboxRuntime })
```

ブラウザまたは `browser-shim` の Window を使える場合は、canvas/WebGL/font の probe と
`mousemove`/`touch`/`key` 等のイベント列を vendor JavaScript を評価せずに収集できます。
runtime 作成時に `browserEnvironment` を渡すとイベント listener を先に登録します。CTOKEN と
dynamic token は別途 `signals`/`dynamicScript`/`logoScript` から渡します。

```ts
const ioBlackboxRuntime = await createStarbucksIoBlackboxRuntime(wdp, {
  pageURL: loginURL,
  dynamicScript: dynWdp,
  browserEnvironment: window,
})
```

クライアントに `ioBlackboxRuntime` を渡すと、各 proxy envelope の
`X-SAPIG-DeviceFingerPrint` に同じ値を自動で含めます。

WDPが収集できるブラウザ値は実行環境に依存します。動的 loader は更新された script を都度取得します。
静的解析で保存した script を使う場合は、HAR を再取得してください。Nodeランタイムだけで
呼び出した場合の `node-v1.*` 値は、実ブラウザ値の
代替ではなく、ローカル検証用に名前空間を分けた値です。

## 静的解析

静的解析は動的 runtime から分離しています。HAR から script 本文、HAR entry、サイズ、SHA-256
を保存するだけで、実行時には読み込まれません。

```bash
node tools/analyze-starbucks-har.mjs path/to/session.har /tmp/starbucks-static-analysis
```

このコマンドは KXZ 3本、iOvation static/dynamic/logo WDP、ログイン inline anti-bot script と
manifest を抽出します。WASM の抽出・デコンパイルも静的解析として実行できます。

```bash
node tools/extract-kxz-wasm.mjs path/to/anti-bot.js /tmp/starbucks-kxz-wasm
npm install --no-save wabt
WABT_MODULE=wabt node tools/decompile-kxz-wasm.mjs /tmp/starbucks-kxz-wasm
```

WASM を実行せずに、純粋 TS へ置き換えるための import/export 契約だけを抽出する場合は、次を使います。

```bash
node tools/analyze-kxz-contract.mjs \
  /tmp/starbucks-static-analysis/kxz-main.js \
  /tmp/starbucks-static-analysis/kxz-instrumentation.js \
  /tmp/starbucks-static-analysis/kxz-bootstrap.js \
  /tmp/starbucks-kxz-contract
```

出力される `kxz-contract.json` は、WASM を instantiate せずに 204 個の host callback、main の
export、instrumentation の `shouldHook` / `getEncodedData` / `chunk` 契約を記録します。これは
再実装用の静的資料であり、実行時の代替実装ではありません。

runtime 用のデータは `src/antibot-data.ts` が取得した本文から起動ごとに生成します。静的抽出器が出力する TS モジュールを
`src/` にコピーする運用は廃止しています。WASM の import/export や decompile 結果を調査するときだけ、
上記の分析ツールの出力を一時ディレクトリへ保存してください。
この機能はHARと公開ページの挙動を学習・検証するための教育目的です。認証情報や取得した
Cookieは保存・共有せず、実運用では対象サービスの利用規約と許可範囲を確認してください。
