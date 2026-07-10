import type {
  AccountProfile,
  AccountAssetsValuations,
  AccountType,
  Board,
  BuyingPower,
  CashPositionList,
  ChartPeriod,
  DepositType,
  ExchangeAccountKind,
  ExchangeOrderPreview,
  ExchangeOrderReceipt,
  ExchangeOrderSide,
  ExchangeRateInfo,
  ExchangeSellMethod,
  ExchangeSpecificMethod,
  DomesticMarket,
  IssueCode,
  IssueChart,
  IssueSearchResult,
  MarginPositionList,
  MarginTradeSide,
  MarketCode,
  MarketIndex,
  NewsList,
  Order,
  OrderId,
  OrderKind,
  OrderList,
  OrderPreview,
  StockOrderPreOrder,
  OrderReceipt,
  OrderStatus,
  PositionId,
  ProfitLossSummary,
  Quote,
  Ranking,
  ThemeId,
  ThemeInvestmentList,
  TradeRecordList,
  TradeSide,
  Watchlist,
} from './types'

export interface PagingOptions {
  /** Start index for the result list. Defaults to the first item when omitted. */
  index?: number
  /** Maximum number of items to fetch. Uses the implementation default when omitted. */
  limit?: number
}

export interface DateRangeOptions {
  /** Start date for the inquiry range. */
  from?: string
  /** End date for the inquiry range. */
  to?: string
}

export interface IssueOptions {
  /** Issue code to request. */
  issueCode: IssueCode
  /** Market code to request. */
  market: MarketCode
}

export type MarketIssueBoardPollingOptions = IssueOptions & {
  /** Poll interval in seconds. Defaults to 5 seconds. */
  intervalSeconds?: number
  /** Stops the polling iterator when aborted. */
  signal?: AbortSignal
}

export type IssueChartOptions = IssueOptions & {
  /** Chart period. Defaults to daily candles. */
  period?: ChartPeriod
  /** Candle unit. Minute charts accept 1, 5, 10, or 15. Other periods use 1. */
  unit?: number
  /** Number of historical prices to request. Defaults to 120. */
  count?: number
}

export interface IssueSearchOptions {
  /** Search text, such as an issue code, name, or keyword. */
  query: string
  /** Market code to search. */
  market: MarketCode
  /** Maximum number of returned issues after client-side filtering. */
  limit?: number
}

export type CashPositionOptions = PagingOptions & {
  /** Filters cash positions by issue code. */
  issueCode?: IssueCode
  /** Filters cash positions by market code. */
  market?: MarketCode
  /** Filters cash positions by account type. */
  accountType?: AccountType
}

export type MarginPositionOptions = PagingOptions & {
  /** Filters margin positions by issue code. */
  issueCode?: IssueCode
  /** Filters margin positions by market code. */
  market?: MarketCode
  /** Filters margin positions by short or long side. */
  side?: MarginTradeSide
  /** Filters margin positions by account type. */
  accountType?: AccountType
}

export type OrderInquiryOptions = PagingOptions &
  DateRangeOptions & {
    /** Filters order inquiry results by issue code. */
    issueCode?: IssueCode
    /** Filters order inquiry results by market code. */
    market?: MarketCode
    /** Filters order inquiry results by order status. */
    status?: OrderStatus
  }

export interface OrderDetailOptions {
  /** Order number shown in order inquiry. */
  orderNumber?: string
  /** Order ID from order inquiry. For US stocks this is often `orderSubNo`. */
  orderId?: OrderId
  /** Issue code used to fetch the related security and quote details. */
  issueCode?: IssueCode
  /** Market code used to fetch the related security and quote details. */
  market: MarketCode
}

export type TradeRecordInquiryOptions = OrderInquiryOptions & {
  /** Filters trade records by account type. */
  accountType?: AccountType
}

export type BoardOptions = IssueOptions & {
  /** Account type used when requesting board-order information. */
  accountType?: AccountType
  /** Trading action used when requesting board-order information. */
  side?:
    | 'cashBuy'
    | 'cashSell'
    | 'marginOpen'
    | 'marginOpenBuy'
    | 'marginOpenSell'
    | 'marginClose'
    | 'marginCloseBuy'
    | 'marginCloseSell'
}

