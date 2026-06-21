import { Hono } from 'hono'
import type { Context } from 'hono'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { eq } from 'drizzle-orm'
import * as z from 'zod/v4'
import type { AppBindings, AuthContext } from '../context'
import { sbiPasskeys } from '../db/schema'
import { invokeSbiMethod, isCashOrderMethod, isTradingMethod, type RpcMethod } from '../rpc/methods'
import { connectSbi } from '../rpc/sbi-session'
import type { StoredSbiPasskeySecret } from './admin'
import {
  assertAndConsumeApiKeyTradeLimits,
  assertApiKeyMethodAllowed,
} from '../security/trade-limits'
import { readSecret } from '../security/keyring'
import { effectiveSbiDeviceId, effectiveSbiTradePassword } from '../security/sbi-credentials'

const jsonText = (value: unknown) => JSON.stringify(value, null, 2)

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : jsonText(value) }],
})

const requireAuthenticated = (auth: AuthContext) => {
  if (!auth.authenticated) throw new Error('unauthorized')
}

const ORDER_SUBMIT_TICKET_TTL_MS = 10 * 60 * 1000

type OrderSubmitTicket = {
  passkeyId: string
  estimateMethod: RpcMethod
  submitMethod: RpcMethod
  params: unknown
  confirmationId?: string
  authKey: string
  expiresAt: Date
}

const orderSubmitTickets = new Map<string, OrderSubmitTicket>()

const authKey = (auth: AuthContext) => {
  if (auth.type === 'apiKey') return `apiKey:${auth.apiKeyId}`
  if (auth.type === 'session') return `session:${auth.sessionId}`
  return 'none'
}

const cleanupExpiredOrderSubmitTickets = (now = new Date()) => {
  for (const [uuid, ticket] of orderSubmitTickets) {
    if (ticket.expiresAt <= now) orderSubmitTickets.delete(uuid)
  }
}

const orderSubmitMethodByEstimateMethod = {
  'orders.cash.estimate': 'orders.cash.place',
  'orders.cash.estimateCorrection': 'orders.cash.placeCorrection',
  'orders.cash.estimateCorrectionConfirm': 'orders.cash.placeCorrection',
  'orders.cash.estimateCancel': 'orders.cash.placeCancel',
  'orders.margin.estimateOpen': 'orders.margin.open',
  'orders.margin.estimateClose': 'orders.margin.close',
  'orders.margin.estimateCloseSummary': 'orders.margin.closeSummary',
  'orders.margin.estimateSummary': 'orders.margin.placeSummary',
  'orders.margin.estimateActualDelivery': 'orders.margin.actualDelivery',
  'orders.ifd.estimate': 'orders.ifd.place',
  'orders.ifd.estimateCorrection': 'orders.ifd.placeCorrection',
  'orders.ifd.estimateCancel': 'orders.ifd.placeCancel',
  'orders.themeInvestment.estimate': 'orders.themeInvestment.place',
  'orders.exchange.estimate': 'orders.exchange.place',
} as const satisfies Partial<Record<RpcMethod, RpcMethod>>

const submitMethodForEstimateMethod = (method: RpcMethod) =>
  orderSubmitMethodByEstimateMethod[method as keyof typeof orderSubmitMethodByEstimateMethod]

const orderSubmitParams = (value: unknown, confirmationId?: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { allowTrading: true }
  return {
    ...value,
    ...(confirmationId ? { confirmationId } : {}),
    allowTrading: true,
  }
}

const confirmationIdFromPreview = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const confirmationId = (value as Record<string, unknown>).confirmationId
  return typeof confirmationId === 'string' && confirmationId ? confirmationId : undefined
}

const accountTypeSchema = z.enum([
  'general',
  'specific',
  'growthInvestment',
  'nisa',
  'juniorNisa',
  'unknown',
])
const depositTypeSchema = z.enum([
  'general',
  'specific',
  'growthInvestment',
  'nisa',
  'juniorNisa',
  'unknown',
])
const tradeSideSchema = z.enum(['buy', 'sell'])
const marketCodeSchema = z.string().min(1).describe('SBI market code')
const issueCodeSchema = z.string().min(1).describe('Issue code')
const orderIdSchema = z.string().min(1).describe('Order id')
const positionIdSchema = z.string().min(1).describe('Position id')

const pagingSchema = {
  index: z.number().int().min(0).optional().describe('Start index for the result list'),
  limit: z.number().int().positive().optional().describe('Maximum number of items to fetch'),
}

const issueOptionsSchema = z.object({
  issueCode: issueCodeSchema,
  market: marketCodeSchema.optional(),
})

const issueChartOptionsSchema = issueOptionsSchema.extend({
  period: z.enum(['minute', 'day', 'week', 'month']).optional().describe('Chart period'),
  unit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Candle unit. Minute charts accept 1, 5, 10, or 15; other periods use 1'),
  count: z
    .number()
    .int()
    .positive()
    .max(9999)
    .optional()
    .describe('Number of historical prices to request'),
})

