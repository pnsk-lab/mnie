import type {
  MnieOperation,
  MnieOperationRequest,
  MnieOperationResponse,
  MnieProfile,
} from '@repo/mnie-types'

export type { MnieProfile } from '@repo/mnie-types'

type Method = (...args: any[]) => any

/**
 * Converts a profile method into a high-level operation. Options are flattened
 * with `profile`, so `profile.account.positions.cash({ market: 'XTKS' })`
 * becomes `getCashPositions({ profile, market: 'XTKS' })`.
 */
const operation =
  <Operation extends MnieOperation, F extends Method>(
    _operation: Operation,
    select: (profile: MnieProfile) => F,
  ) =>
  (request: MnieOperationRequest<Operation>): MnieOperationResponse<Operation> => {
    const { profile, ...options } = request
    const method = select(profile) as (options?: unknown) => MnieOperationResponse<Operation>
    return method(Object.keys(options).length === 0 ? undefined : options)
  }

// Session and account
export const getSessionProfile = operation('session.profile', (profile) => profile.session.profile)
export const getAccountProfile = operation('account.profile', (profile) => profile.account.profile)
export const getBalance = operation(
  'account.assets.current',
  (profile) => profile.account.assets.current,
)
export const getBuyingPower = operation(
  'account.power.buyingPower',
  (profile) => profile.account.power.buyingPower,
)
export const getCollateralRatio = operation(
  'account.power.collateralRatio',
  (profile) => profile.account.power.collateralRatio,
)
export const getCashPositions = operation(
  'account.positions.cash',
  (profile) => profile.account.positions.cash,
)
export const getCashPositionDetails = operation(
  'account.positions.cashDetail',
  (profile) => profile.account.positions.cashDetail,
)
export const getCashPositionsForIssue = operation(
  'account.positions.cashForIssue',
  (profile) => profile.account.positions.cashForIssue,
)
export const getMarginPositions = operation(
  'account.positions.margin',
  (profile) => profile.account.positions.margin,
)
export const getMarginPositionDetails = operation(
  'account.positions.marginDetail',
  (profile) => profile.account.positions.marginDetail,
)
export const getMarginPositionsForIssue = operation(
  'account.positions.marginForIssue',
  (profile) => profile.account.positions.marginForIssue,
)
export const getMarginPositionSummaryForIssue = operation(
  'account.positions.marginSummaryForIssue',
  (profile) => profile.account.positions.marginSummaryForIssue,
)
export const getMarginPositionDetailsForIssue = operation(
  'account.positions.marginDetailsForIssue',
  (profile) => profile.account.positions.marginDetailsForIssue,
)
export const getCloseableMarginPositions = operation(
  'account.positions.closeableMargin',
  (profile) => profile.account.positions.closeableMargin,
)
export const getDeliverableMarginPositions = operation(
  'account.positions.deliverableMargin',
  (profile) => profile.account.positions.deliverableMargin,
)
export const getUnrealizedProfitLoss = operation(
  'account.profitLoss.unrealized',
  (profile) => profile.account.profitLoss.unrealized,
)

// Market data
export const searchIssues = operation(
  'market.issue.search',
  (profile) => profile.market.issue.search,
)
export const suggestIssues = operation(
  'market.issue.suggest',
  (profile) => profile.market.issue.suggest,
)
export const getAllowedPrices = operation(
  'market.issue.allowedPrices',
  (profile) => profile.market.issue.allowedPrices,
)
export const getIssueBoard = operation(
  'market.issue.board',
  (profile) => profile.market.issue.board,
)
export const pollIssueBoard = operation(
  'market.issue.pollBoard',
  (profile) => profile.market.issue.pollBoard,
)
export const getIssueChart = operation(
  'market.issue.chart',
  (profile) => profile.market.issue.chart,
)
export const getIssueOpenOrders = operation(
  'market.issue.openOrders',
  (profile) => profile.market.issue.openOrders,
)
export const getIssueTradingInfo = operation(
  'market.issue.tradingInfo',
  (profile) => profile.market.issue.tradingInfo,
)
export const getMajorMarketIndexes = operation(
  'market.index.major',
  (profile) => profile.market.index.major,
)
export const getMarketOverview = operation('market.overview', (profile) => profile.market.overview)
export const getMarketRankings = operation(
  'market.ranking.market',
  (profile) => profile.market.ranking.market,
)
export const getSectorRankings = operation(
  'market.ranking.sector',
  (profile) => profile.market.ranking.sector,
)
export const getSbiRankings = operation(
  'market.ranking.sbi',
  (profile) => profile.market.ranking.sbi,
)
export const getNews = operation('news.list', (profile) => profile.news.list)
export const getWatchlists = operation('watchlist.list', (profile) => profile.watchlist.list)

// Order inquiry
export const getTodayExecutions = operation(
  'orders.inquiry.executionsToday',
  (profile) => profile.orders.inquiry.executionsToday,
)
export const getOpenOrders = operation(
  'orders.inquiry.open',
  (profile) => profile.orders.inquiry.open,
)
export const getOrderDetail = operation(
  'orders.inquiry.detail',
  (profile) => profile.orders.inquiry.detail,
)
export const getTradeRecords = operation(
  'orders.inquiry.tradeRecords',
  (profile) => profile.orders.inquiry.tradeRecords,
)