export interface StockOrderBaseOptions {
  /** Issue code to order. */
  issueCode: IssueCode
  /** Market code to order on. */
  market: MarketCode
  /** Previous market code sent with SOR orders. Defaults to the value returned at login. */
  sorLastMarket?: MarketCode
  /** Buy or sell side for the order. */
  side: TradeSide
  /** Account type used for the order. */
  accountType?: AccountType
  /** Order quantity. */
  quantity: number
  /** Deposit type used for the order. */
  depositType?: DepositType
  /** US stock settlement method. Defaults to yen settlement for foreign stock orders. */
  foreignStockSettlementMethod?: 'yen' | 'foreign'
}

export type CashOrderPriceCondition =
  | 'limit'
  | 'limitAtOpen'
  | 'limitAtClose'
  | 'limitIoc'
  | 'market'
  | 'marketAtOpen'
  | 'marketAtClose'
  | 'marketIoc'
  | 'funari'

export type CashOrderTerm = 'day' | 'week' | 'date'

export type CashOrderTriggerZone = 'above' | 'below'

export type CashOrderMethod = 'normal' | 'stop' | 'oco'

export interface StockOrderMarginPosition {
  /** Open trade date from the margin position record, in yyyyMMdd or yyyy-MM-dd format. */
  openTradeDate: string
  /** Open price from the margin position record. Raw strings are accepted to preserve APK values. */
  openPrice: number | string
  /** Quantity selected from the margin position record. */
  quantity: number | string
  /** Original new-trade date from the margin position record, in yyyyMMdd or yyyy-MM-dd format. */
  orgNewTradeDate: string
  /** Bargain market code from the margin position record. */
  bargainMarketCode: MarketCode
}

export type StandardCashOrderOptions = StockOrderBaseOptions & {
  /** Order price for limit and other price-based orders. */
  price?: number
  /** Order kind, such as market or limit. */
  kind?: Exclude<OrderKind, 's'>
  /** APK/MTS execution condition, such as 指値, 寄指, IOC成, or 不成. */
  priceCondition?: CashOrderPriceCondition
  /** Order validity. `date` requires `orderDate` in yyyyMMdd or yyyy-MM-dd format. */
  orderTerm?: CashOrderTerm
  /** Explicit validity date used when `orderTerm` is `date`. */
  orderDate?: string
  /** Special order method. `stop` sends SLO and `oco` sends OCO. */
  orderMethod?: CashOrderMethod
  /** Stop trigger direction used by stop/OCO orders. */
  triggerZone?: CashOrderTriggerZone
  /** Stop trigger price used by stop/OCO orders. */
  triggerPrice?: number
  /** Secondary execution condition used by OCO orders. */
  secondaryPriceCondition?: CashOrderPriceCondition
  /** Secondary order price used by OCO price-based conditions. */
  secondaryPrice?: number
  /** APK ippan margin payment-limit code returned by stock board/pre-order information. */
  ippanMarginPaymentLimit?: string
}

export type SKabuOrderOptions = StockOrderBaseOptions & {
  /** Places the cash order as an S-kabu order. S-kabu cannot specify a price. */
  kind: 's'
  /** APK pre-order market for the underlying issue. The live S-kabu order still sends `market: "STK"`. */
  preOrderMarket?: MarketCode
  /** S-kabu cannot specify a price. */
  price?: never
}

export type CashOrderOptions = StandardCashOrderOptions | SKabuOrderOptions

export type CashOrderPreOrderOptions = Pick<
  StockOrderBaseOptions,
  'issueCode' | 'market' | 'side' | 'accountType' | 'depositType'
> & {
  /** Requests the APK S-kabu pre-order route constraints for this issue. */
  kind?: 's'
  /** APK pre-order market for S-kabu checks. The live S-kabu order still sends `market: "STK"`. */
  preOrderMarket?: MarketCode
}