const issueSearchOptionsSchema = z.object({
  query: z.string().min(1).describe('Search text, such as an issue code, name, or keyword'),
  market: marketCodeSchema.optional().describe('Client-side market code filter'),
  limit: z.number().int().positive().optional().describe('Maximum number of returned issues'),
})

const cashPositionOptionsSchema = z.object({
  ...pagingSchema,
  issueCode: issueCodeSchema.optional(),
  market: marketCodeSchema.optional(),
  accountType: accountTypeSchema.optional(),
})

const marginPositionOptionsSchema = z.object({
  ...pagingSchema,
  issueCode: issueCodeSchema.optional(),
  market: marketCodeSchema.optional(),
  side: tradeSideSchema.optional(),
  accountType: accountTypeSchema.optional(),
})

const orderInquiryOptionsSchema = z.object({
  ...pagingSchema,
  from: z.string().optional().describe('Start date for the inquiry range'),
  to: z.string().optional().describe('End date for the inquiry range'),
  issueCode: issueCodeSchema.optional(),
  market: marketCodeSchema.optional(),
  status: z.enum(['open', 'executed', 'cancelled', 'expired', 'rejected', 'unknown']).optional(),
})

const orderDetailSchema = z.object({
  orderNumber: z.string().min(1).optional().describe('Order number shown in order inquiry'),
  orderId: orderIdSchema.optional().describe('Order id shown in order inquiry'),
  issueCode: issueCodeSchema.optional(),
  market: marketCodeSchema.describe('US stock market code for order detail'),
})

const tradeRecordInquiryOptionsSchema = orderInquiryOptionsSchema.extend({
  accountType: accountTypeSchema.optional(),
})

const boardOptionsSchema = issueOptionsSchema.extend({
  accountType: accountTypeSchema.optional(),
  side: z
    .enum([
      'cashBuy',
      'cashSell',
      'marginOpen',
      'marginOpenBuy',
      'marginOpenSell',
      'marginClose',
      'marginCloseBuy',
      'marginCloseSell',
    ])
    .optional(),
})

const stockOrderBaseSchema = z
  .object({
    issueCode: issueCodeSchema,
    market: marketCodeSchema,
    side: tradeSideSchema,
    accountType: accountTypeSchema.optional(),
    quantity: z.number().positive().describe('Order quantity'),
    depositType: depositTypeSchema.optional(),
  })
  .strict()

const cashOrderPriceConditionSchema = z.enum([
  'limit',
  'limitAtOpen',
  'limitAtClose',
  'limitIoc',
  'market',
  'marketAtOpen',
  'marketAtClose',
  'marketIoc',
  'funari',
])

const cashOrderSchema = stockOrderBaseSchema.extend({
  preOrderMarket: marketCodeSchema
    .optional()
    .describe(
      'Original listed market for S-kabu checks, such as XTKS. For S-kabu live orders set kind: "s", market: "STK", and preOrderMarket to the listed market.',
    ),
  price: z.number().positive().optional().describe('Order price for price-based orders'),
  kind: z
    .enum(['market', 'limit', 'stop', 'oco', 'ifd', 'ifdo', 's', 'unknown'])
    .optional()
    .describe('Use "s" for S-kabu fractional-share cash orders. Do not use sStock.'),
  priceCondition: cashOrderPriceConditionSchema
    .optional()
    .describe('APK/MTS execution condition for cash orders'),
  orderTerm: z.enum(['day', 'week', 'date']).optional().describe('Order validity term'),
  orderDate: z
    .string()
    .optional()
    .describe('Validity date used when orderTerm is date, in yyyyMMdd or yyyy-MM-dd format'),
  orderMethod: z.enum(['normal', 'stop', 'oco']).optional().describe('Special order method'),
  triggerZone: z.enum(['above', 'below']).optional().describe('Stop trigger direction'),
  triggerPrice: z.number().positive().optional().describe('Stop trigger price'),
  secondaryPriceCondition: cashOrderPriceConditionSchema
    .optional()
    .describe('Secondary execution condition for OCO orders'),
  secondaryPrice: z.number().positive().optional().describe('Secondary price for OCO orders'),
  ippanMarginPaymentLimit: z
    .string()
    .optional()
    .describe('APK ippan margin payment-limit code from board/pre-order information'),
  sorLastMarket: marketCodeSchema
    .optional()
    .describe('Previous market code sent with SOR orders; defaults to login profile'),
})

const cashOrderPreOrderSchema = z
  .object({
    issueCode: issueCodeSchema,
    market: marketCodeSchema,
    side: tradeSideSchema,
    accountType: accountTypeSchema.optional(),
    depositType: depositTypeSchema.optional(),
    kind: z
      .enum(['s'])
      .optional()
      .describe('Set to "s" to request APK S-kabu pre-order constraints. Do not use sStock.'),
    preOrderMarket: marketCodeSchema
      .optional()
      .describe('Original listed market for S-kabu preflight, such as XTKS.'),
  })
  .strict()

