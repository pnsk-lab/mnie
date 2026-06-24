# RPC Method Usage

Use this shape:

```bash
mnie rpc call <method> '<json-params>' --profile <profile> --passkey-id <passkey-id>
```

Omit `'<json-params>'` for methods with no params. Keep identifiers such as `issueCode`, `orderNumber`, `orderId`, and `passkey-id` as strings.

## Input And Output Types

`none` means omit the JSON params argument. A trailing `?` means the params object is optional.

| Method                                    | Input                                 | Output                         |
| ----------------------------------------- | ------------------------------------- | ------------------------------ |
| `session.profile`                         | none                                  | `AccountProfile`               |
| `account.profile`                         | none                                  | `AccountProfile`               |
| `account.assets.current`                  | none                                  | `AccountAssetsValuations`      |
| `account.power.buyingPower`               | `AccountPowerOptions?`                | `BuyingPower`                  |
| `account.power.collateralRatio`           | `AccountPowerOptions?`                | `BuyingPower`                  |
| `account.positions.cash`                  | `CashPositionOptions?`                | `CashPositionList`             |
| `account.positions.cashDetail`            | `CashPositionOptions?`                | `CashPositionList`             |
| `account.positions.cashForIssue`          | `IssueOptions`                        | `CashPositionList`             |
| `account.positions.margin`                | `MarginPositionOptions?`              | `MarginPositionList`           |
| `account.positions.marginDetail`          | `MarginPositionOptions?`              | `MarginPositionList`           |
| `account.positions.marginForIssue`        | `IssueOptions`                        | `MarginPositionList`           |
| `account.positions.marginSummaryForIssue` | `IssueOptions`                        | `MarginPositionList`           |
| `account.positions.marginDetailsForIssue` | `IssueOptions`                        | `MarginPositionList`           |
| `account.positions.closeableMargin`       | `MarginPositionOptions`               | `MarginPositionList`           |
| `account.positions.deliverableMargin`     | `MarginPositionOptions`               | `MarginPositionList`           |
| `account.profitLoss.unrealized`           | `ProfitLossOptions?`                  | `ProfitLossSummary`            |
| `market.issue.search`                     | `IssueSearchOptions`                  | `IssueSearchResult`            |
| `market.issue.suggest`                    | `IssueSearchOptions`                  | `IssueSearchResult`            |
| `market.issue.allowedPrices`              | `IssueOptions`                        | `Quote`                        |
| `market.issue.board`                      | `IssueOptions`                        | `Board`                        |
| `market.issue.pollBoard`                  | `MarketIssueBoardPollingOptions`      | `AsyncIterableIterator<Board>` |
| `market.issue.chart`                      | `IssueChartOptions`                   | `IssueChart`                   |
| `market.issue.openOrders`                 | `IssueOptions`                        | `OrderList`                    |
| `market.issue.tradingInfo`                | `BoardOptions`                        | `Board`                        |
| `market.index.major`                      | none                                  | `MarketIndex[]`                |
| `market.overview`                         | none                                  | `DomesticMarket`               |
| `market.ranking.market`                   | none                                  | `Ranking`                      |
| `market.ranking.sector`                   | none                                  | `Ranking`                      |
| `market.ranking.sbi`                      | none                                  | `Ranking`                      |
| `news.list`                               | none                                  | `NewsList`                     |
| `watchlist.list`                          | none                                  | `Watchlist[]`                  |
| `orders.inquiry.executionsToday`          | `OrderInquiryOptions?`                | `OrderList`                    |
| `orders.inquiry.open`                     | `OrderInquiryOptions?`                | `OrderList`                    |
| `orders.inquiry.detail`                   | `OrderDetailOptions`                  | `Order`                        |
| `orders.inquiry.tradeRecords`             | `TradeRecordInquiryOptions`           | `TradeRecordList`              |
| `orders.cash.preOrder`                    | `CashOrderPreOrderOptions`            | `StockOrderPreOrder`           |
| `orders.cash.estimate`                    | `CashOrderOptions`                    | `OrderPreview`                 |
| `orders.cash.place`                       | `PlaceCashOrderOptions`               | `OrderReceipt`                 |
| `orders.cash.estimateCorrection`          | `OrderCorrectionOptions`              | `OrderPreview`                 |
| `orders.cash.estimateCorrectionConfirm`   | `OrderCorrectionOptions`              | `OrderPreview`                 |
| `orders.cash.placeCorrection`             | `PlaceOrderCorrectionOptions`         | `OrderReceipt`                 |
| `orders.cash.estimateCancel`              | `OrderCancelOptions`                  | `OrderPreview`                 |
| `orders.cash.placeCancel`                 | `PlaceOrderCancelOptions`             | `OrderReceipt`                 |
| `orders.margin.preOrderOpen`              | `MarginOpenOrderPreOrderOptions`      | `StockOrderPreOrder`           |
| `orders.margin.estimateOpen`              | `MarginOpenOrderOptions`              | `OrderPreview`                 |
| `orders.margin.open`                      | `PlaceMarginOpenOrderOptions`         | `OrderReceipt`                 |
| `orders.margin.preOrderClose`             | `MarginCloseOrderPreOrderOptions`     | `StockOrderPreOrder`           |
| `orders.margin.estimateClose`             | `MarginCloseOrderOptions`             | `OrderPreview`                 |
| `orders.margin.close`                     | `PlaceMarginCloseOrderOptions`        | `OrderReceipt`                 |
| `orders.margin.estimateCloseSummary`      | `MarginCloseOrderOptions`             | `OrderPreview`                 |
| `orders.margin.closeSummary`              | `PlaceMarginCloseOrderOptions`        | `OrderReceipt`                 |
| `orders.margin.estimateSummary`           | `MarginCloseSummaryOrderOptions`      | `OrderPreview`                 |
| `orders.margin.placeSummary`              | `PlaceMarginCloseSummaryOrderOptions` | `OrderReceipt`                 |
| `orders.margin.preOrderActualDelivery`    | `ActualDeliveryOrderPreOrderOptions`  | `StockOrderPreOrder`           |
| `orders.margin.estimateActualDelivery`    | `ActualDeliveryOrderOptions`          | `OrderPreview`                 |
| `orders.margin.actualDelivery`            | `PlaceActualDeliveryOrderOptions`     | `OrderReceipt`                 |
| `orders.ifd.estimate`                     | `IfdOrderOptions`                     | `OrderPreview`                 |
| `orders.ifd.place`                        | `PlaceIfdOrderOptions`                | `OrderReceipt`                 |
| `orders.ifd.estimateCorrection`           | `OrderCorrectionOptions`              | `OrderPreview`                 |
| `orders.ifd.placeCorrection`              | `PlaceOrderCorrectionOptions`         | `OrderReceipt`                 |
| `orders.ifd.estimateCancel`               | `OrderCancelOptions`                  | `OrderPreview`                 |
| `orders.ifd.placeCancel`                  | `PlaceOrderCancelOptions`             | `OrderReceipt`                 |
| `orders.themeInvestment.list`             | `ThemeInvestmentPreOrderOptions`      | `ThemeInvestmentList`          |
| `orders.themeInvestment.estimate`         | `ThemeInvestmentOrderOptions`         | `OrderPreview`                 |
| `orders.themeInvestment.place`            | `PlaceThemeInvestmentOrderOptions`    | `OrderReceipt`                 |
| `orders.exchange.rate`                    | `ExchangeRateOptions`                 | `ExchangeRateInfo`             |
| `orders.exchange.estimate`                | `ExchangeOrderOptions`                | `ExchangeOrderPreview`         |
| `orders.exchange.place`                   | `PlaceExchangeOrderOptions`           | `ExchangeOrderReceipt`         |