export type MarginOpenTradeType =
  | 'standard'
  | 'generalBuy'
  | 'generalSellShort'
  | 'generalSellInventoryLimited'
  | 'generalSellInventoryUnlimited'
  | 'day'
  | 'hyper'

export type MarginOpenOrderPreOrderOptions = Pick<
  StockOrderBaseOptions,
  'issueCode' | 'market' | 'side' | 'accountType' | 'depositType'
>

export type MarginOpenOrderOptions = StandardCashOrderOptions & {
  /** APK margin-open trade type. Required because the mobile payload has no safe default. */
  marginTradeType: MarginOpenTradeType
  /** APK ippan margin payment-limit code, when returned by board/pre-order information. */
  ippanMarginPaymentLimit?: string
}

export type MarginCloseTradeType = 'sixMonth' | 'noLimit' | 'oneDay' | 'fifteenDay'

export type MarginCloseOrderPreOrderOptions = Pick<
  StockOrderBaseOptions,
  'issueCode' | 'market' | 'side' | 'accountType' | 'depositType'
> & {
  /** APK margin-close trade type used by the mobile pre-order request. */
  marginCloseTradeType?: MarginCloseTradeType
}

export type MarginClosePositionOrder =
  | 'profitFirst'
  | 'lossFirst'
  | 'newestFirst'
  | 'oldestFirst'
  | 'specify'

export type ActualDeliveryKind = 'genbiki' | 'genwatashi'

export interface ActualDeliveryOrderOptions {
  /** Issue code to deliver. */
  issueCode: IssueCode
  /** Market code for the issue. */
  market: MarketCode
  /** Account type used for the order. */
  accountType?: AccountType
  /** Order quantity. */
  quantity: number
  /** Deposit type used for the order. */
  depositType?: DepositType
  /** Order price for price-based actual-delivery requests. */
  price?: number
  /** Actual-delivery action: `genbiki` for 現引, `genwatashi` for 現渡. */
  kind: ActualDeliveryKind
  /** Position ID to deliver. */
  positionId?: PositionId
  /** Margin position records selected for genbiki/genwatashi delivery. */
  marginPositions?: StockOrderMarginPosition[]
  /** APK ippan margin payment-limit code returned by stock board/pre-order information. */
  ippanMarginPaymentLimit?: string
}

export type ActualDeliveryOrderPreOrderOptions = Pick<
  ActualDeliveryOrderOptions,
  'issueCode' | 'market' | 'accountType' | 'depositType' | 'kind'
>

export type PlaceCashOrderOptions = CashOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live order. */
  allowTrading?: true
}

export type PlaceMarginOpenOrderOptions = MarginOpenOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live margin open order. */
  allowTrading?: true
}

export type PlaceActualDeliveryOrderOptions = ActualDeliveryOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live actual-delivery order. */
  allowTrading?: true
}

export interface OrderCorrectionOptions {
  /** Order number shown in order inquiry. Required by the mobile pre-correction route. */
  orderNumber?: string
  /** Order ID to correct. */
  orderId: OrderId
  /** Issue code from the pre-correction response. */
  issueCode?: IssueCode
  /** Market code from the pre-correction response. */
  market?: MarketCode
  /** Original trade ID code. */
  tradeId?: string
  /** Additional correction flag used by the mobile MTS route. */
  correctionType?: string
  /** Original order status code from the pre-correction response. */
  status?: string
  /** Original RBE order status code from the pre-correction response. */
  rbeOrderStatus?: string
  /** Display deposit type text from the original order. */
  depositTypeText?: string
  /** Primary order method for correction. */
  orderMethod?: CashOrderMethod
  /** Corrected primary execution condition. */
  priceCondition?: CashOrderPriceCondition
  /** Stop trigger direction for correction. */
  triggerZone?: CashOrderTriggerZone
  /** Stop trigger price for correction. */
  triggerPrice?: number
  /** Secondary/OCO execution condition for correction. */
  secondaryPriceCondition?: CashOrderPriceCondition
  /** Secondary/OCO price for correction. */
  secondaryPrice?: number
  /** IFD follow-up execution condition for IF/IFDOCO correction. */
  ifdPriceCondition?: CashOrderPriceCondition
  /** IFD follow-up price for IF/IFDOCO correction. */
  ifdPrice?: number
  /** IFD follow-up special order method for correction. */
  ifdOrderMethod?: CashOrderMethod
  /** IFD follow-up stop trigger direction for correction. */
  ifdTriggerZone?: CashOrderTriggerZone
  /** IFD follow-up stop trigger price for correction. */
  ifdTriggerPrice?: number
  /** IFD follow-up secondary/OCO execution condition for correction. */
  ifdSecondaryPriceCondition?: CashOrderPriceCondition
  /** IFD follow-up secondary/OCO price for correction. */
  ifdSecondaryPrice?: number
  /** Mobile correction control flag. Defaults to normal mobile value when omitted. */
  correctionControlFlag?: '1' | '2'
  /** Corrected order quantity. */
  quantity?: number
  /** Corrected order price. */
  price?: number
}

