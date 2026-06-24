# Mnie CLI Commands

## Help

```bash
mnie --help
```

## Profiles

Add a profile:

```bash
mnie profile add local \
  --origin http://127.0.0.1:8787 \
  --api-key mnie_xxx
```

List profiles:

```bash
mnie profile list
```

Use a profile as default:

```bash
mnie profile use local
```

`--origin` should be an origin only, such as `https://example.com` or `http://127.0.0.1:8787`.

## OAuth Login

```bash
mnie login \
  --origin http://127.0.0.1:8787 \
  --profile local
```

Optional flags:

- `--scopes "mcp read write trade"`
- `--storage file`
- `--storage keyring`

## RPC

List available RPC methods:

```bash
mnie rpc methods --profile local
```

All known RPC method paths:

```text
session.profile
account.profile
account.assets.current
account.power.buyingPower
account.power.collateralRatio
account.positions.cash
account.positions.cashDetail
account.positions.cashForIssue
account.positions.margin
account.positions.marginDetail
account.positions.marginForIssue
account.positions.marginSummaryForIssue
account.positions.marginDetailsForIssue
account.positions.closeableMargin
account.positions.deliverableMargin
account.profitLoss.unrealized
market.issue.search
market.issue.suggest
market.issue.allowedPrices
market.issue.board
market.issue.pollBoard
market.issue.chart
market.issue.openOrders
market.issue.tradingInfo
market.index.major
market.overview
market.ranking.market
market.ranking.sector
market.ranking.sbi
news.list
watchlist.list
orders.inquiry.executionsToday
orders.inquiry.open
orders.inquiry.detail
orders.inquiry.tradeRecords
orders.cash.preOrder
orders.cash.estimate
orders.cash.place
orders.cash.estimateCorrection
orders.cash.estimateCorrectionConfirm
orders.cash.placeCorrection
orders.cash.estimateCancel
orders.cash.placeCancel
orders.margin.preOrderOpen
orders.margin.estimateOpen
orders.margin.open
orders.margin.preOrderClose
orders.margin.estimateClose
orders.margin.close
orders.margin.estimateCloseSummary
orders.margin.closeSummary
orders.margin.estimateSummary
orders.margin.placeSummary
orders.margin.preOrderActualDelivery
orders.margin.estimateActualDelivery
orders.margin.actualDelivery
orders.ifd.estimate
orders.ifd.place
orders.ifd.estimateCorrection
orders.ifd.placeCorrection
orders.ifd.estimateCancel
orders.ifd.placeCancel
orders.themeInvestment.list
orders.themeInvestment.estimate
orders.themeInvestment.place
orders.exchange.rate
orders.exchange.estimate
orders.exchange.place
```

For per-method params and examples, see `rpc-methods.md`.

Call a method without params:

```bash
mnie rpc call account.profile \
  --profile local \
  --passkey-id sbi_xxx
```

Call a method with params:

```bash
mnie rpc call market.issue.board \
  '{"issueCode":"7203","market":"T"}' \
  --profile local \
  --passkey-id sbi_xxx
```

## Common Read-Only Calls

Account profile:

```bash
mnie rpc call account.profile --profile local --passkey-id sbi_xxx
```

Market board:

```bash
mnie rpc call market.issue.board \
  '{"issueCode":"7203","market":"T"}' \
  --profile local \
  --passkey-id sbi_xxx
```

Open orders:

```bash
mnie rpc call orders.inquiry.open \
  '{"market":"T"}' \
  --profile local \
  --passkey-id sbi_xxx
```

## Trading Calls

Only use live placement/cancellation/correction methods after explicit user confirmation. Include `allowTrading: true` only for confirmed live submission.