## Common Input Shapes

These are the most common params objects agents need to construct. For exact field definitions, inspect the SDK/type reference that ships with the target environment.

```ts
type PagingOptions = { index?: number; limit?: number }
type DateRangeOptions = { from?: string; to?: string }
type IssueOptions = { issueCode: string; market: MarketCode }
type IssueSearchOptions = { query: string; market: MarketCode; limit?: number }
type AccountPowerOptions = { includeMarginAccount?: boolean }
type ProfitLossOptions = { market?: MarketCode }
type CashPositionOptions = PagingOptions & {
  issueCode?: string
  market?: MarketCode
  accountType?: AccountType
}
type MarginPositionOptions = PagingOptions & {
  issueCode?: string
  market?: MarketCode
  side?: MarginTradeSide
  accountType?: AccountType
}
type OrderInquiryOptions = PagingOptions &
  DateRangeOptions & {
    issueCode?: string
    market?: MarketCode
    status?: OrderStatus
  }
type OrderDetailOptions = {
  orderNumber?: string
  orderId?: string
  issueCode?: string
  market: MarketCode
}
type TradeRecordInquiryOptions = OrderInquiryOptions & {
  accountType?: AccountType
}
```

Order option types are intentionally broad. Prefer pre-order and estimate methods first; use the resulting constraints to fill live order payloads.