export type PlaceOrderCorrectionOptions = OrderCorrectionOptions & {
  /** Explicitly allows sending a live correction request. */
  allowTrading?: true
}

export interface OrderCancelOptions {
  /** Order number shown in order inquiry. */
  orderNumber: string
  /** Original order ID shown in order inquiry. */
  orderId?: OrderId
  /** Original issue code shown in order inquiry. */
  issueCode?: IssueCode
  /** Original market code shown in order inquiry. */
  market?: MarketCode
  /** Original trade ID code. Defaults to cash stock when omitted. */
  tradeId?: string
  /** Additional cancel flag used by the mobile MTS route. */
  cancelType?: string
}

export type PlaceOrderCancelOptions = OrderCancelOptions & {
  /** Trading password used by SBI to submit the cancellation. */
  tradePassword?: string
  /** Explicitly allows sending a live cancellation request. */
  allowTrading?: true
}

export interface ExchangeOrderOptions {
  /** Currency code, such as USD. */
  currencyCode: string
  /** Buy or sell the foreign currency. */
  side: ExchangeOrderSide
  /** Quantity entered on the SBI exchange order screen. */
  tradeQuantity: number | string
  /** `foreign` means foreign-currency quantity; `domestic` means yen amount. */
  specificMethod?: ExchangeSpecificMethod
  /** SBI account kind. Defaults to GENERAL. */
  accountKind?: ExchangeAccountKind
  /** Required for sell orders when using the exchange web flow. */
  sellMethod?: ExchangeSellMethod
  /** Hidden order amount posted to SBI. Defaults to tradeQuantity for foreign quantity orders. */
  orderAmount?: number | string
  /** Trading password used by SBI. Defaults to session tradePassword. */
  tradePassword?: string
}

export interface ExchangeRateOptions {
  /** Currency code, such as USD. */
  currencyCode: string
  /** Buy or sell the foreign currency. */
  side: ExchangeOrderSide
}

export type PlaceExchangeOrderOptions = ExchangeOrderOptions & {
  /** Explicitly allows sending a live exchange order. */
  allowTrading?: true
}

export type MarginCloseOrderOptions = StandardCashOrderOptions & {
  /** Position ID to close. */
  positionId?: PositionId
  /** APK margin-close trade type. Required because the mobile payload has no safe default. */
  marginCloseTradeType: MarginCloseTradeType
  /** Margin position records selected for specified close orders. */
  marginPositions?: StockOrderMarginPosition[]
  /** APK close-position ordering used by summary close orders. */
  marginClosePositionOrder?: MarginClosePositionOrder
}

export type PlaceMarginCloseOrderOptions = MarginCloseOrderOptions & {
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live margin close order. */
  allowTrading?: true
}

export type MarginCloseSummaryOrderOptions = MarginCloseOrderOptions

export type PlaceMarginCloseSummaryOrderOptions = MarginCloseSummaryOrderOptions & {
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live margin close summary order. */
  allowTrading?: true
}

