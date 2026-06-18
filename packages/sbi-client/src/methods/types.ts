import type {
  AccountProfile,
  AccountType,
  Board,
  BuyingPower,
  CashPositionList,
  ChartPeriod,
  DepositType,
  DomesticMarket,
  IssueCode,
  IssueChart,
  IssueSearchResult,
  MarginPositionList,
  MarginTradeSide,
  MarketCode,
  MarketIndex,
  NewsList,
  OrderId,
  OrderKind,
  OrderList,
  OrderPreview,
  OrderReceipt,
  OrderStatus,
  PositionId,
  ProfitLossSummary,
  Quote,
  Ranking,
  ThemeId,
  ThemeInvestmentList,
  TradeSide,
  Watchlist,
} from '../types'

export type PagingOptions = {
  /** Start index for the result list. Defaults to the first item when omitted. */
  index?: number
  /** Maximum number of items to fetch. Uses the implementation default when omitted. */
  limit?: number
}

export type DateRangeOptions = {
  /** Start date for the inquiry range. */
  from?: string
  /** End date for the inquiry range. */
  to?: string
}

export type IssueOptions = {
  /** Issue code to request. */
  issueCode: IssueCode
  /** Market code to request. */
  market?: MarketCode
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

export type IssueSearchOptions = {
  /** Search text, such as an issue code, name, or keyword. */
  query: string
  /** Filters returned issues by market code on the client side. */
  market?: MarketCode
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

export type StockOrderBaseOptions = {
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
}

export type SKabuOrderOptions = StockOrderBaseOptions & {
  /** Places the cash order as an S-kabu order. S-kabu cannot specify a price. */
  kind: 's'
  /** S-kabu cannot specify a price. */
  price?: never
}

export type CashOrderOptions = StandardCashOrderOptions | SKabuOrderOptions

export type MarginOpenOrderOptions = StandardCashOrderOptions

export type ActualDeliveryKind = 'genbiki' | 'genwatashi'

export type ActualDeliveryOrderOptions = {
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
}

export type PlaceCashOrderOptions = CashOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** Explicitly allows sending a live order. */
  allowTrading?: true
}

export type PlaceMarginOpenOrderOptions = MarginOpenOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** Explicitly allows sending a live margin open order. */
  allowTrading?: true
}

export type PlaceActualDeliveryOrderOptions = ActualDeliveryOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** Explicitly allows sending a live actual-delivery order. */
  allowTrading?: true
}

export type OrderCorrectionOptions = {
  /** Order ID to correct. */
  orderId: OrderId
  /** Corrected order quantity. */
  quantity?: number
  /** Corrected order price. */
  price?: number
}

export type PlaceOrderCorrectionOptions = OrderCorrectionOptions & {
  /** Explicitly allows sending a live correction request. */
  allowTrading?: true
}

export type OrderCancelOptions = {
  /** Order number shown in order inquiry. */
  orderNumber: string
  /** Original order ID shown in order inquiry. */
  orderId?: OrderId
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

export type MarginCloseOrderOptions = StandardCashOrderOptions & {
  /** Position ID to close. */
  positionId?: PositionId
}

export type PlaceMarginCloseOrderOptions = MarginCloseOrderOptions & {
  /** Explicitly allows sending a live margin close order. */
  allowTrading?: true
}

export type MarginCloseSummaryOrderOptions = MarginCloseOrderOptions

export type PlaceMarginCloseSummaryOrderOptions = MarginCloseSummaryOrderOptions & {
  /** Explicitly allows sending a live margin close summary order. */
  allowTrading?: true
}

export type IfdOrderOptions = StandardCashOrderOptions & {
  /** Product to use for the first IFD leg. Defaults to cash. */
  tradeType?: 'cash' | 'marginOpen'
}

export type PlaceIfdOrderOptions = IfdOrderOptions & {
  /** Confirmation ID returned by the confirmation step. */
  confirmationId?: string
  /** Explicitly allows sending a live IFD order. */
  allowTrading?: true
}

export type ThemeInvestmentOrderOptions = {
  /** Theme ID for the theme investment order. */
  themeId: ThemeId
  /** Buy or sell side for the order. */
  side: TradeSide
  /** Order amount for the theme investment order. */
  amount?: number
}

export type PlaceThemeInvestmentOrderOptions = ThemeInvestmentOrderOptions & {
  /** Explicitly allows sending a live theme investment order. */
  allowTrading?: true
}

export type AccountPowerOptions = {
  /** Fetches margin-account collateral details. Disable this for accounts without margin trading. */
  includeMarginAccount?: boolean
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
  unrealized(): Promise<ProfitLossSummary>
}

export interface SbiClientMethodAccount {
  /** Returns the current account profile. */
  profile(): Promise<AccountProfile>
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
}

export interface SbiClientMethodCashOrder {
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
  /** Estimates a margin-open order without submitting a live order. */
  estimateOpen(options: MarginOpenOrderOptions): Promise<OrderPreview>
  /** Places a live margin-open order. Requires `allowTrading: true`. */
  open(options: PlaceMarginOpenOrderOptions): Promise<OrderReceipt>
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
  estimateCancel(options: OrderCorrectionOptions): Promise<OrderPreview>
  /** Places a live IFD order cancellation. Requires `allowTrading: true`. */
  placeCancel(options: PlaceOrderCorrectionOptions): Promise<OrderReceipt>
}

export interface SbiClientMethodThemeInvestmentOrder {
  /** Fetches theme investment holdings or order targets. */
  list(): Promise<ThemeInvestmentList>
  /** Estimates a theme investment order without submitting a live order. */
  estimate(options: ThemeInvestmentOrderOptions): Promise<OrderPreview>
  /** Places a live theme investment order. Requires `allowTrading: true`. */
  place(options: PlaceThemeInvestmentOrderOptions): Promise<OrderReceipt>
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