// Cash orders
export const getCashOrderPreOrder = operation(
  'orders.cash.preOrder',
  (profile) => profile.orders.cash.preOrder,
)
export const estimateCashOrder = operation(
  'orders.cash.estimate',
  (profile) => profile.orders.cash.estimate,
)
export const placeCashOrder = operation('orders.cash.place', (profile) => profile.orders.cash.place)
export const estimateCashOrderCorrection = operation(
  'orders.cash.estimateCorrection',
  (profile) => profile.orders.cash.estimateCorrection,
)
export const estimateCashOrderCorrectionConfirmation = operation(
  'orders.cash.estimateCorrectionConfirm',
  (profile) => profile.orders.cash.estimateCorrectionConfirm,
)
export const placeCashOrderCorrection = operation(
  'orders.cash.placeCorrection',
  (profile) => profile.orders.cash.placeCorrection,
)
export const estimateCashOrderCancellation = operation(
  'orders.cash.estimateCancel',
  (profile) => profile.orders.cash.estimateCancel,
)
export const placeCashOrderCancellation = operation(
  'orders.cash.placeCancel',
  (profile) => profile.orders.cash.placeCancel,
)

// Margin orders and delivery
export const getMarginOpenPreOrder = operation(
  'orders.margin.preOrderOpen',
  (profile) => profile.orders.margin.preOrderOpen,
)
export const estimateMarginOpenOrder = operation(
  'orders.margin.estimateOpen',
  (profile) => profile.orders.margin.estimateOpen,
)
export const placeMarginOpenOrder = operation(
  'orders.margin.open',
  (profile) => profile.orders.margin.open,
)
export const getMarginClosePreOrder = operation(
  'orders.margin.preOrderClose',
  (profile) => profile.orders.margin.preOrderClose,
)
export const estimateMarginCloseOrder = operation(
  'orders.margin.estimateClose',
  (profile) => profile.orders.margin.estimateClose,
)
export const placeMarginCloseOrder = operation(
  'orders.margin.close',
  (profile) => profile.orders.margin.close,
)
export const estimateMarginCloseSummaryOrder = operation(
  'orders.margin.estimateCloseSummary',
  (profile) => profile.orders.margin.estimateCloseSummary,
)
export const placeMarginCloseSummaryOrder = operation(
  'orders.margin.closeSummary',
  (profile) => profile.orders.margin.closeSummary,
)
export const estimateMarginSummaryOrder = operation(
  'orders.margin.estimateSummary',
  (profile) => profile.orders.margin.estimateSummary,
)
export const placeMarginSummaryOrder = operation(
  'orders.margin.placeSummary',
  (profile) => profile.orders.margin.placeSummary,
)
export const getActualDeliveryPreOrder = operation(
  'orders.margin.preOrderActualDelivery',
  (profile) => profile.orders.margin.preOrderActualDelivery,
)
export const estimateActualDeliveryOrder = operation(
  'orders.margin.estimateActualDelivery',
  (profile) => profile.orders.margin.estimateActualDelivery,
)
export const placeActualDeliveryOrder = operation(
  'orders.margin.actualDelivery',
  (profile) => profile.orders.margin.actualDelivery,
)

// IFD, theme investment, and currency exchange orders
export const estimateIfdOrder = operation(
  'orders.ifd.estimate',
  (profile) => profile.orders.ifd.estimate,
)
export const placeIfdOrder = operation('orders.ifd.place', (profile) => profile.orders.ifd.place)
export const estimateIfdOrderCorrection = operation(
  'orders.ifd.estimateCorrection',
  (profile) => profile.orders.ifd.estimateCorrection,
)
export const placeIfdOrderCorrection = operation(
  'orders.ifd.placeCorrection',
  (profile) => profile.orders.ifd.placeCorrection,
)
export const estimateIfdOrderCancellation = operation(
  'orders.ifd.estimateCancel',
  (profile) => profile.orders.ifd.estimateCancel,
)
export const placeIfdOrderCancellation = operation(
  'orders.ifd.placeCancel',
  (profile) => profile.orders.ifd.placeCancel,
)
export const getThemeInvestmentPreOrder = operation(
  'orders.themeInvestment.list',
  (profile) => profile.orders.themeInvestment.list,
)
export const estimateThemeInvestmentOrder = operation(
  'orders.themeInvestment.estimate',
  (profile) => profile.orders.themeInvestment.estimate,
)
export const placeThemeInvestmentOrder = operation(
  'orders.themeInvestment.place',
  (profile) => profile.orders.themeInvestment.place,
)
export const getExchangeRate = operation(
  'orders.exchange.rate',
  (profile) => profile.orders.exchange.rate,
)
export const estimateExchangeOrder = operation(
  'orders.exchange.estimate',
  (profile) => profile.orders.exchange.estimate,
)
export const placeExchangeOrder = operation(
  'orders.exchange.place',
  (profile) => profile.orders.exchange.place,
)

export type * from '@repo/mnie-types'