export type IfdOrderOptions = StandardCashOrderOptions & {
  /** Product to use for the first IFD leg. Defaults to cash. */
  tradeType?: 'cash' | 'marginOpen'
  /** APK margin-open trade type for the first leg when `tradeType` is `marginOpen`. */
  marginTradeType?: MarginOpenTradeType
  /** APK ippan margin payment-limit code for the first leg. */
  ippanMarginPaymentLimit?: string
  /** Execution condition for the IFD follow-up leg. */
  ifdPriceCondition?: CashOrderPriceCondition
  /** Order price for the IFD follow-up leg. */
  ifdPrice?: number
  /** Validity for the IFD follow-up leg. */
  ifdOrderTerm?: CashOrderTerm
  /** Explicit validity date for the IFD follow-up leg. */
  ifdOrderDate?: string
  /** Special order method for the IFD follow-up leg. */
  ifdOrderMethod?: CashOrderMethod
  /** Stop trigger direction for the IFD follow-up leg. */
  ifdTriggerZone?: CashOrderTriggerZone
  /** Stop trigger price for the IFD follow-up leg. */
  ifdTriggerPrice?: number
  /** Secondary OCO execution condition for IFDOCO. */
  ifdSecondaryPriceCondition?: CashOrderPriceCondition
  /** Secondary OCO price for IFDOCO. */
  ifdSecondaryPrice?: number
}

export type PlaceIfdOrderOptions = IfdOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** APK confirmation-screen omission flag. Only valid for live submit calls. */
  omitConfirmation?: boolean
  /** Explicitly allows sending a live IFD order. */
  allowTrading?: true
}

export interface ThemeInvestmentOrderOptions {
  /** Theme ID for the theme investment order. */
  themeId: ThemeId
  /** Theme set year/month (`theme_set_yyyymm`) from the mobile APK handoff. */
  themeSetYyyymm: string
  /** Theme course (`theme_course`) from the mobile APK handoff. */
  themeCourse: number | string
  /** Buy or sell side for the order. */
  side: TradeSide
  /** Account/deposit type used for the theme investment order. */
  accountType?: AccountType
  /** Deposit type used for the theme investment order. */
  depositType?: DepositType
  /** Component stock orders selected by the mobile theme investment flow. */
  components: ThemeInvestmentOrderComponent[]
  /** Order amount for the theme investment order. */
  amount?: number
}

export interface ThemeInvestmentOrderComponent {
  /** Component stock issue code. */
  issueCode: IssueCode
  /** Component order quantity. */
  quantity: number | string
}

export interface ThemeInvestmentPreOrderComponent {
  /** Component stock issue code selected by the mobile theme investment flow. */
  issueCode: IssueCode
  /** Component order quantity from the mobile handoff, when already selected. */
  quantity?: number | string
}

export interface ThemeInvestmentPreOrderOptions {
  /** Theme ID for the theme investment order target. */
  themeId: ThemeId
  /** Theme name from the mobile theme investment flow, when available. */
  themeName?: string
  /** Exchange code used for all component stocks in the mobile pre-order call. */
  exchangeCode: MarketCode
  /** Component stocks selected by the mobile theme investment flow. */
  components: ThemeInvestmentPreOrderComponent[]
}

export type PlaceThemeInvestmentOrderOptions = ThemeInvestmentOrderOptions & {
  /** Explicitly allows sending a live theme investment order. */
  allowTrading?: true
}

export interface AccountPowerOptions {
  /** Fetches margin-account collateral details. Disable this for accounts without margin trading. */
  includeMarginAccount?: boolean
}

export interface ProfitLossOptions {
  /** Market to fetch profit/loss for. Omit for domestic cash/margin summary. */
  market?: MarketCode
}

export interface SbiClientMethodSession {
  /** Returns the current authenticated session profile. */
  profile(): Promise<AccountProfile>
}