const stockOrderMarginPositionSchema = z
  .object({
    openTradeDate: z
      .string()
      .describe(
        'Open trade date from the margin position record, in yyyyMMdd or yyyy-MM-dd format',
      ),
    openPrice: z
      .union([z.number().positive(), z.string().min(1)])
      .describe('Open price from the margin position record'),
    quantity: z
      .union([z.number().positive(), z.string().min(1)])
      .describe('Selected quantity from the margin position record'),
    orgNewTradeDate: z.string().describe('Original new-trade date from the margin position record'),
    bargainMarketCode: marketCodeSchema.describe(
      'Bargain market code from the margin position record',
    ),
  })
  .strict()

const placeCashOrderSchema = cashOrderSchema.extend({
  confirmationId: z
    .string()
    .optional()
    .describe('Confirmation ID returned by the confirmation step'),
  omitConfirmation: z
    .boolean()
    .optional()
    .describe('APK confirmation-screen omission flag for live submit calls'),
  allowTrading: z.literal(true).optional().describe('Explicitly allows sending a live order'),
})

const orderCorrectionSchema = z
  .object({
    orderNumber: z
      .string()
      .min(1)
      .optional()
      .describe('Order number shown in order inquiry; required by the mobile pre-correction route'),
    orderId: orderIdSchema,
    issueCode: issueCodeSchema.optional().describe('Issue code from the pre-correction response'),
    market: marketCodeSchema.optional().describe('Market code from the pre-correction response'),
    tradeId: z.string().min(1).optional().describe('Original trade id code'),
    correctionType: z.string().min(1).optional().describe('Additional correction flag'),
    status: z.string().min(1).optional().describe('Original order status code'),
    rbeOrderStatus: z.string().min(1).optional().describe('Original RBE order status code'),
    depositTypeText: z.string().min(1).optional().describe('Display deposit type text'),
    orderMethod: z.enum(['normal', 'stop', 'oco']).optional().describe('Primary order method'),
    priceCondition: cashOrderPriceConditionSchema
      .optional()
      .describe('Corrected primary execution condition'),
    triggerZone: z.enum(['above', 'below']).optional().describe('Stop trigger direction'),
    triggerPrice: z.number().positive().optional().describe('Stop trigger price'),
    secondaryPriceCondition: cashOrderPriceConditionSchema
      .optional()
      .describe('Secondary/OCO execution condition'),
    secondaryPrice: z.number().positive().optional().describe('Secondary/OCO price'),
    ifdPriceCondition: cashOrderPriceConditionSchema
      .optional()
      .describe('IFD follow-up execution condition for IF/IFDOCO correction'),
    ifdPrice: z.number().positive().optional().describe('IFD follow-up price'),
    ifdOrderMethod: z
      .enum(['normal', 'stop', 'oco'])
      .optional()
      .describe('IFD follow-up special order method'),
    ifdTriggerZone: z.enum(['above', 'below']).optional().describe('IFD stop trigger direction'),
    ifdTriggerPrice: z.number().positive().optional().describe('IFD stop trigger price'),
    ifdSecondaryPriceCondition: cashOrderPriceConditionSchema
      .optional()
      .describe('IFD secondary/OCO execution condition'),
    ifdSecondaryPrice: z.number().positive().optional().describe('IFD secondary/OCO price'),
    correctionControlFlag: z.enum(['1', '2']).optional().describe('Mobile correction control flag'),
    quantity: z.number().positive().optional().describe('Corrected order quantity'),
    price: z.number().positive().optional().describe('Corrected order price'),
  })
  .strict()

const placeOrderCorrectionSchema = orderCorrectionSchema.extend({
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live correction request'),
})

const orderCancelSchema = z
  .object({
    orderNumber: z.string().min(1).describe('Order number shown in order inquiry'),
    orderId: orderIdSchema.optional().describe('Original order id shown in order inquiry'),
    issueCode: issueCodeSchema.optional().describe('Original issue code shown in order inquiry'),
    market: marketCodeSchema.optional().describe('Original market code shown in order inquiry'),
    tradeId: z.string().min(1).optional().describe('Original trade id code'),
    cancelType: z.string().min(1).optional().describe('Additional cancel flag'),
  })
  .strict()

const placeOrderCancelSchema = orderCancelSchema.extend({
  tradePassword: z.string().optional().describe('Trading password used by SBI'),
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live cancellation request'),
})

const marginOpenTradeTypeSchema = z.enum([
  'standard',
  'generalBuy',
  'generalSellShort',
  'generalSellInventoryLimited',
  'generalSellInventoryUnlimited',
  'day',
  'hyper',
])

const marginOpenOrderSchema = cashOrderSchema.extend({
  kind: z.enum(['market', 'limit', 'stop', 'oco', 'ifd', 'ifdo', 'unknown']).optional(),
  marginTradeType: marginOpenTradeTypeSchema.describe('APK margin-open trade type'),
  ippanMarginPaymentLimit: z
    .string()
    .optional()
    .describe('APK ippan margin payment-limit code from board/pre-order information'),
})

const marginOpenOrderPreOrderSchema = stockOrderBaseSchema.omit({ quantity: true }).extend({
  marginTradeType: marginOpenTradeTypeSchema
    .optional()
    .describe('APK margin-open trade type used by the mobile pre-order request'),
})

