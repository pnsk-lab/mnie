## Rules

- Run `bun fmt` and `bun typecheck` before finishing.
- Do not hardcode real endpoint
  - origin のみ。パスは許可。

## Hints

- 技術的に不可能なことはできないと応答する。代わりに fallback を使ったりはしない。相談する。
- fallback は控える。エラーを積極的に出す。
- 実際の passkey.json を利用して、SDK を実際に実行して直ったか確認する