export interface SbiClientMethodAccountPower {
  /** Fetches buying power, margin buying power, withdrawable amount, and related account power values. */
  buyingPower(options?: AccountPowerOptions): Promise<BuyingPower>
  /** Fetches the collateral ratio and related margin collateral details. */
  collateralRatio(options?: AccountPowerOptions): Promise<BuyingPower>
}

export interface SbiClientMethodAccountPositions {
  /** Fetches cash positions. */
  cash(options?: CashPositionOptions): Promise<CashPositionList>
  /** Fetches the alternate cash-position list used by the mobile app. */
  cashDetail(options?: CashPositionOptions): Promise<CashPositionList>
  /** Fetches cash positions for a specific issue. */
  cashForIssue(options: IssueOptions): Promise<CashPositionList>
  /** Fetches margin positions. */
  margin(options?: MarginPositionOptions): Promise<MarginPositionList>
  /** Fetches the alternate margin-position list used by the mobile app. */
  marginDetail(options?: MarginPositionOptions): Promise<MarginPositionList>
  /** Fetches margin positions for a specific issue. */
  marginForIssue(options: IssueOptions): Promise<MarginPositionList>
  /** Fetches margin positions for a specific issue aggregated by issue. */
  marginSummaryForIssue(options: IssueOptions): Promise<MarginPositionList>
  /** Fetches individual margin positions for a specific issue. */
  marginDetailsForIssue(options: IssueOptions): Promise<MarginPositionList>
  /** Fetches margin positions available for close orders. */
  closeableMargin(options: MarginPositionOptions): Promise<MarginPositionList>
  /** Fetches margin positions available for stock delivery. */
  deliverableMargin(options: MarginPositionOptions): Promise<MarginPositionList>
}

export interface SbiClientMethodAccountProfitLoss {
  /** Fetches the unrealized profit and loss summary for cash and margin positions. */
  unrealized(options?: ProfitLossOptions): Promise<ProfitLossSummary>
}

export interface SbiClientMethodAccountAssets {
  /** Fetches current My Assets valuations from the SBI main site. */
  current(): Promise<AccountAssetsValuations>
}

export interface SbiClientMethodAccount {
  /** Returns the current account profile. */
  profile(): Promise<AccountProfile>
  /** Methods for fetching My Assets values from the SBI main site. */
  assets: SbiClientMethodAccountAssets
  /** Methods for fetching buying power and collateral information. */
  power: SbiClientMethodAccountPower
  /** Methods for fetching cash and margin positions. */
  positions: SbiClientMethodAccountPositions
  /** Methods for fetching profit and loss information. */
  profitLoss: SbiClientMethodAccountProfitLoss
}

export interface SbiClientMethodMarketIssue {
  /** Searches domestic issues by code, name, or keyword. */
  search(options: IssueSearchOptions): Promise<IssueSearchResult>
  /** Fetches issue suggestions for partial input. */
  suggest(options: IssueSearchOptions): Promise<IssueSearchResult>
  /** Fetches prices accepted as order input for an issue. */
  allowedPrices(options: IssueOptions): Promise<Quote>
  /** Fetches board information for an issue. */
  board(options: IssueOptions): Promise<Board>
  /** Polls board information for an issue using the same endpoint as `board`. */
  pollBoard(options: MarketIssueBoardPollingOptions): AsyncIterableIterator<Board>
  /** Fetches historical chart prices for an issue. */
  chart(options: IssueChartOptions): Promise<IssueChart>
  /** Fetches open orders for an issue. */
  openOrders(options: IssueOptions): Promise<OrderList>
  /** Fetches board and issue information useful before placing an order. */
  tradingInfo(options: BoardOptions): Promise<Board>
}

export interface SbiClientMethodMarketIndex {
  /** Fetches major market indexes. */
  major(): Promise<MarketIndex[]>
}

export interface SbiClientMethodMarketRanking {
  /** Fetches market rankings. */
  market(): Promise<Ranking>
  /** Fetches sector rankings. */
  sector(): Promise<Ranking>
  /** Fetches SBI-provided rankings. */
  sbi(): Promise<Ranking>
}

