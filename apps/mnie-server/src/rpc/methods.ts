import type { SbiClientMethods } from '@mnie/provider-sbi-sec'

export const RPC_METHODS = [
  'session.profile',
  'account.profile',
  'account.assets.current',
  'account.power.buyingPower',
  'account.power.collateralRatio',
  'account.positions.cash',
  'account.positions.cashDetail',
  'account.positions.cashForIssue',
  'account.positions.margin',
  'account.positions.marginDetail',
  'account.positions.marginForIssue',
  'account.positions.marginSummaryForIssue',
  'account.positions.marginDetailsForIssue',
  'account.positions.closeableMargin',
  'account.positions.deliverableMargin',
  'account.profitLoss.unrealized',
  'market.issue.search',
  'market.issue.suggest',
  'market.issue.allowedPrices',
  'market.issue.board',
  'market.issue.chart',
  'market.issue.openOrders',
  'market.issue.tradingInfo',
  'market.index.major',
  'market.overview',
  'market.ranking.market',
  'market.ranking.sector',
  'market.ranking.sbi',
  'news.list',
  'watchlist.list',
  'orders.inquiry.detail',
  'orders.inquiry.executionsToday',
  'orders.inquiry.open',
  'orders.inquiry.tradeRecords',
  'orders.cash.preOrder',
  'orders.cash.estimate',
  'orders.cash.place',
  'orders.cash.estimateCorrection',
  'orders.cash.estimateCorrectionConfirm',
  'orders.cash.placeCorrection',
  'orders.cash.estimateCancel',
  'orders.cash.placeCancel',
  'orders.margin.preOrderOpen',
  'orders.margin.estimateOpen',
  'orders.margin.open',
  'orders.margin.preOrderClose',
  'orders.margin.estimateClose',
  'orders.margin.close',
  'orders.margin.estimateCloseSummary',
  'orders.margin.closeSummary',
  'orders.margin.estimateSummary',
  'orders.margin.placeSummary',
  'orders.margin.preOrderActualDelivery',
  'orders.margin.estimateActualDelivery',
  'orders.margin.actualDelivery',
  'orders.ifd.estimate',
  'orders.ifd.place',
  'orders.ifd.estimateCorrection',
  'orders.ifd.placeCorrection',
  'orders.ifd.estimateCancel',
  'orders.ifd.placeCancel',
  'orders.themeInvestment.list',
  'orders.themeInvestment.estimate',
  'orders.themeInvestment.place',
  'orders.exchange.rate',
  'orders.exchange.estimate',
  'orders.exchange.place',
] as const

export type RpcMethod = (typeof RPC_METHODS)[number]

const methodSet = new Set<string>(RPC_METHODS)
const tradingMethods = new Set<string>([
  'orders.cash.place',
  'orders.cash.placeCorrection',
  'orders.cash.placeCancel',
  'orders.margin.open',
  'orders.margin.close',
  'orders.margin.closeSummary',
  'orders.margin.placeSummary',
  'orders.margin.actualDelivery',
  'orders.ifd.place',
  'orders.ifd.placeCorrection',
  'orders.ifd.placeCancel',
  'orders.themeInvestment.place',
  'orders.exchange.place',
])

const cashOrderMethods = new Set<string>([
  'orders.cash.estimate',
  'orders.cash.place',
  'orders.cash.estimateCorrection',
  'orders.cash.estimateCorrectionConfirm',
  'orders.cash.placeCorrection',
  'orders.cash.estimateCancel',
  'orders.cash.placeCancel',
])

export const isRpcMethod = (method: string): method is RpcMethod => methodSet.has(method)

export const isTradingMethod = (method: string) => tradingMethods.has(method)

export const isCashOrderMethod = (method: string) => cashOrderMethods.has(method)

export const invokeSbiMethod = async (
  client: SbiClientMethods,
  method: RpcMethod,
  params: unknown,
) => {
  const target = method.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, client)

  if (typeof target !== 'function') throw new Error(`RPC method not callable: ${method}`)

  if (Array.isArray(params)) return target(...params)
  if (params === undefined || params === null) return target()
  return target(params)
}