const placeMarginOpenOrderSchema = marginOpenOrderSchema.extend({
  confirmationId: z
    .string()
    .optional()
    .describe('Confirmation ID returned by the confirmation step'),
  omitConfirmation: z
    .boolean()
    .optional()
    .describe('APK confirmation-screen omission flag for live submit calls'),
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live margin open order'),
})

const marginCloseOrderSchema = cashOrderSchema.extend({
  positionId: positionIdSchema.optional().describe('Position ID to close'),
  marginCloseTradeType: z
    .enum(['sixMonth', 'noLimit', 'oneDay', 'fifteenDay'])
    .describe('APK margin-close trade type'),
  marginPositions: z
    .array(stockOrderMarginPositionSchema)
    .optional()
    .describe('Margin position records selected for specified close orders'),
  marginClosePositionOrder: z
    .enum(['profitFirst', 'lossFirst', 'newestFirst', 'oldestFirst', 'specify'])
    .optional()
    .describe('APK close-position ordering used by summary close orders'),
})

const marginCloseOrderPreOrderSchema = stockOrderBaseSchema.omit({ quantity: true }).extend({
  marginCloseTradeType: z
    .enum(['sixMonth', 'noLimit', 'oneDay', 'fifteenDay'])
    .optional()
    .describe('APK margin-close trade type used by the mobile pre-order request'),
})

const placeMarginCloseOrderSchema = marginCloseOrderSchema.extend({
  omitConfirmation: z
    .boolean()
    .optional()
    .describe('APK confirmation-screen omission flag for live submit calls'),
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live margin close order'),
})

const actualDeliveryOrderSchema = z
  .object({
    issueCode: issueCodeSchema,
    market: marketCodeSchema,
    accountType: accountTypeSchema.optional(),
    quantity: z.number().positive().describe('Order quantity'),
    depositType: depositTypeSchema.optional(),
    price: z.number().positive().optional().describe('Order price for price-based requests'),
    kind: z.enum(['genbiki', 'genwatashi']),
    positionId: positionIdSchema.optional().describe('Position ID to deliver'),
    marginPositions: z
      .array(stockOrderMarginPositionSchema)
      .optional()
      .describe('Margin position records selected for genbiki/genwatashi delivery'),
    ippanMarginPaymentLimit: z
      .string()
      .optional()
      .describe('APK ippan margin payment-limit code from board/pre-order information'),
  })
  .strict()

const actualDeliveryOrderPreOrderSchema = actualDeliveryOrderSchema.omit({
  quantity: true,
  price: true,
  positionId: true,
  marginPositions: true,
  ippanMarginPaymentLimit: true,
})

const placeActualDeliveryOrderSchema = actualDeliveryOrderSchema.extend({
  confirmationId: z
    .string()
    .optional()
    .describe('Confirmation ID returned by the confirmation step'),
  omitConfirmation: z
    .boolean()
    .optional()
    .describe('APK confirmation-screen omission flag for live submit calls'),
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live actual-delivery order'),
})

const ifdOrderSchema = cashOrderSchema.extend({
  tradeType: z
    .enum(['cash', 'marginOpen'])
    .optional()
    .describe('Product to use for the first IFD leg'),
  marginTradeType: marginOpenTradeTypeSchema
    .optional()
    .describe('APK margin-open trade type for the first leg when tradeType is marginOpen'),
  ippanMarginPaymentLimit: z
    .string()
    .optional()
    .describe('APK ippan margin payment-limit code for the first IFD leg'),
  ifdPriceCondition: cashOrderPriceConditionSchema
    .optional()
    .describe('Execution condition for the IFD follow-up leg'),
  ifdPrice: z.number().positive().optional().describe('Order price for the IFD follow-up leg'),
  ifdOrderTerm: z.enum(['day', 'week', 'date']).optional().describe('IFD follow-up validity term'),
  ifdOrderDate: z
    .string()
    .optional()
    .describe('IFD follow-up validity date in yyyyMMdd or yyyy-MM-dd format'),
  ifdOrderMethod: z
    .enum(['normal', 'stop', 'oco'])
    .optional()
    .describe('Special order method for the IFD follow-up leg'),
  ifdTriggerZone: z
    .enum(['above', 'below'])
    .optional()
    .describe('Stop trigger direction for the IFD follow-up leg'),
  ifdTriggerPrice: z
    .number()
    .positive()
    .optional()
    .describe('Stop trigger price for the IFD follow-up leg'),
  ifdSecondaryPriceCondition: cashOrderPriceConditionSchema
    .optional()
    .describe('Secondary OCO execution condition for IFDOCO'),
  ifdSecondaryPrice: z.number().positive().optional().describe('Secondary OCO price for IFDOCO'),
})

const placeIfdOrderSchema = ifdOrderSchema.extend({
  confirmationId: z
    .string()
    .optional()
    .describe('Confirmation ID returned by the confirmation step'),
  omitConfirmation: z
    .boolean()
    .optional()
    .describe('APK confirmation-screen omission flag for live submit calls'),
  allowTrading: z.literal(true).optional().describe('Explicitly allows sending a live IFD order'),
})