export interface SbiClientMethodMarket {
  /** Methods for fetching issue quotes, boards, and order-related market information. */
  issue: SbiClientMethodMarketIssue
  /** Methods for fetching market index information. */
  index: SbiClientMethodMarketIndex
  /** Fetches the domestic market overview. */
  overview(): Promise<DomesticMarket>
  /** Methods for fetching ranking information. */
  ranking: SbiClientMethodMarketRanking
}

export interface SbiClientMethodNews {
  /** Fetches news items. */
  list(): Promise<NewsList>
}

export interface SbiClientMethodWatchlist {
  /** Fetches registered watchlists. */
  list(): Promise<Watchlist[]>
}

export interface SbiClientMethodOrderInquiry {
  /** Fetches orders executed today. */
  executionsToday(options?: OrderInquiryOptions): Promise<OrderList>
  /** Fetches open or recently active orders. */
  open(options?: OrderInquiryOptions): Promise<OrderList>
  /** Fetches a detailed order record. Currently implemented for US stock orders. */
  detail(options: OrderDetailOptions): Promise<Order>
  /** Fetches trade records. Currently implemented for US stock trades. */
  tradeRecords(options: TradeRecordInquiryOptions): Promise<TradeRecordList>
}

export interface SbiClientMethodCashOrder {
  /** Fetches APK cash pre-order information and selectable constraints. */
  preOrder(options: CashOrderPreOrderOptions): Promise<StockOrderPreOrder>
  /** Estimates a cash order without submitting a live order. */
  estimate(options: CashOrderOptions): Promise<OrderPreview>
  /** Places a live cash order. Requires `allowTrading: true`. */
  place(options: PlaceCashOrderOptions): Promise<OrderReceipt>
  /** Estimates a cash order correction without submitting a live correction. */
  estimateCorrection(options: OrderCorrectionOptions): Promise<OrderPreview>
  /** Estimates the mobile correction-confirmation route without submitting a live correction. */
  estimateCorrectionConfirm(options: OrderCorrectionOptions): Promise<OrderPreview>
  /** Places a live cash order correction. Requires `allowTrading: true`. */
  placeCorrection(options: PlaceOrderCorrectionOptions): Promise<OrderReceipt>
  /** Estimates a cash order cancellation without submitting a live cancellation. */
  estimateCancel(options: OrderCancelOptions): Promise<OrderPreview>
  /** Places a live cash order cancellation. Requires `allowTrading: true`. */
  placeCancel(options: PlaceOrderCancelOptions): Promise<OrderReceipt>
}

export interface SbiClientMethodMarginOrder {
  /** Fetches APK margin-open pre-order information and selectable constraints. */
  preOrderOpen(options: MarginOpenOrderPreOrderOptions): Promise<StockOrderPreOrder>
  /** Estimates a margin-open order without submitting a live order. */
  estimateOpen(options: MarginOpenOrderOptions): Promise<OrderPreview>
  /** Places a live margin-open order. Requires `allowTrading: true`. */
  open(options: PlaceMarginOpenOrderOptions): Promise<OrderReceipt>
  /** Fetches APK margin-close pre-order information and selectable constraints. */
  preOrderClose(options: MarginCloseOrderPreOrderOptions): Promise<StockOrderPreOrder>
  /** Estimates a margin close order without submitting a live order. */
  estimateClose(options: MarginCloseOrderOptions): Promise<OrderPreview>
  /** Places a live margin close order. Requires `allowTrading: true`. */
  close(options: PlaceMarginCloseOrderOptions): Promise<OrderReceipt>
  /** Estimates a margin close order by position summary without submitting a live order. */
  estimateCloseSummary(options: MarginCloseOrderOptions): Promise<OrderPreview>
  /** Places a live margin close order by position summary. Requires `allowTrading: true`. */
  closeSummary(options: PlaceMarginCloseOrderOptions): Promise<OrderReceipt>
  /** Estimates a mobile margin close summary order without submitting a live order. */
  estimateSummary(options: MarginCloseSummaryOrderOptions): Promise<OrderPreview>
  /** Places a mobile margin close summary order. Requires `allowTrading: true`. */
  placeSummary(options: PlaceMarginCloseSummaryOrderOptions): Promise<OrderReceipt>
  /** Fetches APK genbiki/genwatashi pre-order information and selectable constraints. */
  preOrderActualDelivery(options: ActualDeliveryOrderPreOrderOptions): Promise<StockOrderPreOrder>
  /** Estimates a genbiki/genwatashi actual-delivery order without submitting a live order. */
  estimateActualDelivery(options: ActualDeliveryOrderOptions): Promise<OrderPreview>
  /** Places a genbiki/genwatashi actual-delivery order. Requires `allowTrading: true`. */
  actualDelivery(options: PlaceActualDeliveryOrderOptions): Promise<OrderReceipt>
}