## Session

```bash
mnie rpc call session.profile --profile local --passkey-id sbi_xxx
```

## Account

```bash
mnie rpc call account.profile --profile local --passkey-id sbi_xxx
mnie rpc call account.assets.current --profile local --passkey-id sbi_xxx
mnie rpc call account.power.buyingPower '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.power.collateralRatio '{"includeMarginAccount":true}' --profile local --passkey-id sbi_xxx
```

Positions:

```bash
mnie rpc call account.positions.cash '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.cashDetail '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.cashForIssue '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.margin '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.marginDetail '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.marginForIssue '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.marginSummaryForIssue '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.marginDetailsForIssue '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.closeableMargin '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call account.positions.deliverableMargin '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
```

Profit and loss:

```bash
mnie rpc call account.profitLoss.unrealized '{}' --profile local --passkey-id sbi_xxx
mnie rpc call account.profitLoss.unrealized '{"market":"T"}' --profile local --passkey-id sbi_xxx
```

Common optional filters for list-style account calls:

```json
{ "index": 0, "limit": 100, "issueCode": "7203", "market": "T", "accountType": "specific" }
```

## Market

Issue search and quotes:

```bash
mnie rpc call market.issue.search '{"query":"7203","market":"T","limit":10}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.suggest '{"query":"トヨタ","market":"T","limit":10}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.allowedPrices '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.board '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.chart '{"issueCode":"7203","market":"T","period":"day","count":120}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.openOrders '{"issueCode":"7203","market":"T"}' --profile local --passkey-id sbi_xxx
mnie rpc call market.issue.tradingInfo '{"issueCode":"7203","market":"T","side":"cashBuy"}' --profile local --passkey-id sbi_xxx
```

`market.issue.pollBoard` is a polling/iterator method. Prefer `market.issue.board` for one-shot CLI output unless `mnie rpc call market.issue.pollBoard ...` is known to serialize streaming results in the target environment.

Indexes, overview, rankings:

```bash
mnie rpc call market.index.major --profile local --passkey-id sbi_xxx
mnie rpc call market.overview --profile local --passkey-id sbi_xxx
mnie rpc call market.ranking.market --profile local --passkey-id sbi_xxx
mnie rpc call market.ranking.sector --profile local --passkey-id sbi_xxx
mnie rpc call market.ranking.sbi --profile local --passkey-id sbi_xxx
```

## News And Watchlist

```bash
mnie rpc call news.list --profile local --passkey-id sbi_xxx
mnie rpc call watchlist.list --profile local --passkey-id sbi_xxx
```

## Order Inquiry

```bash
mnie rpc call orders.inquiry.executionsToday '{}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.inquiry.open '{}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.inquiry.detail '{"orderNumber":"123456","orderId":"abcdef","issueCode":"AAPL","market":"NASDAQ"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.inquiry.tradeRecords '{"from":"2026-01-01","to":"2026-01-31","market":"NASDAQ","accountType":"specific"}' --profile local --passkey-id sbi_xxx
```

Common inquiry filters:

```json
{
  "index": 0,
  "limit": 100,
  "from": "2026-01-01",
  "to": "2026-01-31",
  "issueCode": "7203",
  "market": "T",
  "status": "open"
}
```

## Cash Orders

Pre-order and estimate are non-submitting:

```bash
mnie rpc call orders.cash.preOrder '{"issueCode":"7203","market":"T","side":"buy","accountType":"specific"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.estimate '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.estimateCorrection '{"orderNumber":"123456","orderId":"abcdef","market":"T","quantity":100,"price":2500}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.estimateCorrectionConfirm '{"orderNumber":"123456","orderId":"abcdef","market":"T","quantity":100,"price":2500}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.estimateCancel '{"orderNumber":"123456","orderId":"abcdef"}' --profile local --passkey-id sbi_xxx
```