const themeInvestmentOrderSchema = z
  .object({
    themeId: z.string().min(1).describe('Theme ID for the theme investment order'),
    themeSetYyyymm: z
      .string()
      .length(6)
      .describe('Theme set year/month (`theme_set_yyyymm`) from the mobile APK handoff'),
    themeCourse: z
      .union([z.number().int().nonnegative(), z.string().min(1).max(2)])
      .describe('Theme course (`theme_course`) from the mobile APK handoff'),
    side: tradeSideSchema,
    accountType: accountTypeSchema.optional().describe('Account/deposit type used for the order'),
    depositType: accountTypeSchema.optional().describe('Deposit type used for the order'),
    components: z
      .array(
        z.object({
          issueCode: issueCodeSchema,
          quantity: z.union([z.number().positive(), z.string().min(1)]),
        }),
      )
      .min(1)
      .max(10)
      .describe('Component stock orders selected by the mobile theme investment flow'),
    amount: z
      .number()
      .positive()
      .optional()
      .describe('Order amount for the theme investment order'),
  })
  .strict()

const themeInvestmentPreOrderSchema = z
  .object({
    themeId: z.string().min(1).describe('Theme ID from the mobile theme investment handoff'),
    themeName: z
      .string()
      .min(1)
      .optional()
      .describe('Theme name from the mobile theme investment handoff'),
    exchangeCode: marketCodeSchema.describe('Exchange code used by the mobile pre-order call'),
    components: z
      .array(
        z.object({
          issueCode: issueCodeSchema,
          quantity: z.union([z.number().positive(), z.string().min(1)]).optional(),
        }),
      )
      .min(1)
      .max(10)
      .describe('Component stocks selected by the mobile theme investment flow'),
  })
  .strict()

const placeThemeInvestmentOrderSchema = themeInvestmentOrderSchema.extend({
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live theme investment order'),
})

const exchangeOrderSchema = z
  .object({
    currencyCode: z.string().min(1).describe('Currency code, such as USD'),
    side: z.enum(['buy', 'sell']).describe('Buy or sell the foreign currency'),
    tradeQuantity: z.union([z.number().positive(), z.string().min(1)]).describe('Order quantity'),
    specificMethod: z
      .enum(['foreign', 'domestic'])
      .optional()
      .describe('foreign for foreign-currency quantity, domestic for yen amount'),
    accountKind: z.enum(['GENERAL', 'JR_NISA']).optional().describe('SBI exchange account kind'),
    sellMethod: z.enum(['SELL_PART', 'SELL_ALL']).optional().describe('Required for sell orders'),
    orderAmount: z
      .union([z.number().positive(), z.string().min(1)])
      .optional()
      .describe('Hidden order amount posted to SBI; required for domestic orders'),
    tradePassword: z.string().optional().describe('Trading password used by SBI'),
  })
  .strict()

const exchangeRateSchema = exchangeOrderSchema.pick({
  currencyCode: true,
  side: true,
})

const placeExchangeOrderSchema = exchangeOrderSchema.extend({
  allowTrading: z
    .literal(true)
    .optional()
    .describe('Explicitly allows sending a live exchange order'),
})