export interface SbiClientMethodIfdOrder {
  /** Estimates an IFD order without submitting a live order. */
  estimate(options: IfdOrderOptions): Promise<OrderPreview>
  /** Places a live IFD order. Requires `allowTrading: true`. */
  place(options: PlaceIfdOrderOptions): Promise<OrderReceipt>
  /** Estimates an IFD order correction without submitting a live correction. */
  estimateCorrection(options: OrderCorrectionOptions): Promise<OrderPreview>
  /** Places a live IFD order correction. Requires `allowTrading: true`. */
  placeCorrection(options: PlaceOrderCorrectionOptions): Promise<OrderReceipt>
  /** Estimates an IFD order cancellation without submitting a live cancellation. */
  estimateCancel(options: OrderCancelOptions): Promise<OrderPreview>
  /** Places a live IFD order cancellation. Requires `allowTrading: true`. */
  placeCancel(options: PlaceOrderCancelOptions): Promise<OrderReceipt>
}

export interface SbiClientMethodThemeInvestmentOrder {
  /** Fetches APK theme investment pre-order targets for selected component stocks. */
  list(options: ThemeInvestmentPreOrderOptions): Promise<ThemeInvestmentList>
  /** Estimates a theme investment order without submitting a live order. */
  estimate(options: ThemeInvestmentOrderOptions): Promise<OrderPreview>
  /** Places a live theme investment order. Requires `allowTrading: true`. */
  place(options: PlaceThemeInvestmentOrderOptions): Promise<OrderReceipt>
}

export interface SbiClientMethodExchangeOrder {
  /** Fetches the current exchange-order input rate and limits. */
  rate(options: ExchangeRateOptions): Promise<ExchangeRateInfo>
  /** Estimates an exchange order without submitting a live order. */
  estimate(options: ExchangeOrderOptions): Promise<ExchangeOrderPreview>
  /** Places a live exchange order. Requires `allowTrading: true`. */
  place(options: PlaceExchangeOrderOptions): Promise<ExchangeOrderReceipt>
}

export interface SbiClientMethodOrders {
  /** Methods for order inquiries. */
  inquiry: SbiClientMethodOrderInquiry
  /** Methods for estimating, placing, and correcting cash orders. */
  cash: SbiClientMethodCashOrder
  /** Methods for estimating and placing margin orders. */
  margin: SbiClientMethodMarginOrder
  /** Methods for estimating, placing, and correcting IFD orders. */
  ifd: SbiClientMethodIfdOrder
  /** Methods for estimating and placing theme investment orders. */
  themeInvestment: SbiClientMethodThemeInvestmentOrder
  /** Methods for estimating and placing exchange orders. */
  exchange: SbiClientMethodExchangeOrder
}

export interface SbiClientMethods {
  /** Session-related methods. */
  session: SbiClientMethodSession
  /** Methods for account profile, buying power, positions, and profit and loss. */
  account: SbiClientMethodAccount
  /** Methods for market overviews, issues, indexes, and rankings. */
  market: SbiClientMethodMarket
  /** News methods. */
  news: SbiClientMethodNews
  /** Watchlist methods. */
  watchlist: SbiClientMethodWatchlist
  /** Methods for order history, estimates, live placement, and corrections. */
  orders: SbiClientMethodOrders
}