Live cash order actions require explicit user confirmation and `allowTrading:true`:

```bash
mnie rpc call orders.cash.place '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.placeCorrection '{"orderNumber":"123456","orderId":"abcdef","market":"T","quantity":100,"price":2500,"allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.cash.placeCancel '{"orderNumber":"123456","orderId":"abcdef","allowTrading":true}' --profile local --passkey-id sbi_xxx
```

## Margin Orders

Pre-order and estimate are non-submitting:

```bash
mnie rpc call orders.margin.preOrderOpen '{"issueCode":"7203","market":"T","side":"buy","accountType":"specific"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.estimateOpen '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market","marginTradeType":"standard"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.preOrderClose '{"issueCode":"7203","market":"T","side":"sell","accountType":"specific"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.estimateClose '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market","marginCloseTradeType":"standard"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.estimateCloseSummary '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.estimateSummary '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.preOrderActualDelivery '{"issueCode":"7203","market":"T","side":"sell","accountType":"specific"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.estimateActualDelivery '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific"}' --profile local --passkey-id sbi_xxx
```

Live margin actions require explicit user confirmation and `allowTrading:true`:

```bash
mnie rpc call orders.margin.open '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market","marginTradeType":"standard","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.close '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market","marginCloseTradeType":"standard","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.closeSummary '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.placeSummary '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","kind":"market","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.margin.actualDelivery '{"issueCode":"7203","market":"T","side":"sell","quantity":100,"accountType":"specific","allowTrading":true}' --profile local --passkey-id sbi_xxx
```

## IFD Orders

Estimate and cancellation estimate are non-submitting:

```bash
mnie rpc call orders.ifd.estimate '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.ifd.estimateCorrection '{"orderNumber":"123456","orderId":"abcdef","market":"T","quantity":100,"price":2500}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.ifd.estimateCancel '{"orderNumber":"123456","orderId":"abcdef"}' --profile local --passkey-id sbi_xxx
```

Live IFD actions require explicit user confirmation and `allowTrading:true`:

```bash
mnie rpc call orders.ifd.place '{"issueCode":"7203","market":"T","side":"buy","quantity":100,"accountType":"specific","kind":"market","allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.ifd.placeCorrection '{"orderNumber":"123456","orderId":"abcdef","market":"T","quantity":100,"price":2500,"allowTrading":true}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.ifd.placeCancel '{"orderNumber":"123456","orderId":"abcdef","allowTrading":true}' --profile local --passkey-id sbi_xxx
```

## Theme Investment Orders

```bash
mnie rpc call orders.themeInvestment.list '{"themeId":"theme_xxx"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.themeInvestment.estimate '{"themeId":"theme_xxx","side":"buy","accountType":"specific","orderAmount":10000}' --profile local --passkey-id sbi_xxx
```

Live theme investment placement requires explicit user confirmation and `allowTrading:true`:

```bash
mnie rpc call orders.themeInvestment.place '{"themeId":"theme_xxx","side":"buy","accountType":"specific","orderAmount":10000,"allowTrading":true}' --profile local --passkey-id sbi_xxx
```

## Exchange Orders

Rate and estimate are non-submitting:

```bash
mnie rpc call orders.exchange.rate '{"side":"buy","currency":"USD"}' --profile local --passkey-id sbi_xxx
mnie rpc call orders.exchange.estimate '{"side":"buy","currency":"USD","quantity":100,"accountKind":"GENERAL"}' --profile local --passkey-id sbi_xxx
```

Live exchange placement requires explicit user confirmation and `allowTrading:true`:

```bash
mnie rpc call orders.exchange.place '{"side":"buy","currency":"USD","quantity":100,"accountKind":"GENERAL","allowTrading":true}' --profile local --passkey-id sbi_xxx
```

## Notes For Agents

- Use `mnie rpc methods --profile <profile>` when the installed server may expose a different method set.
- Use the examples as shapes, not guaranteed complete order payloads. If an order method rejects params, inspect the error and ask for the missing order-specific fields rather than guessing.
- Prefer `estimate*` and `preOrder*` methods before any `place*`, `open`, `close`, `actualDelivery`, or `placeCancel` method.