const methodParamSchemas = {
  'session.profile': undefined,
  'account.profile': undefined,
  'account.assets.current': undefined,
  'account.power.buyingPower': undefined,
  'account.power.collateralRatio': undefined,
  'account.positions.cash': cashPositionOptionsSchema.optional(),
  'account.positions.cashDetail': cashPositionOptionsSchema.optional(),
  'account.positions.cashForIssue': issueOptionsSchema,
  'account.positions.margin': marginPositionOptionsSchema.optional(),
  'account.positions.marginDetail': marginPositionOptionsSchema.optional(),
  'account.positions.marginForIssue': issueOptionsSchema,
  'account.positions.marginSummaryForIssue': issueOptionsSchema,
  'account.positions.marginDetailsForIssue': issueOptionsSchema,
  'account.positions.closeableMargin': marginPositionOptionsSchema,
  'account.positions.deliverableMargin': marginPositionOptionsSchema,
  'account.profitLoss.unrealized': undefined,
  'market.issue.search': issueSearchOptionsSchema,
  'market.issue.suggest': issueSearchOptionsSchema,
  'market.issue.allowedPrices': issueOptionsSchema,
  'market.issue.board': issueOptionsSchema,
  'market.issue.chart': issueChartOptionsSchema,
  'market.issue.openOrders': issueOptionsSchema,
  'market.issue.tradingInfo': boardOptionsSchema,
  'market.index.major': undefined,
  'market.overview': undefined,
  'market.ranking.market': undefined,
  'market.ranking.sector': undefined,
  'market.ranking.sbi': undefined,
  'news.list': undefined,
  'watchlist.list': undefined,
  'orders.inquiry.detail': orderDetailSchema,
  'orders.inquiry.executionsToday': orderInquiryOptionsSchema.optional(),
  'orders.inquiry.open': orderInquiryOptionsSchema.optional(),
  'orders.inquiry.tradeRecords': tradeRecordInquiryOptionsSchema,
  'orders.cash.preOrder': cashOrderPreOrderSchema,
  'orders.cash.estimate': cashOrderSchema,
  'orders.cash.place': placeCashOrderSchema,
  'orders.cash.estimateCorrection': orderCorrectionSchema,
  'orders.cash.estimateCorrectionConfirm': orderCorrectionSchema,
  'orders.cash.placeCorrection': placeOrderCorrectionSchema,
  'orders.cash.estimateCancel': orderCancelSchema,
  'orders.cash.placeCancel': placeOrderCancelSchema,
  'orders.margin.preOrderOpen': marginOpenOrderPreOrderSchema,
  'orders.margin.estimateOpen': marginOpenOrderSchema,
  'orders.margin.open': placeMarginOpenOrderSchema,
  'orders.margin.preOrderClose': marginCloseOrderPreOrderSchema,
  'orders.margin.estimateClose': marginCloseOrderSchema,
  'orders.margin.close': placeMarginCloseOrderSchema,
  'orders.margin.estimateCloseSummary': marginCloseOrderSchema,
  'orders.margin.closeSummary': placeMarginCloseOrderSchema,
  'orders.margin.estimateSummary': marginCloseOrderSchema,
  'orders.margin.placeSummary': placeMarginCloseOrderSchema,
  'orders.margin.preOrderActualDelivery': actualDeliveryOrderPreOrderSchema,
  'orders.margin.estimateActualDelivery': actualDeliveryOrderSchema,
  'orders.margin.actualDelivery': placeActualDeliveryOrderSchema,
  'orders.ifd.estimate': ifdOrderSchema,
  'orders.ifd.place': placeIfdOrderSchema,
  'orders.ifd.estimateCorrection': orderCorrectionSchema,
  'orders.ifd.placeCorrection': placeOrderCorrectionSchema,
  'orders.ifd.estimateCancel': orderCancelSchema,
  'orders.ifd.placeCancel': placeOrderCancelSchema,
  'orders.themeInvestment.list': themeInvestmentPreOrderSchema,
  'orders.themeInvestment.estimate': themeInvestmentOrderSchema,
  'orders.themeInvestment.place': placeThemeInvestmentOrderSchema,
  'orders.exchange.rate': exchangeRateSchema,
  'orders.exchange.estimate': exchangeOrderSchema,
  'orders.exchange.place': placeExchangeOrderSchema,
} satisfies Record<RpcMethod, z.ZodType | undefined>

const getActionToMethod = {
  sessionProfile: 'session.profile',
  accountProfile: 'account.profile',
  currentAssets: 'account.assets.current',
  buyingPower: 'account.power.buyingPower',
  collateralRatio: 'account.power.collateralRatio',
  cashPositions: 'account.positions.cash',
  cashPositionDetail: 'account.positions.cashDetail',
  cashPositionForIssue: 'account.positions.cashForIssue',
  marginPositions: 'account.positions.margin',
  marginPositionDetail: 'account.positions.marginDetail',
  marginPositionForIssue: 'account.positions.marginForIssue',
  marginSummaryForIssue: 'account.positions.marginSummaryForIssue',
  marginDetailsForIssue: 'account.positions.marginDetailsForIssue',
  closeableMarginPositions: 'account.positions.closeableMargin',
  deliverableMarginPositions: 'account.positions.deliverableMargin',
  unrealizedProfitLoss: 'account.profitLoss.unrealized',
  issueSearch: 'market.issue.search',
  issueSuggest: 'market.issue.suggest',
  allowedPrices: 'market.issue.allowedPrices',
  board: 'market.issue.board',
  chart: 'market.issue.chart',
  openOrdersForIssue: 'market.issue.openOrders',
  tradingInfo: 'market.issue.tradingInfo',
  majorIndexes: 'market.index.major',
  marketOverview: 'market.overview',
  marketRanking: 'market.ranking.market',
  sectorRanking: 'market.ranking.sector',
  sbiRanking: 'market.ranking.sbi',
  news: 'news.list',
  watchlist: 'watchlist.list',
  orderDetail: 'orders.inquiry.detail',
  executionsToday: 'orders.inquiry.executionsToday',
  openOrders: 'orders.inquiry.open',
  tradeRecords: 'orders.inquiry.tradeRecords',
  cashOrderPreflight: 'orders.cash.preOrder',
  marginOpenPreflight: 'orders.margin.preOrderOpen',
  marginClosePreflight: 'orders.margin.preOrderClose',
  actualDeliveryPreflight: 'orders.margin.preOrderActualDelivery',
  themeInvestmentList: 'orders.themeInvestment.list',
  exchangeRate: 'orders.exchange.rate',
} as const satisfies Record<string, RpcMethod>

const changeActionToEstimateMethod = {
  cashOrder: 'orders.cash.estimate',
  cashOrderCorrection: 'orders.cash.estimateCorrection',
  cashOrderCorrectionConfirm: 'orders.cash.estimateCorrectionConfirm',
  cashOrderCancel: 'orders.cash.estimateCancel',
  marginOpenOrder: 'orders.margin.estimateOpen',
  marginCloseOrder: 'orders.margin.estimateClose',
  marginCloseSummaryOrder: 'orders.margin.estimateSummary',
  marginCloseSummaryConfirm: 'orders.margin.estimateCloseSummary',
  actualDeliveryOrder: 'orders.margin.estimateActualDelivery',
  ifdOrder: 'orders.ifd.estimate',
  ifdOrderCorrection: 'orders.ifd.estimateCorrection',
  ifdOrderCancel: 'orders.ifd.estimateCancel',
  themeInvestmentOrder: 'orders.themeInvestment.estimate',
  exchangeOrder: 'orders.exchange.estimate',
} as const satisfies Record<string, keyof typeof orderSubmitMethodByEstimateMethod>

const getActions = Object.keys(getActionToMethod) as Array<keyof typeof getActionToMethod>
const changeActions = Object.keys(changeActionToEstimateMethod) as Array<
  keyof typeof changeActionToEstimateMethod
>
const getActionDescription = `Available actions: capabilities, passkeys, ${getActions
  .map((action) => `${action}=${getActionToMethod[action]}`)
  .join(
    ', ',
  )}. S-kabu preflight uses cashOrderPreflight with input.kind: "s" and input.preOrderMarket, not sStock.`
const changeActionDescription = `Available actions: ${changeActions
  .map((action) => `${action}=${changeActionToEstimateMethod[action]}`)
  .join(
    ', ',
  )}. S-kabu cash orders use cashOrder with input.kind: "s", input.market: "STK", and input.preOrderMarket set to the listed market such as XTKS; do not use sStock, orderType, or sor.`

const getToolInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capabilities') }).strict(),
  z.object({ action: z.literal('passkeys') }).strict(),
  ...getActions.map((action) => {
    const method = getActionToMethod[action]
    const paramsSchema = methodParamSchemas[method]
    return z
      .object({
        action: z.literal(action),
        passkeyId: z.string().describe('Saved SBI passkey id'),
        ...(paramsSchema ? { input: paramsSchema.describe(`${method} input`) } : {}),
      })
      .strict()
  }),
] as any)

const changeToolInputSchema = z.discriminatedUnion(
  'action',
  changeActions.map((action) => {
    const method = changeActionToEstimateMethod[action]
    const paramsSchema = methodParamSchemas[method]
    if (!paramsSchema) throw new Error(`${method} must have an input schema`)
    return z
      .object({
        action: z.literal(action),
        passkeyId: z.string().describe('Saved SBI passkey id'),
        input: paramsSchema.describe(`${method} input`),
      })
      .strict()
  }) as any,
)

type GetToolArgs =
  | { action: 'capabilities' }
  | { action: 'passkeys' }
  | {
      action: keyof typeof getActionToMethod
      passkeyId: string
      input?: unknown
    }

const parseMethodParams = (method: RpcMethod, input: unknown) => {
  const schema = methodParamSchemas[method]
  if (!schema) {
    if (input !== undefined && input !== null) {
      throw new Error(`${method} does not accept input`)
    }
    return undefined
  }
  return schema.parse(input)
}

const createMcpServer = (c: Context<AppBindings>) => {
  const db = c.get('db')
  const config = c.get('config')
  const auth = c.get('auth')

  const server = new McpServer({
    name: 'csbie',
    version: '0.1.0',
  })

  const listPasskeys = async () => {
    const rows = await db
      .select({
        id: sbiPasskeys.id,
        label: sbiPasskeys.label,
        keyringAccount: sbiPasskeys.keyringAccount,
        createdAt: sbiPasskeys.createdAt,
        updatedAt: sbiPasskeys.updatedAt,
      })
      .from(sbiPasskeys)
      .orderBy(sbiPasskeys.createdAt)
    return Promise.all(
      rows.map(async ({ keyringAccount, ...row }) => {
        const secret = await readSecret<StoredSbiPasskeySecret>(keyringAccount)
        const hasDeviceId = Boolean(effectiveSbiDeviceId(secret))
        const hasTradePassword = Boolean(effectiveSbiTradePassword(secret))
        return {
          ...row,
          hasTradePassword,
          hasDeviceId,
          cashOrderReady: hasTradePassword && hasDeviceId,
        }
      }),
    )
  }

  const invokeCheckedSbiMethod = async (method: RpcMethod, passkeyId: string, params: unknown) => {
    requireAuthenticated(auth)

    if (auth.type === 'apiKey') {
      await assertApiKeyMethodAllowed(db, auth.apiKeyId, method)
    }

    if (isTradingMethod(method)) {
      const tradingParams = params as { allowTrading?: boolean } | undefined
      if (!tradingParams?.allowTrading) throw new Error('trading methods require allowTrading')
      if (auth.type === 'apiKey') {
        await assertAndConsumeApiKeyTradeLimits({
          db,
          apiKeyId: auth.apiKeyId,
          params,
        })
      }
    }

    if (isCashOrderMethod(method)) {
      const [passkey] = await db
        .select({ keyringAccount: sbiPasskeys.keyringAccount })
        .from(sbiPasskeys)
        .where(eq(sbiPasskeys.id, passkeyId))
        .limit(1)
      if (!passkey) throw new Error('SBI passkey not found')
      const secret = await readSecret<StoredSbiPasskeySecret>(passkey.keyringAccount)
      if (!effectiveSbiDeviceId(secret)) {
        throw new Error(
          'orders.cash methods require an SBI deviceId registered with F1131. This passkey has no saved deviceId, so MCP cannot complete SBI trade authentication for cash order estimates or orders.',
        )
      }
      if (!effectiveSbiTradePassword(secret)) {
        throw new Error(
          'orders.cash methods require a saved SBI tradePassword. This passkey has no saved tradePassword, so MCP cannot complete cash order estimates or orders.',
        )
      }
    }

    const client = await connectSbi(db, config, passkeyId)
    return invokeSbiMethod(client, method, params)
  }

  const createChangeRequest = async (
    action: keyof typeof changeActionToEstimateMethod,
    passkeyId: string,
    input: unknown,
  ) => {
    const estimateMethod = changeActionToEstimateMethod[action]
    const submitMethod = submitMethodForEstimateMethod(estimateMethod)
    if (!submitMethod) throw new Error(`${action} cannot create a confirmable request`)

    const params = parseMethodParams(estimateMethod, input)
    const preview = await invokeCheckedSbiMethod(estimateMethod, passkeyId, params)

    cleanupExpiredOrderSubmitTickets()
    const uuid = randomUUID()
    const expiresAt = new Date(Date.now() + ORDER_SUBMIT_TICKET_TTL_MS)
    const confirmationId = confirmationIdFromPreview(preview)
    orderSubmitTickets.set(uuid, {
      passkeyId,
      estimateMethod,
      submitMethod,
      params,
      confirmationId,
      authKey: authKey(auth),
      expiresAt,
    })

    return {
      uuid,
      expiresAt: expiresAt.toISOString(),
      preview,
      confirmTool: 'confirm-request',
    }
  }

  server.registerTool(
    'csbie-get',
    {
      title: 'Get SBI Data',
      description: `Read SBI data through a small abstract action API. This tool never places, corrects, cancels, or otherwise changes real orders. ${getActionDescription}`,
      inputSchema: getToolInputSchema,
    },
    async (args) => {
      const parsedArgs = getToolInputSchema.parse(args) as GetToolArgs
      const { action } = parsedArgs
      requireAuthenticated(auth)

      if (action === 'capabilities') {
        return textResult({
          getActions,
          changeActions,
          changeTool: 'csbie-request-change',
          confirmTool: 'confirm-request',
        })
      }

      if (action === 'passkeys') return textResult({ passkeys: await listPasskeys() })

      const method = getActionToMethod[action]
      if (!method) throw new Error(`unsupported get action: ${String(action)}`)
      const { passkeyId, input } = parsedArgs
      if (!passkeyId) throw new Error(`${action} requires passkeyId`)

      const params = parseMethodParams(method, input)
      return textResult(await invokeCheckedSbiMethod(method, passkeyId, params))
    },
  )

  server.registerTool(
    'csbie-request-change',
    {
      title: 'Create SBI Change Request',
      description: `Prepare a real SBI change by running the corresponding estimate/preview and returning a UUID. This tool never submits the change; pass the UUID to confirm-request. ${changeActionDescription}`,
      inputSchema: changeToolInputSchema,
    },
    async (args) => {
      const { action, passkeyId, input } = changeToolInputSchema.parse(args) as {
        action: keyof typeof changeActionToEstimateMethod
        passkeyId: string
        input: unknown
      }
      return textResult(await createChangeRequest(action, passkeyId, input))
    },
  )

  server.registerTool(
    'confirm-request',
    {
      title: 'Confirm SBI Change Request',
      description:
        'Submit a previously prepared SBI change request by UUID. The UUID expires shortly, is single-use, and is bound to the same authenticated caller.',
      inputSchema: {
        uuid: z.string().uuid().describe('UUID returned by csbie-request-change'),
      },
    },
    async ({ uuid }) => {
      requireAuthenticated(auth)
      cleanupExpiredOrderSubmitTickets()

      const ticket = orderSubmitTickets.get(uuid)
      if (!ticket) throw new Error('request uuid not found or expired')
      if (ticket.authKey !== authKey(auth)) {
        throw new Error('request uuid was created by a different authenticated caller')
      }

      orderSubmitTickets.delete(uuid)
      const result = await invokeCheckedSbiMethod(
        ticket.submitMethod,
        ticket.passkeyId,
        orderSubmitParams(ticket.params, ticket.confirmationId),
      )
      return textResult(result)
    },
  )

  return server
}

export const createMcpRoutes = () => {
  const app = new Hono<AppBindings>()

  app.all('/', async (c) => {
    if (!c.get('authenticated')) {
      const resourceMetadata = new URL('/.well-known/oauth-protected-resource/api/mcp', c.req.url)
      c.header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata.toString()}"`)
      return c.json({ error: 'unauthorized' }, 401)
    }

    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createMcpServer(c)

    try {
      await server.connect(transport)
      return await transport.handleRequest(c)
    } finally {
      await server.close()
      await transport.close()
    }
  })

  return app
}
