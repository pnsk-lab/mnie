import { createHash } from 'node:crypto'
import * as iconv from 'iconv-lite'
import type {
  AccountType,
  AccountAssetsValuationDetail,
  AccountAssetsValuations,
  AccountAssetsValuationSummary,
  Board,
  BoardPriceLevel,
  BuyingPower,
  CashPosition,
  CashPositionList,
  ChartPeriod,
  ChartPrice,
  CurrencyAmount,
  DepositType,
  DomesticMarket,
  ExchangeOrderPreview,
  ExchangeOrderReceipt,
  ExchangeOrderSide,
  ExchangeRateInfo,
  IssueChart,
  IssueRef,
  IssueSearchItem,
  IssueSearchResult,
  IssueSearchStatus,
  MarginPosition,
  MarginPositionList,
  MarketCode,
  MarketIndex,
  NewsItem,
  NewsList,
  Order,
  OrderCorrectionPreOrder,
  OrderKind,
  OrderList,
  OrderPreview,
  OrderReceipt,
  OrderStatus,
  PercentValue,
  Quote,
  Ranking,
  RankingItem,
  SbiMethodError,
  MainSiteAuthCache,
  SbiSession,
  SbiTradeAuthenticationRequest,
  SignedTextValue,
  StockOrderPreOrder,
  StockOrderPreOrderPriceStep,
  ThemeInvestmentList,
  TradeSide,
  Watchlist,
} from '../types'
import type {
  AccountPowerOptions,
  ActualDeliveryOrderPreOrderOptions,
  ActualDeliveryOrderOptions,
  BoardOptions,
  CashOrderPreOrderOptions,
  CashOrderMethod,
  CashOrderOptions,
  CashOrderPriceCondition,
  CashOrderTerm,
  CashOrderTriggerZone,
  CashPositionOptions,
  IfdOrderOptions,
  IssueChartOptions,
  IssueSearchOptions,
  IssueOptions,
  ExchangeOrderOptions,
  ExchangeRateOptions,
  MarginClosePositionOrder,
  MarginCloseOrderPreOrderOptions,
  MarginCloseOrderOptions,
  MarginCloseSummaryOrderOptions,
  MarginCloseTradeType,
  MarginOpenOrderPreOrderOptions,
  MarginOpenOrderOptions,
  MarginOpenTradeType,
  MarketIssueBoardPollingOptions,
  MarginPositionOptions,
  OrderCancelOptions,
  OrderCorrectionOptions,
  OrderInquiryOptions,
  PlaceCashOrderOptions,
  PlaceExchangeOrderOptions,
  PlaceOrderCancelOptions,
  SbiClientMethods,
  StandardCashOrderOptions,
  StockOrderMarginPosition,
  ThemeInvestmentOrderOptions,
  ThemeInvestmentPreOrderOptions,
} from './types'
import { SbiServerError } from './error-map'
import { domesticMarketToMts, isUsMarket, mtsMarketToDomestic } from '../markets'
import { createUsStockAdapter } from './us-stock'

const COMM_GATE_PATH = '/mtsmobile/commgate'
const MAIN_SITE_AUTH_CACHE_TTL_MS = 20 * 60 * 1000
const ISSUE_SEARCH_PATH = '/api/jStockSearchGP.jsp'
const ISSUE_SUGGEST_PATH = '/api/jStockSuggestGP.jsp'
const IZANAGI_HASH_SEEDS = [
  '161df8abb44fb3e3ce17',
  'SBISecurities',
  '035d6b8afcffcd304180',
  '6be0753c74',
] as const
const MTS_HEADER_BYTES = 70
const DEFAULT_PAGE_INDEX = 0
const DEFAULT_PAGE_LIMIT = 999
const DEFAULT_MARKET_POLL_INTERVAL_SECONDS = 5
const DEFAULT_CHART_COUNT = 120
const CHART_PERIOD_MTS_CODES = {
  minute: '1',
  day: '2',
  week: '3',
  month: '4',
} as const satisfies Record<ChartPeriod, string>
const CHART_DEFAULT_UNITS = {
  minute: 1,
  day: 1,
  week: 1,
  month: 1,
} as const satisfies Record<ChartPeriod, number>
const CHART_MINUTE_UNITS = new Set([1, 5, 10, 15])

interface MtsHeader {
  sessionId: string
  trCode: string
  resultCode: string
  notification: string
  lastExecutionTime: string
  maintenance: string
}

interface MtsResponse {
  status: number
  requestUrl: string
  header: MtsHeader
  buffer: Buffer
  text: string
}

interface FixedField {
  width: number
  value?: string | number | null
  align?: 'left' | 'right'
  pad?: string
}

interface OrderPreviewInput {
  issueCode: string
  market?: MarketCode
  side: TradeSide
  quantity?: number
  price?: number
}

interface CashPreOrderInfo {
  issueCode?: string
  market?: string
  issueName?: string
}

const cashCorrectionPreviewInput = {
  issueCode: '',
  side: 'buy',
} satisfies OrderPreviewInput

type TradeAuthenticationStatus = 'success' | 'needDial' | 'excessivelyRequested' | 'unexpected'

interface TradeAuthenticationInfo {
  status: TradeAuthenticationStatus
  statusCode: string
  telNo?: string
  phoneNo?: string
  faxNo?: string
  sbiCallNo?: string
  authLimitTime?: string
}

type TradeAuthenticationConfirmStatus =
  | 'success'
  | 'authNotComplete'
  | 'expired'
  | 'excessivelyRequested'
  | 'unexpected'

const abortError = (signal: AbortSignal) => {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : 'market issue board polling aborted')
}

const waitForPollingInterval = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal ? abortError(signal) : new Error('market issue board polling aborted'))
    }

    timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const pollingIntervalMs = (intervalSeconds = DEFAULT_MARKET_POLL_INTERVAL_SECONDS) => {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error('intervalSeconds must be a positive finite number')
  }
  return intervalSeconds * 1000
}

async function* pollMarketIssueBoard(
  fetchBoard: () => Promise<Board>,
  options: MarketIssueBoardPollingOptions,
): AsyncIterableIterator<Board> {
  const intervalMs = pollingIntervalMs(options.intervalSeconds)

  while (!options.signal?.aborted) {
    yield await fetchBoard()
    await waitForPollingInterval(intervalMs, options.signal)
  }

  if (options.signal?.aborted) throw abortError(options.signal)
}

const debugMts = (label: string, value: unknown) => {
  if (process.env.SBI_CLIENT_DEBUG_MTS !== '1') return
  console.error(`[sbi-client:mts] ${label}`, JSON.stringify(value, null, 2))
}

const rejectUsMarket = (options: { market: MarketCode }, methodName: string) => {
  if (isUsMarket(options.market)) {
    throw new Error(`${methodName} is not implemented for US stock markets`)
  }
  return undefined
}

const publicDomesticMarket = (market: string | undefined, methodName: string) => {
  if (!market) return undefined
  const publicMarket = mtsMarketToDomestic(market)
  if (!publicMarket)
    throw new Error(`${methodName} received unsupported domestic market: ${market}`)
  return publicMarket
}

interface IzanagiIssueSearchItem {
  stockName?: string | null
  stockCode?: string | null
  mkt?: string | null
  extract?: string | null
  extractWord?: string | null
  boldFrom?: string | null
  boldTo?: string | null
  hitString?: string | null
}

interface IzanagiIssueSearchResponse {
  status?: string | null
  stocks?: IzanagiIssueSearchItem[] | null
}

export const registerDeviceId = async (session: SbiSession, deviceId: string) => {
  await callMts(session, 'F1131', fixedTrin([{ width: 36, value: deviceId }]))
}

export const createMethodsFromSession = (session: SbiSession): SbiClientMethods => {
  const usStock = createUsStockAdapter(session)
  const client: SbiClientMethods = {
    session: {
      profile: async () => session.profile,
    },
    account: {
      profile: async () => session.profile,
      assets: {
        current: async () => fetchCurrentAccountAssets(session),
      },
      power: {
        buyingPower: async (options) => fetchAccountPower(session, options),
        collateralRatio: async (options) =>
          fetchAccountPower(session, { includeMarginAccount: true, ...options }),
      },
      positions: {
        cash: async (options) =>
          options?.market && isUsMarket(options.market)
            ? usStock.positions(options)
            : parseCashPositions(
                await callMts(session, 'F2631', listAccountTrin(session, options)),
                options,
              ),
        cashDetail: async (options) =>
          options?.market && isUsMarket(options.market)
            ? usStock.positionsDetail(options)
            : parseCashPositions(
                await callMts(session, 'F2632', listAccountTrin(session, options)),
                options,
              ),
        cashForIssue: async (options) => {
          return isUsMarket(options.market)
            ? usStock.positions(options)
            : filterCashPositions(
                parseCashPositions(
                  await callMts(session, 'F2602', issuePositionTrin(session, options)),
                  options,
                ),
                options,
              )
        },
        margin: async (options) =>
          parseMarginPositions(
            await callMts(
              session,
              'F2633',
              listAccountTrin(session, options, sideCode(options?.side)),
            ),
            options,
          ),
        marginDetail: async (options) =>
          parseMarginPositions(
            await callMts(
              session,
              'F2634',
              listAccountTrin(session, options, sideCode(options?.side)),
            ),
            options,
          ),
        marginForIssue: async (options) => {
          const list = parseMarginPositions(
            await callMts(session, 'F2606', issuePositionTrin(session, options)),
            options,
          )
          return filterMarginPositions(list, options)
        },
        marginSummaryForIssue: async (options) => {
          const list = parseMarginPositions(
            await callMts(session, 'F2615', issuePositionTrin(session, options)),
            options,
          )
          return filterMarginPositions(list, options)
        },
        marginDetailsForIssue: async (options) => {
          const list = parseMarginPositions(
            await callMts(session, 'F1752', issuePositionTrin(session, options)),
            options,
          )
          return filterMarginPositions(list, options)
        },
        closeableMargin: async (options) =>
          parseMarginPositions(
            await callMts(session, 'F2698', marginCloseListTrin(session, options)),
            options,
          ),
        deliverableMargin: async (options) =>
          parseMarginPositions(
            await callMts(session, 'F2608', marginCloseListTrin(session, options)),
            options,
          ),
      },
      profitLoss: {
        unrealized: async (options) => {
          if (options?.market && isUsMarket(options.market)) return usStock.unrealized()
          const cash = await client.account.positions.cash()
          const margin = await client.account.positions.margin()
          return {
            cash: cash.totalProfitLoss,
            margin: margin.totalProfitLoss,
            total: addSignedTextValues(cash.totalProfitLoss, margin.totalProfitLoss),
          }
        },
      },
    },
    market: {
      issue: {
        search: async (options) =>
          isUsMarket(options.market)
            ? usStock.search(options)
            : callIssueSearch(session, ISSUE_SEARCH_PATH, 'inputWord', options),
        suggest: async (options) =>
          isUsMarket(options.market)
            ? usStock.search(options)
            : callIssueSearch(session, ISSUE_SUGGEST_PATH, 'term', options),
        allowedPrices: async (options) =>
          rejectUsMarket(options, 'market.issue.allowedPrices') ??
          parseAllowedPrices(await callMts(session, 'F1112', issueTrin(options)), options),
        board: async (options) =>
          isUsMarket(options.market)
            ? usStock.board(options)
            : parseBoardLike(await callMts(session, 'F1207', issueTrin(options)), options),
        pollBoard: (options) =>
          pollMarketIssueBoard(
            async () =>
              isUsMarket(options.market)
                ? usStock.board(options)
                : parseBoardLike(await callMts(session, 'F1207', issueTrin(options)), options),
            options,
          ),
        chart: async (options) =>
          isUsMarket(options.market)
            ? usStock.chart(options)
            : parseIssueChart(
                await callMtsReturningHeaderError(session, 'F1851', issueChartTrin(options)),
                options,
              ),
        openOrders: async (options) =>
          isUsMarket(options.market)
            ? usStock.openOrders(options)
            : parseOrdersLoose(
                await callMtsReturningHeaderError(
                  session,
                  'F2504',
                  openOrdersTrin(session, options),
                ),
                options,
              ),
        tradingInfo: async (options) =>
          isUsMarket(options.market)
            ? usStock.tradingInfo(options)
            : parseBoardLike(
                await callMts(
                  session,
                  tradingInfoTrCode(options),
                  tradingInfoTrin(session, options),
                ),
                options,
              ),
      },
      index: {
        major: async () => parseMajorIndexes(await callMts(session, 'F1414')),
      },
      overview: async () => parseMarketOverview(await callMts(session, 'F1412')),
      ranking: {
        market: async () =>
          parseRanking(await callMts(session, 'F1502', marketRankingTrin()), 'market'),
        sector: async () => parseRanking(await callMts(session, 'F1405'), 'sector'),
        sbi: async () =>
          parseSbiRanking(
            await callMts(
              session,
              'F1406',
              fixedTrin([
                { width: 1, value: '1' },
                { width: 1, value: '1' },
              ]),
            ),
          ),
      },
    },
    news: {
      list: async () => parseNews(await callMts(session, 'F1418', newsListTrin())),
    },
    watchlist: {
      list: async () => parseWatchlists(await callMts(session, 'F1202', watchlistTrin())),
    },
    orders: {
      inquiry: {
        executionsToday: async (options) =>
          options?.market && isUsMarket(options.market)
            ? usStock.orders(options)
            : parseOrdersLoose(
                await callMtsReturningHeaderError(
                  session,
                  'F2503',
                  orderInquiryTrin(session, options),
                ),
                options,
              ),
        open: async (options) =>
          options?.market && isUsMarket(options.market)
            ? usStock.orders(options)
            : parseOrdersLoose(
                await callMtsReturningHeaderError(
                  session,
                  'F2511',
                  recentOrdersTrin(session, options),
                ),
                options,
              ),
        detail: async (options) => {
          if (isUsMarket(options.market)) return usStock.orderDetail(options)
          throw new Error(
            'orders.inquiry.detail is currently implemented only for US stock markets',
          )
        },
        tradeRecords: async (options) => {
          if (!options.market || isUsMarket(options.market)) return usStock.tradeRecords(options)
          throw new Error(
            'orders.inquiry.tradeRecords is currently implemented only for US stock markets',
          )
        },
      },
      cash: {
        preOrder: async (options) =>
          isUsMarket(options.market)
            ? usStock.preOrder(options)
            : parseStockOrderPreOrder(
                await callMts(
                  session,
                  cashPreOrderTrCode(options),
                  cashPreOrderTrin(session, options),
                ),
                options,
              ),
        estimate: async (options) => {
          if (isUsMarket(options.market)) return usStock.estimate(options)
          assertNoOmitConfirmation(options, 'orders.cash.estimate')
          assertCashOrderOptions(options)
          await prepareCashOrder(session, options)
          return parseOrderPreview(
            await callMtsReturningHeaderError(
              session,
              cashConfirmTrCode(options),
              cashOrderTrin(session, options),
            ),
            options,
          )
        },
        place: async (options) => {
          if (isUsMarket(options.market)) return usStock.place(options)
          assertTradingAllowed(options, 'orders.cash.place')
          assertCashOrderOptions(options)
          await prepareCashOrder(session, options)
          return parseOrderReceipt(
            await callMtsReturningHeaderError(
              session,
              cashReceptionTrCode(options),
              cashOrderTrin(session, options),
            ),
          )
        },
        estimateCorrection: async (options) =>
          options.market && isUsMarket(options.market)
            ? usStock.estimateCorrection(options)
            : parseOrderCorrectionPreOrder(
                await callMts(session, 'F2301', orderCorrectionPreOrderTrin(session, options)),
                cashCorrectionPreviewInput,
              ),
        estimateCorrectionConfirm: async (options) =>
          options.market && isUsMarket(options.market)
            ? usStock.estimateCorrectionConfirm(options)
            : parseOrderPreview(
                await callMts(session, 'F2302', orderCorrectionSubmitTrin(session, options)),
                cashCorrectionPreviewInput,
              ),
        placeCorrection: async (options) => {
          if (options.market && isUsMarket(options.market)) return usStock.placeCorrection(options)
          assertTradingAllowed(options, 'orders.cash.placeCorrection')
          return parseOrderReceipt(
            await callMts(session, 'F2303', orderCorrectionSubmitTrin(session, options)),
          )
        },
        estimateCancel: async (options) => {
          if (options.market && isUsMarket(options.market)) return usStock.estimateCancel(options)
          assertOrderCancelOptions(options)
          return parseOrderCorrectionPreOrder(
            await callMts(session, 'F2311', orderCancelPreOrderTrin(session, options)),
            cashCorrectionPreviewInput,
          )
        },
        placeCancel: async (options) => {
          if ('market' in options && isUsMarket(options.market as MarketCode | undefined)) {
            return usStock.placeCancel(options)
          }
          assertTradingAllowed(options, 'orders.cash.placeCancel')
          assertPlaceOrderCancelOptions(session, options, 'orders.cash.placeCancel')
          const preview = parseOrderCorrectionPreOrder(
            await callMts(session, 'F2311', orderCancelPreOrderTrin(session, options)),
            cashCorrectionPreviewInput,
          )
          return parseOrderReceipt(
            await callMts(
              session,
              'F2304',
              orderCancelSubmitTrin(session, {
                ...options,
                orderNumber: preview.correction?.orderNumber ?? options.orderNumber,
                tradeId: preview.correction?.tradeId ?? options.tradeId,
              }),
            ),
          )
        },
      },
      margin: {
        preOrderOpen: async (options) =>
          parseStockOrderPreOrder(
            await callMts(
              session,
              stockPreOrderTrCode('marginOpen', options.side),
              stockPreOrderTrin(session, options, 'marginOpen'),
            ),
            options,
          ),
        estimateOpen: async (options) => {
          assertNoOmitConfirmation(options, 'orders.margin.estimateOpen')
          assertMarginOpenOrderOptions(options)
          await prepareMarginOpenOrder(session, options)
          return parseOrderPreview(
            await callMtsReturningHeaderError(
              session,
              marginOpenConfirmTrCode(options),
              marginOpenOrderTrin(session, options),
            ),
            options,
          )
        },
        open: async (options) => {
          assertTradingAllowed(options, 'orders.margin.open')
          assertMarginOpenOrderOptions(options)
          await prepareMarginOpenOrder(session, options)
          return parseOrderReceipt(
            await callMtsReturningHeaderError(
              session,
              marginOpenReceptionTrCode(options),
              marginOpenOrderTrin(session, options),
            ),
          )
        },
        preOrderClose: async (options) =>
          parseStockOrderPreOrder(
            await callMts(
              session,
              stockPreOrderTrCode('marginClose', options.side),
              stockPreOrderTrin(session, options, 'marginClose'),
            ),
            options,
          ),
        estimateClose: async (options) => {
          assertNoOmitConfirmation(options, 'orders.margin.estimateClose')
          assertMarginCloseOrderOptions(options)
          return parseOrderPreview(
            await callMts(
              session,
              marginCloseConfirmTrCode(options),
              marginCloseOrderTrin(session, options),
            ),
            options,
          )
        },
        close: async (options) => {
          assertTradingAllowed(options, 'orders.margin.close')
          assertMarginCloseOrderOptions(options)
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseReceptionTrCode(options),
              marginCloseOrderTrin(session, options),
            ),
          )
        },
        estimateCloseSummary: async (options) => {
          assertNoOmitConfirmation(options, 'orders.margin.estimateCloseSummary')
          assertMarginCloseOrderOptions(options)
          return parseOrderPreview(
            await callMts(
              session,
              marginCloseConfirmTrCode(options),
              marginCloseOrderTrin(session, options),
            ),
            options,
          )
        },
        closeSummary: async (options) => {
          assertTradingAllowed(options, 'orders.margin.closeSummary')
          assertMarginCloseOrderOptions(options)
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseReceptionTrCode(options),
              marginCloseOrderTrin(session, options),
            ),
          )
        },
        estimateSummary: async (options) => {
          assertNoOmitConfirmation(options, 'orders.margin.estimateSummary')
          assertMarginCloseSummaryOrderOptions(options)
          return parseOrderPreview(
            await callMts(
              session,
              marginCloseSummaryConfirmTrCode(options),
              marginCloseSummaryOrderTrin(session, options),
            ),
            options,
          )
        },
        placeSummary: async (options) => {
          assertTradingAllowed(options, 'orders.margin.placeSummary')
          assertMarginCloseSummaryOrderOptions(options)
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseSummaryReceptionTrCode(options),
              marginCloseSummaryOrderTrin(session, options),
            ),
          )
        },
        preOrderActualDelivery: async (options) =>
          parseStockOrderPreOrder(
            await callMts(
              session,
              stockPreOrderTrCode(options.kind, actualDeliverySide(options)),
              stockPreOrderTrin(session, options, options.kind),
            ),
            options,
          ),
        estimateActualDelivery: async (options) => {
          assertNoOmitConfirmation(options, 'orders.margin.estimateActualDelivery')
          assertActualDeliveryOrderOptions(options)
          return parseOrderPreview(
            await callMts(
              session,
              actualDeliveryConfirmTrCode(options),
              actualDeliveryOrderTrin(session, options),
            ),
            { ...options, side: actualDeliverySide(options) },
          )
        },
        actualDelivery: async (options) => {
          assertTradingAllowed(options, 'orders.margin.actualDelivery')
          assertActualDeliveryOrderOptions(options)
          return parseOrderReceipt(
            await callMts(
              session,
              actualDeliveryReceptionTrCode(options),
              actualDeliveryOrderTrin(session, options),
            ),
          )
        },
      },
      ifd: {
        estimate: async (options) => {
          assertNoOmitConfirmation(options, 'orders.ifd.estimate')
          assertIfdOrderOptions(options)
          return parseOrderPreview(
            await callMtsReturningHeaderError(
              session,
              ifdConfirmTrCode(options),
              ifdOrderTrin(session, options),
            ),
            options,
          )
        },
        place: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.place')
          assertIfdOrderOptions(options)
          return parseOrderReceipt(
            await callMtsReturningHeaderError(
              session,
              ifdReceptionTrCode(options),
              ifdOrderTrin(session, options),
            ),
          )
        },
        estimateCorrection: async (options) =>
          parseOrderPreview(
            await callMts(session, 'F2331', orderIfdCorrectionSubmitTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        placeCorrection: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.placeCorrection')
          return parseOrderReceipt(
            await callMts(session, 'F2332', orderIfdCorrectionSubmitTrin(session, options)),
          )
        },
        estimateCancel: async (options) => {
          assertOrderCancelOptions(options)
          return parseOrderPreview(
            await callMts(session, 'F2311', orderCancelPreOrderTrin(session, options)),
            cashCorrectionPreviewInput,
          )
        },
        placeCancel: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.placeCancel')
          assertPlaceOrderCancelOptions(session, options, 'orders.ifd.placeCancel')
          const preview = parseOrderCorrectionPreOrder(
            await callMts(session, 'F2311', orderCancelPreOrderTrin(session, options)),
            cashCorrectionPreviewInput,
          )
          return parseOrderReceipt(
            await callMts(
              session,
              'F2304',
              orderCancelSubmitTrin(session, {
                ...options,
                orderNumber: preview.correction?.orderNumber ?? options.orderNumber,
                tradeId: preview.correction?.tradeId ?? options.tradeId,
              }),
            ),
          )
        },
      },
      themeInvestment: {
        list: async (options) => {
          assertThemeInvestmentPreOrderOptions(options)
          return parseThemeInvestmentList(
            await callMts(session, 'F1750', themePreOrderTrin(session, options)),
            options,
          )
        },
        estimate: async (options) => {
          assertThemeInvestmentOrderOptions(session, options)
          return parseThemeOrderPreview(
            await callMts(session, 'F1904', themeOrderTrin(session, options)),
            options,
          )
        },
        place: async (options) => {
          assertThemeInvestmentOrderOptions(session, options)
          assertTradingAllowed(options, 'orders.themeInvestment.place')
          return parseOrderReceipt(
            await callMts(session, 'F1905', themeOrderTrin(session, options)),
          )
        },
      },
      exchange: {
        rate: async (options) => fetchExchangeRate(session, options),
        estimate: async (options) => estimateExchangeOrder(session, options),
        place: async (options) => {
          assertTradingAllowed(options, 'orders.exchange.place')
          return placeExchangeOrder(session, options)
        },
      },
    },
  }
  return client
}

const callMts = async (session: SbiSession, trCode: string, trin = ''): Promise<MtsResponse> => {
  return callMtsInternal(session, trCode, trin, true)
}

const callMtsReturningHeaderError = async (session: SbiSession, trCode: string, trin = '') =>
  callMtsInternal(session, trCode, trin, false)

const callIssueSearch = async (
  session: SbiSession,
  path: string,
  queryParam: 'inputWord' | 'term',
  options: IssueSearchOptions,
): Promise<IssueSearchResult> => {
  const query = options.query.trim()
  if (!query) throw new Error('issue search query is required')

  if (!session.izanagiBaseUrl) throw new Error('SBI_IZANAGI_BASE_URL is required')

  const requestUrl = new URL(path, session.izanagiBaseUrl)
  for (const [key, value] of Object.entries(izanagiCommonParams(session))) {
    requestUrl.searchParams.set(key, value)
  }
  requestUrl.searchParams.set(queryParam, query)

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'okhttp/4.12.0',
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`issue search request failed: ${response.status}`)
  }

  const json = JSON.parse(text) as IzanagiIssueSearchResponse
  return parseIssueSearchResponse(json, options)
}

const izanagiCommonParams = (session: SbiSession): Record<string, string> => {
  const butenCode = session.profile.butenCode ?? ''
  const accountNumber = session.profile.accountNumber ?? ''
  const id = sha256Hex(`${butenCode}-${accountNumber}`)
  return {
    id,
    hash: sha256Hex(id + IZANAGI_HASH_SEEDS.join('')),
    channel: '7',
    charset: 'U',
  }
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const parseIssueSearchResponse = (
  response: IzanagiIssueSearchResponse,
  options: IssueSearchOptions,
): IssueSearchResult => {
  const market = options.market
  const limit = options.limit
  let issues = (response.stocks ?? [])
    .map(toIssueSearchItem)
    .filter((issue): issue is IssueSearchItem => Boolean(issue))

  if (market) issues = issues.filter((issue) => issue.market === market)
  if (limit !== undefined) issues = issues.slice(0, limit)

  return {
    status: emptyJsonString(response.status),
    statusText: issueSearchStatus(response.status),
    issues,
  }
}

const toIssueSearchItem = (item: IzanagiIssueSearchItem): IssueSearchItem | undefined => {
  const code = emptyJsonString(item.stockCode)
  if (!code) return undefined

  return {
    code,
    market: publicDomesticMarket(emptyJsonString(item.mkt), 'market.issue.search'),
    name: emptyJsonString(item.stockName),
    extract: emptyJsonString(item.extract),
    extractWord: emptyJsonString(item.extractWord),
    boldFrom: emptyJsonString(item.boldFrom),
    boldTo: emptyJsonString(item.boldTo),
    hitString: emptyJsonString(item.hitString),
  }
}

const emptyJsonString = (value?: string | null) => emptyToUndefined(value ?? undefined)

const issueSearchStatus = (status?: string | null): IssueSearchStatus => {
  if (status === '0') return 'success'
  if (status === '2') return 'searchError'
  if (status === '4') return 'tooManyResults'
  return 'unknown'
}

const fetchAccountPower = async (
  session: SbiSession,
  options?: AccountPowerOptions,
): Promise<BuyingPower> => {
  if (options?.includeMarginAccount) {
    return parseCollateralRatio(
      await callMtsReturningHeaderError(session, 'F2611', accountTrin(session)),
    )
  }
  return parseAccountPower(
    await callMtsReturningHeaderError(session, 'F2609', accountPowerTrin(session)),
  )
}

const fetchExchangeRate = async (
  session: SbiSession,
  options: ExchangeRateOptions,
): Promise<ExchangeRateInfo> => {
  assertExchangeRateOptions(options)
  const auth = await ensureMainSiteAuth(session)
  const requestUrl = new URL('/exchange/api/order/input/rate', auth.assetsUrl)
  requestUrl.searchParams.set('currencyCode', options.currencyCode)
  requestUrl.searchParams.set('buySellCode', exchangeBuySellCode(options.side))
  const response = await fetch(requestUrl, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: auth.cookieHeader,
      referer: new URL('/exchange/order/input', auth.assetsUrl).toString(),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`exchange rate request failed with HTTP ${response.status}: ${text}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('exchange rate request returned non-JSON response')
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('exchange rate response was not valid JSON')
  }
  return parseExchangeRateInfo(body, options)
}

const estimateExchangeOrder = async (
  session: SbiSession,
  options: ExchangeOrderOptions,
): Promise<ExchangeOrderPreview> => {
  return prepareExchangeOrder(session, options)
}

const placeExchangeOrder = async (
  session: SbiSession,
  options: PlaceExchangeOrderOptions,
): Promise<ExchangeOrderReceipt> => {
  const preview = await prepareExchangeOrder(session, options)
  const auth = await ensureMainSiteAuth(session)
  const completePath = requiredMainSitePath(session, 'exchangeOrderCompletePath')
  const response = await fetch(new URL(completePath, auth.assetsUrl), {
    method: 'POST',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: auth.cookieHeader,
      referer: new URL(
        requiredMainSitePath(session, 'exchangeOrderConfirmPath'),
        auth.assetsUrl,
      ).toString(),
    },
    body: new URLSearchParams(exchangeCompleteForm(preview)),
    redirect: 'manual',
  })
  const html = await response.text()
  if (!response.ok) {
    throw new Error(`exchange order complete request failed with HTTP ${response.status}: ${html}`)
  }
  return parseExchangeOrderReceipt(html, preview)
}

const prepareExchangeOrder = async (
  session: SbiSession,
  options: ExchangeOrderOptions,
): Promise<ExchangeOrderPreview> => {
  assertExchangeOrderOptions(session, options)
  const auth = await ensureMainSiteAuth(session)
  const inputPath = requiredMainSitePath(session, 'exchangeOrderInputPath')
  const inputUrl = new URL(inputPath, auth.assetsUrl)
  inputUrl.searchParams.set('currencyCode', options.currencyCode)
  inputUrl.searchParams.set('buySellCode', exchangeBuySellCode(options.side))

  const inputResponse = await fetch(inputUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      cookie: auth.cookieHeader,
      referer: auth.assetsUrl,
    },
  })
  const inputHtml = await inputResponse.text()
  if (!inputResponse.ok) {
    throw new Error(`exchange order input request failed with HTTP ${inputResponse.status}`)
  }
  const csrfToken = csrfTokenFromHtml(inputHtml)
  const tradePassword = options.tradePassword ?? session.tradePassword
  if (!tradePassword)
    throw new Error('orders.exchange requires tradePassword in options or session')

  const passwordPath = requiredMainSitePath(session, 'exchangeOrderPasswordPath')
  const passwordResponse = await fetch(new URL(passwordPath, auth.assetsUrl), {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      cookie: auth.cookieHeader,
      origin: new URL(auth.assetsUrl).origin,
      referer: inputUrl.toString(),
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ tradePassword }),
  })
  const passwordText = await passwordResponse.text()
  if (!passwordResponse.ok) {
    throw new Error(
      `exchange trade password check failed with HTTP ${passwordResponse.status}: ${passwordText}`,
    )
  }

  const confirmPath = requiredMainSitePath(session, 'exchangeOrderConfirmPath')
  const confirmResponse = await fetch(new URL(confirmPath, auth.assetsUrl), {
    method: 'POST',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: auth.cookieHeader,
      origin: new URL(auth.assetsUrl).origin,
      referer: inputUrl.toString(),
    },
    body: new URLSearchParams(exchangeConfirmForm(options, tradePassword, csrfToken)),
  })
  const confirmHtml = await confirmResponse.text()
  if (!confirmResponse.ok) {
    throw new Error(`exchange order confirm request failed with HTTP ${confirmResponse.status}`)
  }
  return parseExchangeOrderPreview(confirmHtml, csrfToken)
}

type MainSitePathKey =
  | 'exchangeOrderInputPath'
  | 'exchangeOrderPasswordPath'
  | 'exchangeOrderConfirmPath'
  | 'exchangeOrderCompletePath'
  | 'etGatePath'
  | 'assetsValuationsPath'

const requiredMainSitePath = (session: SbiSession, key: MainSitePathKey) => {
  const value = session.mainSite?.[key]
  if (typeof value === 'string' && value) return value
  const envName =
    {
      exchangeOrderInputPath: 'SBI_MAIN_SITE_EXCHANGE_ORDER_INPUT_PATH',
      exchangeOrderPasswordPath: 'SBI_MAIN_SITE_EXCHANGE_ORDER_PASSWORD_PATH',
      exchangeOrderConfirmPath: 'SBI_MAIN_SITE_EXCHANGE_ORDER_CONFIRM_PATH',
      exchangeOrderCompletePath: 'SBI_MAIN_SITE_EXCHANGE_ORDER_COMPLETE_PATH',
      etGatePath: 'SBI_MAIN_SITE_ET_GATE_PATH',
      assetsValuationsPath: 'SBI_MAIN_SITE_ASSETS_VALUATIONS_PATH',
    }[key] ?? `SBI main-site path ${String(key)}`
  throw new Error(`${envName} is required`)
}

const assertExchangeOrderOptions = (session: SbiSession, options: ExchangeOrderOptions) => {
  if (!options.currencyCode.trim()) throw new Error('currencyCode is required')
  if (options.side !== 'buy' && options.side !== 'sell') throw new Error('side must be buy or sell')
  if (!String(options.tradeQuantity).trim()) throw new Error('tradeQuantity is required')
  const specificMethod = options.specificMethod ?? 'foreign'
  if (specificMethod !== 'foreign' && specificMethod !== 'domestic') {
    throw new Error('specificMethod must be foreign or domestic')
  }
  if (specificMethod === 'domestic' && options.orderAmount == null) {
    throw new Error('domestic exchange orders require orderAmount')
  }
  if (options.side === 'sell' && !options.sellMethod) {
    throw new Error('sell exchange orders require sellMethod')
  }
  if (!options.tradePassword && !session.tradePassword) {
    throw new Error('orders.exchange requires tradePassword in options or session')
  }
}

const assertExchangeRateOptions = (options: ExchangeRateOptions) => {
  if (!options.currencyCode.trim()) throw new Error('currencyCode is required')
  if (options.side !== 'buy' && options.side !== 'sell') throw new Error('side must be buy or sell')
}

const parseExchangeRateInfo = (body: unknown, options: ExchangeRateOptions): ExchangeRateInfo => {
  const raw = record(body, 'exchange rate response')
  return {
    currencyCode: stringValue(raw.currencyCode) || options.currencyCode,
    side: raw.buySellCode ? exchangeSide(stringValue(raw.buySellCode)) : options.side,
    referenceExchangeRate: emptyToUndefined(stringValue(raw.referenceExchangeRate)),
    computeExchangeRate: emptyToUndefined(stringValue(raw.computeExchangeRate)),
    basePrice: emptyToUndefined(stringValue(raw.basePrice)),
    exchangeTradeType: emptyToUndefined(stringValue(raw.exchangeTradeType)),
    updateTime: emptyToUndefined(stringValue(raw.updateTime)),
    buyPossibleAmount: emptyToUndefined(stringValue(raw.buyPossibleAmount)),
    sellPossibleAmount: emptyToUndefined(stringValue(raw.sellPossibleAmount)),
    buyUnit: emptyToUndefined(stringValue(raw.buyUnit)),
    sellUnit: emptyToUndefined(stringValue(raw.sellUnit)),
    buyLimitMin: emptyToUndefined(stringValue(raw.buyLimitMin)),
    buyLimitMax: emptyToUndefined(stringValue(raw.buyLimitMax)),
    sellLimitMin: emptyToUndefined(stringValue(raw.sellLimitMin)),
    sellLimitMax: emptyToUndefined(stringValue(raw.sellLimitMax)),
    raw,
  }
}

const exchangeConfirmForm = (
  options: ExchangeOrderOptions,
  tradePassword: string,
  csrfToken: string,
) => {
  const form: Record<string, string> = {
    specificMethod: options.specificMethod ?? 'foreign',
    tradeQuantity: String(options.tradeQuantity),
    tradePassword,
    currencyCode: options.currencyCode,
    buySellCode: exchangeBuySellCode(options.side),
    accountKind: options.accountKind ?? 'GENERAL',
    orderAmount: String(options.orderAmount ?? options.tradeQuantity),
    _csrf: csrfToken,
  }
  if (options.side === 'sell' && options.sellMethod) form.sellMethod = options.sellMethod
  return form
}

const exchangeCompleteForm = (preview: ExchangeOrderPreview) => {
  const form: Record<string, string> = {
    currencyCode: preview.currencyCode,
    buySell: exchangeBuySellCode(preview.side),
    accountKind: preview.accountKind ?? 'GENERAL',
    orderAmount: preview.orderAmount ?? '',
    showAccount: 'false',
    specificMethod: preview.specificMethod ?? 'foreign',
    tradeQuantity: preview.tradeQuantity ?? '',
    _csrf: preview.csrfToken,
  }
  if (preview.side === 'sell' && preview.sellMethod) form.sellMethod = preview.sellMethod
  return form
}

const parseExchangeOrderPreview = (html: string, csrfToken: string): ExchangeOrderPreview => {
  const data = initDataFromHtml(html)
  const currencyCode = stringValue(data.currencyCode)
  const buySellCode = stringValue(data.buySellCode)
  if (!currencyCode || !buySellCode) {
    const errorMessage = stringValue(data.errorMessage) || textFromTitle(html)
    throw new Error(`exchange order confirm response did not include order data: ${errorMessage}`)
  }
  return {
    currencyCode,
    currencyName: emptyToUndefined(stringValue(data.currencyName)),
    side: exchangeSide(buySellCode),
    exchangeType: emptyToUndefined(stringValue(data.exchangeType)),
    accountKind: exchangeAccountKind(data.accountKind),
    specificMethod: exchangeSpecificMethod(data.specificMethod),
    sellMethod: exchangeSellMethod(data.sellMethod),
    tradeQuantity: emptyToUndefined(stringValue(data.tradeQuantity)),
    orderAmount: emptyToUndefined(stringValue(data.orderAmount)),
    exchangeRate: emptyToUndefined(stringValue(data.exchangeRate)),
    netAmount: emptyToUndefined(stringValue(data.netAmount)),
    valueDate: emptyToUndefined(stringValue(data.valueDate)),
    rateDateTime: emptyToUndefined(stringValue(data.rateDateTime)),
    warningMessage: data.warningMessage == null ? null : stringValue(data.warningMessage),
    isMaintenance: data.isMaintenance === true,
    csrfToken,
  }
}

const parseExchangeOrderReceipt = (
  html: string,
  preview: ExchangeOrderPreview,
): ExchangeOrderReceipt => {
  const data = initDataFromHtml(html, false)
  const errorMessage = stringValue(data.errorMessage)
  const warningMessage = data.warningMessage == null ? null : stringValue(data.warningMessage)
  return {
    accepted: !errorMessage,
    currencyCode: stringValue(data.currencyCode) || preview.currencyCode,
    side: data.buySellCode ? exchangeSide(stringValue(data.buySellCode)) : preview.side,
    message: errorMessage || stringValue(data.message) || textFromTitle(html),
    warningMessage,
    rawTitle: textFromTitle(html),
  }
}

const initDataFromHtml = (html: string, required = true): Record<string, unknown> => {
  const match = html.match(/var\s+INIT_DATA\s*=\s*(\{.*?\});/s)
  if (!match?.[1]) {
    if (!required) return {}
    throw new Error('main site exchange response did not include INIT_DATA')
  }
  try {
    const data = JSON.parse(match[1])
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  } catch {
    throw new Error('main site exchange INIT_DATA was not valid JSON')
  }
}

const csrfTokenFromHtml = (html: string) => {
  const token = html.match(/<meta\s+name=["']_csrf["']\s+content=["']([^"']+)/i)?.[1]
  if (!token) throw new Error('main site exchange input response did not include CSRF token')
  return decodeHtmlAttribute(token)
}

const textFromTitle = (html: string) =>
  html
    .match(/<title>(.*?)<\/title>/is)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim()

const exchangeBuySellCode = (side: ExchangeOrderSide) => (side === 'buy' ? 'BUY' : 'SELL')

const exchangeSide = (buySellCode: string): ExchangeOrderSide => {
  if (buySellCode === 'BUY') return 'buy'
  if (buySellCode === 'SELL') return 'sell'
  throw new Error(`unsupported exchange buySellCode: ${buySellCode}`)
}

const exchangeAccountKind = (value: unknown) => {
  if (value === 'GENERAL' || value === 'JR_NISA') return value
  return undefined
}

const exchangeSpecificMethod = (value: unknown) => {
  if (value === 'foreign' || value === 'domestic') return value
  return undefined
}

const exchangeSellMethod = (value: unknown) => {
  if (value === 'SELL_PART' || value === 'SELL_ALL') return value
  return null
}

const stringValue = (value: unknown) => (value == null ? '' : String(value))

const fetchCurrentAccountAssets = async (
  session: SbiSession,
  retryWithFreshAuth = true,
): Promise<AccountAssetsValuations> => {
  const auth = await ensureMainSiteAuth(session)
  const valuationsPath = session.mainSite?.assetsValuationsPath
  if (!valuationsPath) throw new Error('SBI_MAIN_SITE_ASSETS_VALUATIONS_PATH is required')
  const requestUrl = new URL(valuationsPath, auth.assetsUrl)
  const response = await fetch(requestUrl, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: auth.cookieHeader,
      referer: auth.assetsUrl,
    },
  })
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''

  if ((!response.ok || !contentType.includes('application/json')) && retryWithFreshAuth) {
    if (session.mainSite) session.mainSite.auth = undefined
    return fetchCurrentAccountAssets(session, false)
  }
  if (!response.ok) {
    throw new Error(
      `main site assets valuation request failed with HTTP ${response.status}: ${text}`,
    )
  }
  if (!contentType.includes('application/json')) {
    throw new Error('main site assets valuation request returned non-JSON response')
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('main site assets valuation response was not valid JSON')
  }
  return parseAccountAssetsValuations(body)
}

const ensureMainSiteAuth = async (session: SbiSession): Promise<MainSiteAuthCache> => {
  const mainSite = (session.mainSite ??= {})
  const cached = mainSite.auth
  if (cached && Date.now() - Date.parse(cached.authenticatedAt) < MAIN_SITE_AUTH_CACHE_TTL_MS) {
    return cached
  }
  if (mainSite.authPromise) return mainSite.authPromise

  mainSite.authPromise = createMainSiteAuth(session)
    .then((auth) => {
      mainSite.auth = auth
      return auth
    })
    .finally(() => {
      mainSite.authPromise = undefined
    })
  return mainSite.authPromise
}

const createMainSiteAuth = async (session: SbiSession): Promise<MainSiteAuthCache> => {
  const mainSite = session.mainSite
  const baseUrl = mainSite?.baseUrl
  if (!baseUrl) throw new Error('SBI_MAIN_SITE_BASE_URL is required')
  const etGatePath = mainSite.etGatePath
  if (!etGatePath) throw new Error('SBI_MAIN_SITE_ET_GATE_PATH is required')

  const jar = new Map<string, string>()
  const siteLinkParam = await fetchMainSiteLinkParam(session)
  const etGateUrl = new URL(etGatePath, baseUrl)
  for (const [key, value] of Object.entries(mainSiteAssetLoginParams(siteLinkParam))) {
    etGateUrl.searchParams.set(key, value)
  }

  const etGateResponse = await fetch(etGateUrl, {
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'manual',
  })
  updateCookieJar(jar, etGateResponse)
  const etGateHtml = decodeShiftJis(Buffer.from(await etGateResponse.arrayBuffer()))
  if (!etGateResponse.ok) {
    throw new Error(`main site ETGate request failed with HTTP ${etGateResponse.status}`)
  }
  const form = parseHtmlForm(etGateHtml, etGateUrl)

  const switchResponse = await fetch(form.action, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      referer: etGateUrl.toString(),
    },
    body: new URLSearchParams(form.fields),
    redirect: 'manual',
  })
  updateCookieJar(jar, switchResponse)
  const ssoUrl = responseLocationUrl(switchResponse, form.action)

  const ssoResponse = await fetch(ssoUrl, {
    headers: { cookie: cookieHeader(jar), referer: form.action.toString() },
    redirect: 'manual',
  })
  updateCookieJar(jar, ssoResponse)
  const assetsUrl = responseLocationUrl(ssoResponse, ssoUrl)

  const assetsResponse = await fetch(assetsUrl, {
    headers: { cookie: cookieHeader(jar), referer: ssoUrl.toString() },
    redirect: 'manual',
  })
  updateCookieJar(jar, assetsResponse)
  if (!assetsResponse.ok) {
    throw new Error(`main site assets page request failed with HTTP ${assetsResponse.status}`)
  }

  return {
    baseUrl,
    assetsUrl: assetsUrl.toString(),
    cookieHeader: cookieHeader(jar),
    authenticatedAt: new Date().toISOString(),
  }
}

const fetchMainSiteLinkParam = async (session: SbiSession) => {
  const response = await callMts(session, 'F1132', accountTrin(session))
  const urlParam = readShiftJisField(response.buffer, MTS_HEADER_BYTES, 1000)
  if (!urlParam) throw new Error('F1132 did not return a main site link parameter')
  return urlParam
}

const mainSiteAssetLoginParams = (siteLinkParam: string) => ({
  _ControlID: 'WPLETlgR001Control',
  _PageID: 'WPLETlgR001Rlgn20',
  _DataStoreID: 'DSWPLETlgR001Control',
  _ActionID: 'NoActionID',
  _ReturnPageInfo: 'WPLETsmR001Control/WPLETsmR001Sdtl18/NoActionID/DSWPLETsmR001Control',
  getFlg: 'on',
  sw_param1: 'account',
  sw_param2: 'assets',
  OutSide: 'on',
  page_from: '3',
  allPrmFlg: 'on',
  ACT_login: '',
  RSW: siteLinkParam,
})

const responseLocationUrl = (response: Response, baseUrl: URL) => {
  const location = response.headers.get('location')
  if (!location) {
    throw new Error(`main site expected redirect but got HTTP ${response.status}`)
  }
  return new URL(location, baseUrl)
}

const parseHtmlForm = (html: string, baseUrl: URL) => {
  const formMatch = html.match(/<form\b[^>]*>/i)
  if (!formMatch) throw new Error('main site ETGate response did not include a form')
  const action = attributeValue(formMatch[0], 'action')
  if (!action) throw new Error('main site ETGate form did not include an action')

  const fields: Array<[string, string]> = []
  for (const inputMatch of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attributeValue(inputMatch[0], 'name')
    if (!name) continue
    fields.push([name, attributeValue(inputMatch[0], 'value') ?? ''])
  }
  if (!fields.length) throw new Error('main site ETGate form did not include fields')
  return { action: new URL(action, baseUrl), fields }
}

const attributeValue = (tag: string, name: string) => {
  const pattern = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(pattern)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value === undefined ? undefined : decodeHtmlAttribute(value)
}

const decodeHtmlAttribute = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const updateCookieJar = (jar: Map<string, string>, response: Response) => {
  for (const header of setCookieHeaders(response.headers)) {
    const nameValue = header.split(';', 1)[0]
    if (!nameValue) continue
    const separator = nameValue.indexOf('=')
    if (separator <= 0) continue
    jar.set(nameValue.slice(0, separator), nameValue.slice(separator + 1))
  }
}

const setCookieHeaders = (headers: Headers) => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const values = withGetSetCookie.getSetCookie?.()
  if (values?.length) return values
  const header = headers.get('set-cookie')
  if (!header) return []
  return header.split(/,(?=\s*[^;,]+=)/g)
}

const cookieHeader = (jar: Map<string, string>) =>
  [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

const parseAccountAssetsValuations = (body: unknown): AccountAssetsValuations => {
  const object = record(body, 'main site assets valuation response')
  return {
    fetchedAt: new Date().toISOString(),
    summary: parseAccountAssetsValuationSummary(object.summary, 'summary'),
    summaryWithoutDeposit: parseAccountAssetsValuationSummary(
      object.summaryWithoutDeposit,
      'summaryWithoutDeposit',
    ),
    summaryWithoutIdeco: optionalAccountAssetsValuationSummary(
      object.summaryWithoutIdeco,
      'summaryWithoutIdeco',
    ),
    summaryWithoutDepositAndIdeco: optionalAccountAssetsValuationSummary(
      object.summaryWithoutDepositAndIdeco,
      'summaryWithoutDepositAndIdeco',
    ),
    summaryDetails: parseAccountAssetsValuationDetails(object.summaryDetails, 'summaryDetails'),
    summaryDetailsWithoutDeposit: parseAccountAssetsValuationDetails(
      object.summaryDetailsWithoutDeposit,
      'summaryDetailsWithoutDeposit',
    ),
    summaryDetailsWithoutIdeco: parseAccountAssetsValuationDetails(
      object.summaryDetailsWithoutIdeco,
      'summaryDetailsWithoutIdeco',
    ),
    summaryDetailsWithoutDepositAndIdeco: parseAccountAssetsValuationDetails(
      object.summaryDetailsWithoutDepositAndIdeco,
      'summaryDetailsWithoutDepositAndIdeco',
    ),
  }
}

const optionalAccountAssetsValuationSummary = (value: unknown, label: string) =>
  value == null ? undefined : parseAccountAssetsValuationSummary(value, label)

const parseAccountAssetsValuationSummary = (
  value: unknown,
  label: string,
): AccountAssetsValuationSummary => {
  const object = record(value, label)
  return {
    assetsErrorType: object.assetsErrorType ?? null,
    valuation: nullableJsonNumber(object.valuation, `${label}.valuation`),
    netChange: nullableJsonNumber(object.netChange, `${label}.netChange`),
    percentChange: nullableJsonNumber(object.percentChange, `${label}.percentChange`),
    monthOnMonth: nullableJsonNumber(object.monthOnMonth, `${label}.monthOnMonth`),
    monthOnMonthRatio: object.monthOnMonthRatio ?? null,
    profitLoss: nullableJsonNumber(object.profitLoss, `${label}.profitLoss`),
    profitLossRate: nullableJsonNumber(object.profitLossRate, `${label}.profitLossRate`),
    acquisitionCost: nullableJsonNumber(object.acquisitionCost, `${label}.acquisitionCost`),
  }
}

const parseAccountAssetsValuationDetails = (
  value: unknown,
  label: string,
): AccountAssetsValuationDetail[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => {
    const object = record(item, `${label}[${index}]`)
    return {
      ...parseAccountAssetsValuationSummary(object, `${label}[${index}]`),
      category: typeof object.category === 'string' ? object.category : '',
      compositionRatio: nullableJsonNumber(
        object.compositionRatio,
        `${label}[${index}].compositionRatio`,
      ),
    }
  })
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const nullableJsonNumber = (value: unknown, label: string) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const callMtsInternal = async (
  session: SbiSession,
  trCode: string,
  trin: string,
  throwOnHeaderError: boolean,
): Promise<MtsResponse> => {
  const requestUrl = new URL(COMM_GATE_PATH, session.mtsBaseUrl)
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'okhttp/4.12.0',
    },
    body: encodeMtsForm({
      SID: session.profile.session.sessionId,
      TRCODE: trCode,
      FSTIME: '         ',
      TRIN: trin,
    }),
  })
  const body = await response.arrayBuffer()
  const buffer = Buffer.from(body)
  const text = decodeShiftJis(buffer)
  const header = parseMtsHeader(buffer)
  if (header.sessionId) session.profile.session.sessionId = header.sessionId
  if (header.trCode && header.trCode !== trCode) {
    throw new Error(`unexpected MTS TRCODE: expected ${trCode}, got ${header.trCode}`)
  }
  if (throwOnHeaderError) throwIfMtsHeaderError(header, requestUrl.toString())
  return {
    status: response.status,
    requestUrl: requestUrl.toString(),
    header,
    buffer,
    text,
  }
}

const parseMtsHeader = (buffer: Buffer): MtsHeader => {
  let offset = 6
  const sessionId = readShiftJisField(buffer, offset, 28)
  offset += 28
  const trCode = readShiftJisField(buffer, offset, 5)
  offset += 5
  offset += 6
  const resultCode = readShiftJisField(buffer, offset, 6)
  offset += 6
  const notification = readShiftJisField(buffer, offset, 1)
  offset += 1
  const lastExecutionTime = readShiftJisField(buffer, offset, 9)
  offset += 9
  const maintenance = readShiftJisField(buffer, offset, 5)
  return { sessionId, trCode, resultCode, notification, lastExecutionTime, maintenance }
}

const parseCollateralRatio = (response: MtsResponse): BuyingPower => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { records: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(18)
  reader.skip(1)
  const noticeMessage = reader.text(300)
  const recordCount = reader.int(2) ?? 0
  const records = Array.from({ length: recordCount }, () => ({
    marginRequirements: yen(reader.text(9)),
    referenceMarginRequirements: (reader.skip(1), yen(reader.text(9))),
    collateralRatioCash: (reader.skip(1), yen(reader.text(17))),
    substituteSecuritiesValuationAmount: yen(reader.text(17)),
    unsettledPositionLoss: signed(reader.text(17), reader.text(1)),
    unsettledPositionLossFlag: lastReadFlag(reader),
    settlementLoss: signed(reader.text(17), reader.text(1)),
    settlementLossFlag: lastReadFlag(reader),
    paymentExpenses: signed(reader.text(17), reader.text(1)),
    paymentExpensesFlag: lastReadFlag(reader),
    actualCollateral: yen(reader.text(17)),
    positionAmount: yen(reader.text(17)),
    sbiHybridDepositBalance: yen(reader.text(17)),
    minimumCollateral: (reader.skip(1), yen(reader.text(17))),
  }))
  const error = parseTrailingError(reader, response)
  const first = records[0]
  return {
    noticeMessage: emptyToUndefined(noticeMessage),
    records,
    cashBuyingPower: first?.collateralRatioCash,
    marginBuyingPower: first?.actualCollateral,
    collateralValue: first?.substituteSecuritiesValuationAmount,
    collateralRatio: first?.collateralRatioCash
      ? percent(first.collateralRatioCash.text)
      : undefined,
    sbiHybridDepositBalance: first?.sbiHybridDepositBalance,
    error,
  }
}

const parseAccountPower = (response: MtsResponse): BuyingPower => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { records: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(12)
  const marginCallFlag = reader.text(1)
  const marginCallMessage = reader.text(1500)
  const cashBuyingPower = yen(reader.text(17))
  const marginBuyingPower = yen(reader.text(17))
  const genbikiAvailableAmount = yen(reader.text(17))
  reader.skip(17)
  const collateralValue = yen(reader.text(17))
  reader.skip(17)
  const actualCollateral = yen(reader.text(17))
  const positionAmount = yen(reader.text(17))
  const marginRequirements = percent(reader.text(9))
  const sbiHybridDepositBalance = yen(reader.text(17))
  reader.skip(9)
  reader.skip(19)
  reader.skip(7)
  reader.skip(7)
  reader.skip(7)
  reader.skip(7)
  reader.skip(7)
  const noticeMessage = reader.text(110)
  reader.skip(1)
  reader.skip(1)
  reader.skip(12)
  reader.skip(6)
  reader.skip(1)
  reader.skip(12)
  reader.skip(6)
  reader.skip(1)
  reader.skip(17)
  reader.skip(1)
  reader.skip(12)
  reader.skip(6)
  reader.skip(12)
  reader.skip(6)
  const error = parseTrailingError(reader, response)
  return {
    cashBuyingPower,
    marginBuyingPower,
    withdrawableAmount: genbikiAvailableAmount,
    collateralValue,
    collateralRatio: marginRequirements,
    sbiHybridDepositBalance,
    noticeMessage: emptyToUndefined(noticeMessage),
    records: [
      { substituteSecuritiesValuationAmount: collateralValue, actualCollateral, positionAmount },
    ],
    error:
      error ?? (marginCallFlag ? { code: marginCallFlag, message: marginCallMessage } : undefined),
  }
}

const parseCashPositions = (
  response: MtsResponse,
  options?: CashPositionOptions,
): CashPositionList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { positions: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(12)
  reader.skip(12)
  const index = reader.int(3)
  const totalCount = reader.int(3)
  const recordCount = reader.int(4) ?? 0
  const positions: CashPosition[] = []
  for (let i = 0; i < recordCount; i++) {
    const code = reader.text(5)
    const market = reader.text(3)
    const issueName = reader.text(40)
    const depositTypeCode = reader.text(1)
    const depositTypeText = reader.text(8)
    const quantityText = reader.text(16)
    const unactualyQuantity = reader.text(18)
    const profitLossText = reader.text(16)
    const profitLossRateText = reader.text(11)
    const profitLossFlag = reader.text(1)
    const priceText = reader.text(11)
    reader.skip(11)
    const presentValueFlag = reader.text(1)
    reader.skip(30)
    reader.skip(1)
    reader.skip(2)
    reader.skip(5)
    reader.skip(25)
    reader.skip(11)
    reader.skip(8)
    reader.skip(8)
    reader.skip(1)
    reader.skip(9)
    reader.skip(21)
    reader.skip(36)
    const purchasePriceText = reader.text(16)
    const valuationPriceText = reader.text(15)
    reader.skip(30)
    const valuationPriceChangeText = reader.text(30)
    const valuationPriceChangeFlag = reader.text(1)
    reader.skip(1)
    reader.skip(1)
    const holdingCategory = reader.text(4)
    reader.skip(6)
    const accountInformation = reader.text(20)

    const marketValue = yen(valuationPriceText)
    const position: CashPosition = {
      issue: {
        code,
        market: publicDomesticMarket(market, 'account.positions.cash'),
        name: extractIssueName(issueName),
      },
      accountType: mapAccountType(depositTypeCode),
      depositType: mapDepositType(depositTypeCode),
      depositTypeCode: emptyToUndefined(depositTypeCode),
      depositTypeText: emptyToUndefined(depositTypeText),
      quantity: parseNumber(quantityText),
      availableQuantity: subtractNullable(
        parseNumber(quantityText),
        parseNumberFromParentheses(unactualyQuantity),
      ),
      unexecutedOrderQuantity: parseNumberFromParentheses(unactualyQuantity),
      averagePrice: yen(purchasePriceText),
      purchasePrice: yen(purchasePriceText),
      currentPrice: yen(priceText),
      priceText: emptyToUndefined(priceText),
      marketValue,
      presentValueFlag: emptyToUndefined(presentValueFlag),
      valuationPrice: yen(valuationPriceText),
      valuationPriceChange: signed(
        beforeParentheses(valuationPriceChangeText),
        valuationPriceChangeFlag,
      ),
      valuationPriceChangeRate: percent(inParentheses(valuationPriceChangeText) ?? ''),
      valuationPriceChangeFlag: emptyToUndefined(valuationPriceChangeFlag),
      profitLoss: signed(profitLossText, profitLossFlag),
      profitLossRate: percent(profitLossRateText),
      profitLossFlag: emptyToUndefined(profitLossFlag),
      holdingCategory: emptyToUndefined(holdingCategory),
      accountInformation: emptyToUndefined(accountInformation),
    }
    positions.push(position)
  }
  const totalProfitLossText = reader.text(17)
  const totalProfitLossRateText = reader.text(11)
  const totalProfitLossFlag = reader.text(1)
  const error = parseTrailingError(reader, response)
  const filtered = filterCashPositions(
    {
      positions,
      index: index ?? undefined,
      totalCount: totalCount ?? undefined,
      totalMarketValue: sumCurrencyAmounts(positions.map((position) => position.marketValue)),
      totalProfitLoss: signed(totalProfitLossText, totalProfitLossFlag),
      totalProfitLossRate: percent(totalProfitLossRateText),
      totalProfitLossFlag: emptyToUndefined(totalProfitLossFlag),
      hasMore:
        totalCount != null && index != null ? index + positions.length < totalCount : undefined,
      error,
    },
    options,
  )
  return filtered
}

const parseMarginPositions = (
  response: MtsResponse,
  options?: MarginPositionOptions,
): MarginPositionList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { positions: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(12)
  reader.skip(12)
  const index = reader.int(3)
  const totalCount = reader.int(3)
  const recordCount = reader.int(4) ?? 0
  const positions: MarginPosition[] = []
  for (let i = 0; i < recordCount; i++) {
    const code = reader.text(5)
    const market = reader.text(3)
    const issueName = reader.text(40)
    const tradeKind = reader.text(1)
    const sideText = reader.text(4)
    const quantityText = reader.text(16)
    const unactualyQuantity = reader.text(18)
    const profitLossText = reader.text(16)
    const profitLossRateText = reader.text(11)
    const profitLossFlag = reader.text(1)
    const rateText = reader.text(12)
    const presentValueText = reader.text(11)
    const presentValueFlag = reader.text(1)
    reader.skip(30)
    reader.skip(1)
    reader.skip(2)
    reader.skip(5)
    reader.skip(25)
    reader.skip(11)
    reader.skip(8)
    reader.skip(8)
    const dueDateCode = reader.text(1)
    const depositTypeText = reader.text(9)
    const dueDateText = reader.text(21)
    reader.skip(36)
    const openAmountText = reader.text(15)
    const valuationPriceText = reader.text(15)
    reader.skip(30)
    const valuationPriceChangeText = reader.text(30)
    const valuationPriceChangeFlag = reader.text(1)
    const costText = reader.text(15)
    const commissionText = reader.text(15)
    const managementFeeText = reader.text(15)
    const nameTransferFeeText = reader.text(15)
    const interestText = reader.text(11)
    const backwardationText = reader.text(11)
    const collateralRatioText = reader.text(15)
    const maybeBargainMarketCode = reader.remaining >= 3 ? reader.text(3) : ''
    const maybeBargainMarket = reader.remaining >= 10 ? reader.text(10) : ''
    positions.push({
      id: `${code}:${market}:${i}`,
      issue: {
        code,
        market: publicDomesticMarket(market, 'account.positions.margin'),
        name: extractIssueName(issueName),
      },
      side: mapSide(tradeKind),
      sideText: emptyToUndefined(sideText),
      tradeKind: emptyToUndefined(tradeKind),
      quantity: parseNumber(quantityText),
      availableCloseQuantity: subtractNullable(
        parseNumber(quantityText),
        parseNumberFromParentheses(unactualyQuantity),
      ),
      unexecutedOrderQuantity: parseNumberFromParentheses(unactualyQuantity),
      openPrice: yen(openAmountText),
      openAmount: yen(openAmountText),
      currentPrice: yen(rateText),
      rate: yen(rateText),
      marketValue: yen(presentValueText),
      presentValueFlag: emptyToUndefined(presentValueFlag),
      valuationPrice: yen(valuationPriceText),
      valuationPriceChange: signed(
        beforeParentheses(valuationPriceChangeText),
        valuationPriceChangeFlag,
      ),
      valuationPriceChangeRate: percent(inParentheses(valuationPriceChangeText) ?? ''),
      valuationPriceChangeFlag: emptyToUndefined(valuationPriceChangeFlag),
      profitLoss: signed(profitLossText, profitLossFlag),
      profitLossRate: percent(profitLossRateText),
      profitLossFlag: emptyToUndefined(profitLossFlag),
      dueDateCode: emptyToUndefined(dueDateCode),
      dueDateText: emptyToUndefined(dueDateText),
      depositTypeText: emptyToUndefined(depositTypeText),
      cost: yen(costText),
      commission: yen(commissionText),
      managementFee: yen(managementFeeText),
      nameTransferFee: yen(nameTransferFeeText),
      interest: yen(interestText),
      backwardation: yen(backwardationText),
      collateralRatio: percent(collateralRatioText),
      bargainMarketCode: emptyToUndefined(maybeBargainMarketCode),
      bargainMarket: emptyToUndefined(maybeBargainMarket),
    })
  }
  const totalProfitLossText = reader.text(16)
  const totalProfitLossRateText = reader.text(11)
  const totalProfitLossFlag = reader.text(1)
  const error = parseTrailingError(reader, response)
  return filterMarginPositions(
    {
      positions,
      index: index ?? undefined,
      totalCount: totalCount ?? undefined,
      totalProfitLoss: signed(totalProfitLossText, totalProfitLossFlag),
      totalProfitLossRate: percent(totalProfitLossRateText),
      totalProfitLossFlag: emptyToUndefined(totalProfitLossFlag),
      hasMore:
        totalCount != null && index != null ? index + positions.length < totalCount : undefined,
      error,
    },
    options,
  )
}

const parseAllowedPrices = (response: MtsResponse, options: IssueOptions): Quote => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { issue: { code: options.issueCode, market: options.market }, error: headerError }
  const reader = readerFor(response)
  const high = reader.text(11)
  const low = reader.text(11)
  reader.skip(1)
  const count = reader.int(10) ?? 0
  const nominalPrices = Array.from({ length: count }, () => yen(reader.text(11)))
  return {
    issue: { code: options.issueCode, market: options.market },
    high: yen(high),
    low: yen(low),
    nominalPrices,
  }
}

const parseMajorIndexes = (response: MtsResponse): MarketIndex[] => {
  if (methodErrorFromHeader(response) || response.buffer.length <= MTS_HEADER_BYTES) return []
  const reader = readerFor(response)
  reader.skip(9)
  reader.skip(6)
  reader.skip(6)
  const count = reader.int(4) ?? 0
  return Array.from({ length: count }, () => {
    reader.skip(1)
    const categoryCode = reader.text(2)
    const code = reader.text(4)
    const name = reader.text(40)
    const timestamp = reader.text(11)
    const valueText = reader.text(23)
    reader.skip(2)
    const changeText = reader.text(12)
    const changeRateText = reader.text(11)
    const colorFlag = reader.text(1)
    reader.skip(1)
    const open = firstColonValue(reader.text(16))
    const high = reader.text(16)
    const low = reader.text(16)
    const previousClose = reader.text(16)
    return {
      code: emptyToUndefined(code),
      categoryCode: emptyToUndefined(categoryCode),
      name,
      value: parseNumber(valueText),
      valueText,
      change: signed(changeText, colorFlag),
      changeRate: percent(changeRateText),
      colorFlag: emptyToUndefined(colorFlag),
      timestamp: emptyToUndefined(timestamp),
      open: yen(open),
      high: yen(high),
      low: yen(low),
      previousClose: yen(previousClose),
    }
  })
}

const parseMarketOverview = (response: MtsResponse): DomesticMarket => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { indexes: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(4)
  reader.skip(6)
  reader.skip(8)
  const count = reader.int(4) ?? 0
  const indexes: MarketIndex[] = []
  for (let i = 0; i < count; i++) {
    const code = reader.text(2)
    const name = reader.text(10)
    const timestamp = reader.text(11)
    const value1 = reader.text(11)
    reader.skip(6)
    const value2 = reader.text(11)
    reader.skip(6)
    reader.skip(8)
    const previousClose = reader.text(35)
    reader.skip(37)
    reader.skip(26)
    const change = reader.text(38)
    const colorFlag = reader.text(1)
    reader.skip(11)
    reader.skip(11)
    reader.skip(11)
    reader.skip(11)
    indexes.push({
      code: emptyToUndefined(code),
      name,
      value: parseNumber(value1) ?? parseNumber(value2),
      valueText: emptyToUndefined(value1) ?? emptyToUndefined(value2),
      change: signed(change, colorFlag),
      colorFlag: emptyToUndefined(colorFlag),
      timestamp: emptyToUndefined(timestamp),
      previousClose: yen(previousClose),
    })
  }
  return { indexes }
}

const parseRanking = (response: MtsResponse, category: string): Ranking => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { category, items: [], error: headerError }
  const reader = readerFor(response)
  const count = safeCount(reader, 4)
  const items: RankingItem[] = []
  for (let i = 0; i < count && reader.remaining >= 20; i++) {
    const rankText = reader.text(3)
    const code = reader.text(5)
    const market = reader.text(3)
    const name = reader.text(20)
    const exchangeName = reader.remaining >= 9 ? reader.text(9) : ''
    const values = Array.from({ length: 6 }, () => (reader.remaining >= 15 ? reader.text(15) : ''))
    const colorFlag = reader.remaining >= 1 ? reader.text(1) : ''
    items.push({
      rank: parseNumber(rankText) ?? i + 1,
      issue: {
        code,
        market: publicDomesticMarket(market, 'market.ranking.market'),
        name: emptyToUndefined(name),
      },
      value: parseNumber(values[0] ?? '') ?? emptyToUndefined(values[0] ?? ''),
      values: values.map((value) => parseNumber(value) ?? emptyToUndefined(value) ?? null),
      exchangeName: emptyToUndefined(exchangeName),
      colorFlag: emptyToUndefined(colorFlag),
    })
  }
  return { category, items }
}

const parseSbiRanking = (response: MtsResponse): Ranking => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { category: 'sbi', items: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(14)
  reader.skip(4)
  reader.skip(8)
  const count = reader.int(4) ?? 0
  const items: RankingItem[] = []
  for (let i = 0; i < count; i++) {
    const rankText = reader.text(3)
    const name = reader.text(20)
    const exchangeName = reader.text(9)
    const valueText = reader.text(15)
    const code = reader.text(5)
    const market = reader.text(3)
    items.push({
      rank: parseNumber(rankText) ?? i + 1,
      issue: {
        code,
        market: publicDomesticMarket(market, 'market.ranking.sbi'),
        name: emptyToUndefined(name),
      },
      value: parseNumber(valueText) ?? emptyToUndefined(valueText),
      exchangeName: emptyToUndefined(exchangeName),
    })
  }
  return { category: 'sbi', items }
}

const parseNews = (response: MtsResponse): NewsList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { items: [], error: headerError }
  const reader = readerFor(response)
  const count = reader.int(4) ?? 0
  const items: NewsItem[] = []
  for (let i = 0; i < count && reader.remaining >= 134; i++) {
    const pnac = reader.text(20)
    const storyDate = reader.text(8)
    const storyTime = reader.text(6)
    const processedDate = reader.text(5)
    const takeTime = reader.text(5)
    const title = reader.text(60)
    const seq = reader.text(30)
    const pnacId = emptyToUndefined(pnac)
    items.push({
      id: [pnacId, storyDate, storyTime].filter(Boolean).join(':') || emptyToUndefined(seq),
      title: title || `${storyDate} ${storyTime}`,
      publishedAt: joinDateTime(storyDate, storyTime),
      storyDate: emptyToUndefined(storyDate),
      storyTime: emptyToUndefined(storyTime),
      processedDate: emptyToUndefined(processedDate),
      takeTime: emptyToUndefined(takeTime),
      pnac: pnacId,
      source: pnacId,
    })
  }
  return { items }
}

const parseWatchlists = (_response: MtsResponse): Watchlist[] => []

const parseBoardLike = (response: MtsResponse, options: IssueOptions): Board => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES) {
    return {
      issue: { code: options.issueCode, market: options.market },
      bids: [],
      asks: [],
      error: headerError,
    }
  }
  const { quote, bids, asks } = parseBoardResponse(response, options)
  return {
    issue: quote.issue,
    bids,
    asks,
    quote,
  }
}

const parseIssueChart = (response: MtsResponse, options: IssueChartOptions): IssueChart => {
  const { period, unit } = normalizedIssueChartOptions(options)
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES) {
    return {
      issue: { code: options.issueCode, market: options.market },
      period,
      unit,
      prices: [],
      error: headerError,
    }
  }

  const reader = readerFor(response)
  const code = reader.text(5)
  const name = reader.text(20)
  const market = reader.text(3)
  reader.skip(30)
  reader.skip(30)
  reader.skip(1)
  reader.skip(4)
  reader.skip(4)
  reader.skip(1)
  const previousClose = yen(reader.text(11))
  const currentPrice = yen(reader.text(11))
  reader.skip(1)
  reader.skip(2)
  reader.skip(1)
  reader.skip(5)
  reader.skip(25)
  const highPrice = yen(reader.text(11))
  const lowPrice = yen(reader.text(11))
  const recordCount = reader.int(4) ?? 0
  const prices: ChartPrice[] = []

  for (let i = 0; i < recordCount && reader.remaining >= 71; i++) {
    prices.push({
      dateTime: reader.text(12),
      open: chartYen(reader.text(11)),
      high: chartYen(reader.text(11)),
      low: chartYen(reader.text(11)),
      close: chartYen(reader.text(11)),
      volume: parseNumber(reader.text(15)),
    })
  }

  const latestDateTime = emptyToUndefined(prices[0]?.dateTime)
  const technicalCount = reader.remaining >= 4 ? (reader.int(4) ?? 0) : 0
  reader.skip(Math.min(reader.remaining, technicalCount * 11))
  const validCount = reader.remaining >= 4 ? reader.int(4) : null
  const validPrices =
    validCount != null && validCount > 0 && validCount < prices.length
      ? prices.slice(prices.length - validCount)
      : prices

  return {
    issue: {
      code: emptyToUndefined(code) ?? options.issueCode,
      market: publicDomesticMarket(market, 'market.issue.chart') ?? options.market,
      name: emptyToUndefined(name),
    },
    period,
    unit,
    prices: validPrices.filter((price) => price.dateTime && price.close.value != null).reverse(),
    previousClose,
    currentPrice,
    highPrice,
    lowPrice,
    latestDateTime,
  }
}

const parseBoardResponse = (
  response: MtsResponse,
  options: IssueOptions,
): { quote: Quote; bids: BoardPriceLevel[]; asks: BoardPriceLevel[] } => {
  const reader = readerFor(response)
  const code = reader.text(5)
  const name = reader.text(20)
  const market = reader.text(3)
  reader.skip(30)
  reader.skip(30)
  reader.skip(1)
  reader.skip(1)
  reader.skip(4)
  reader.skip(4)
  const priceText = reader.text(11)
  const priceFlag = reader.text(1)
  reader.skip(2)
  reader.skip(1)
  reader.skip(1)
  const timestamp = reader.text(5)
  const changeText = reader.text(25)
  const volumeText = reader.text(11)
  reader.skip(13)
  reader.skip(20)
  reader.skip(30)
  const openText = priceBeforeTimestamp(reader.text(18))
  const highText = priceBeforeTimestamp(reader.text(18))
  const lowText = priceBeforeTimestamp(reader.text(18))
  const previousCloseText = priceBeforeTimestamp(reader.text(18))
  reader.skip(15)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(12)
  reader.skip(11)
  reader.skip(12)
  reader.skip(18)
  reader.skip(18)
  reader.skip(21)
  reader.skip(21)
  reader.skip(17)
  reader.skip(6)
  reader.skip(8)
  reader.skip(8)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(12)
  reader.skip(1)
  reader.skip(12)
  reader.skip(1)
  reader.skip(12)
  reader.skip(1)
  reader.skip(12)
  reader.skip(1)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(11)
  reader.skip(15)
  reader.skip(11)

  const bids = Array.from({ length: 8 }, () => reader.text(11))
  const asks = Array.from({ length: 8 }, () => reader.text(11))
  const bidSizes = [reader.text(13), ...Array.from({ length: 7 }, () => reader.text(11))]
  const askSizes = [reader.text(13), ...Array.from({ length: 7 }, () => reader.text(11))]
  reader.skip(11)
  reader.skip(11)
  reader.skip(15)
  reader.skip(15)
  bids.push(reader.text(11), reader.text(11))
  asks.push(reader.text(11), reader.text(11))
  bidSizes.push(reader.text(11), reader.text(11))
  askSizes.push(reader.text(11), reader.text(11))

  const issue = {
    code: emptyToUndefined(code) ?? options.issueCode,
    market: publicDomesticMarket(market, 'market.issue.board') ?? options.market,
    name: emptyToUndefined(name),
  }

  return {
    quote: {
      issue,
      price: yen(priceText),
      change: signed(beforeParentheses(changeText), priceFlag),
      changeRate: percent(inParentheses(changeText) ?? ''),
      changeFlag: emptyToUndefined(priceFlag),
      open: yen(openText),
      high: yen(highText),
      low: yen(lowText),
      previousClose: yen(previousCloseText),
      volume: parseNumber(volumeText),
      timestamp: emptyToUndefined(timestamp),
    },
    bids: boardPriceLevels(bids, bidSizes),
    asks: boardPriceLevels(asks, askSizes),
  }
}

const boardPriceLevels = (prices: string[], quantities: string[]): BoardPriceLevel[] =>
  prices.flatMap((price, index) =>
    parseNumber(price) == null
      ? []
      : [{ price: yen(price), quantity: parseNumber(quantities[index] ?? '') }],
  )

const parseOrdersLoose = (
  response: MtsResponse,
  options?: OrderInquiryOptions | IssueOptions,
): OrderList => {
  if (response.header.trCode === 'F2503') return parseTodayExecutedOrders(response, options)
  if (response.header.trCode === 'F2511') return parseRecentOrders(response, options)
  if (response.header.trCode === 'F2504') return parseIssueOpenOrders(response, options)
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { orders: [], error: headerError }
  const text = response.text.slice(MTS_HEADER_BYTES)
  const chunks = text.match(/.{1,260}/gs) ?? []
  const orders: Order[] = chunks
    .map((chunk, index) => {
      const optionIssueCode = options && 'issueCode' in options ? (options.issueCode ?? '') : ''
      const optionMarket = options && 'market' in options ? options.market : undefined
      const code = chunk.match(/\b[0-9A-Z]{4,5}\b/)?.[0] ?? optionIssueCode
      const id = chunk.match(/\b[0-9]{6,}\b/)?.[0] ?? `${response.header.trCode}-${index}`
      const sideText = chunk.includes('売') ? 'sell' : 'buy'
      return {
        id,
        issue: { code, market: optionMarket },
        side: sideText as TradeSide,
        status: mapOrderStatus(chunk),
        quantity: parseNumber(chunk.match(/[0-9,]+株/)?.[0] ?? ''),
        price: yen(chunk.match(/[0-9,]+円/)?.[0] ?? ''),
      }
    })
    .filter((order) => order.issue.code || order.id)
  return { orders }
}

const parseTodayExecutedOrders = (
  response: MtsResponse,
  options?: OrderInquiryOptions | IssueOptions,
): OrderList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { orders: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(3)
  reader.skip(3)
  const recordCount = reader.int(4) ?? 0
  const orders: Order[] = []
  for (let i = 0; i < recordCount; i++) {
    const code = reader.text(5)
    const market = reader.text(3)
    const issueName = reader.text(35)
    const orderNumber = reader.text(6)
    const orderId = reader.text(7)
    reader.text(1)
    const statusText = reader.text(8)
    const tradeId = reader.text(1)
    const tradeIdText = reader.text(6)
    reader.text(8)
    const quantityText = reader.text(15)
    reader.skip(10)
    const averagePriceText = reader.text(15)
    reader.skip(11)
    reader.skip(1)
    reader.skip(1)
    reader.skip(2)
    reader.skip(5)
    reader.skip(25)
    reader.skip(11)
    const depositTypeText = reader.text(20)
    const tradeDate = reader.text(8)
    const settlementDateText = reader.text(14)
    const commissionText = reader.text(20)
    const taxText = reader.text(18)
    reader.skip(2)
    const daytradeTotalText = reader.text(40)
    const exchangeName = reader.text(40)
    reader.skip(10)
    const accountInformation = reader.text(20)
    const depositTypeCode = reader.text(1)
    const issue = {
      code,
      market: publicDomesticMarket(market, 'orders.inquiry.executionsToday'),
      name: extractIssueName(issueName),
    }
    orders.push({
      id: orderId || orderNumber || `${response.header.trCode}-${i}`,
      issue,
      side: mapSide(tradeId),
      sideText: emptyToUndefined(tradeIdText),
      status: 'executed',
      statusText: emptyToUndefined(statusText),
      depositType: mapDepositType(depositTypeCode),
      depositTypeCode: emptyToUndefined(depositTypeCode),
      depositTypeText: emptyToUndefined(depositTypeText),
      quantity: parseNumber(quantityText),
      executedQuantity: parseNumber(quantityText),
      price: yen(averagePriceText),
      executedPrice: yen(averagePriceText),
      orderedAt: emptyToUndefined(tradeDate),
      expiresAt: emptyToUndefined(settlementDateText),
      orderNumber: emptyToUndefined(orderNumber),
      tradeId: emptyToUndefined(tradeId),
      exchangeCode: emptyToUndefined(exchangeName),
      accountInformation: emptyToUndefined(accountInformation),
      commission: yen(commissionText),
      tax: yen(taxText),
      daytradeTotal: yen(daytradeTotalText),
    } as Order)
  }
  const error = parseTrailingError(reader, response)
  return filterOrders({ orders, error }, options)
}

const parseRecentOrders = (
  response: MtsResponse,
  options?: OrderInquiryOptions | IssueOptions,
): OrderList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { orders: [], error: headerError }
  const reader = readerFor(response)
  reader.skip(3)
  reader.skip(3)
  const recordCount = reader.int(4) ?? 0
  const orders: Order[] = []
  for (let i = 0; i < recordCount; i++) {
    const code = reader.text(5)
    const market = reader.text(3)
    const issueName = reader.text(35)
    const orderNumber = reader.text(6)
    const orderId = reader.text(7)
    const statusCode = reader.text(1)
    const statusText = reader.text(8)
    const tradeId = reader.text(1)
    const tradeIdText = reader.text(6)
    const paymentLimitText = reader.text(8)
    const quantityText = reader.text(15)
    const unexecutedQuantityText = reader.text(10)
    reader.skip(15)
    const priceText = reader.text(11)
    reader.skip(1)
    reader.skip(1)
    reader.skip(2)
    reader.skip(5)
    reader.skip(25)
    reader.skip(11)
    const depositTypeText = reader.text(25)
    const inputDate = reader.text(8)
    const primaryOrderTermText = reader.text(14)
    reader.skip(20)
    reader.skip(18)
    reader.skip(2)
    reader.skip(40)
    reader.skip(40)
    const exchangeCode = reader.text(10)
    const actualQuantityText = reader.text(8)
    const executionStatus = reader.text(1)
    const executionStatusText = reader.text(8)
    const accountInformation = reader.text(20)
    const depositTypeCode = reader.text(1)
    reader.skip(3)
    reader.skip(1)
    reader.skip(1)
    const primaryLimitPrice = reader.text(10)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    reader.skip(15)
    reader.skip(4)
    reader.skip(7)
    reader.skip(14)
    reader.skip(3)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    reader.skip(10)
    reader.skip(8)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    const status =
      mapOrderStatusCode(statusCode) ?? mapOrderStatus(`${statusText} ${executionStatusText}`)
    orders.push({
      id: orderId || orderNumber || `${response.header.trCode}-${i}`,
      issue: {
        code,
        market: publicDomesticMarket(market, 'orders.inquiry'),
        name: extractIssueName(issueName),
      },
      side: mapSide(tradeId),
      sideText: emptyToUndefined(tradeIdText),
      status,
      statusText: emptyToUndefined(statusText),
      executionStatus: emptyToUndefined(executionStatus),
      executionStatusText: emptyToUndefined(executionStatusText),
      depositType: mapDepositType(depositTypeCode),
      depositTypeCode: emptyToUndefined(depositTypeCode),
      depositTypeText: emptyToUndefined(depositTypeText),
      quantity: parseNumber(quantityText),
      unexecutedQuantity: parseNumber(unexecutedQuantityText),
      executedQuantity: parseNumber(actualQuantityText),
      price: yen(priceText || primaryLimitPrice),
      orderedAt: emptyToUndefined(inputDate),
      expiresAt: emptyToUndefined(primaryOrderTermText || paymentLimitText),
      orderNumber: emptyToUndefined(orderNumber),
      tradeId: emptyToUndefined(tradeId),
      exchangeCode: emptyToUndefined(exchangeCode),
      accountInformation: emptyToUndefined(accountInformation),
    })
  }
  const error = parseTrailingError(reader, response)
  return filterOrders({ orders, error }, options)
}

const parseIssueOpenOrders = (
  response: MtsResponse,
  options?: OrderInquiryOptions | IssueOptions,
): OrderList => {
  const headerError = methodErrorFromHeader(response)
  if (headerError || response.buffer.length <= MTS_HEADER_BYTES)
    return { orders: [], error: headerError }
  const reader = readerFor(response)
  const firstRecordCount = reader.int(4) ?? 0
  for (let i = 0; i < firstRecordCount; i++) {
    reader.skip(1)
    reader.skip(10)
    reader.skip(10)
  }
  reader.skip(11)
  reader.skip(1)
  const recordCount = reader.int(4) ?? 0
  const optionIssueCode = options && 'issueCode' in options ? (options.issueCode ?? '') : ''
  const optionMarket = options && 'market' in options ? options.market : undefined
  const orders: Order[] = []
  for (let i = 0; i < recordCount; i++) {
    const orderNumber = reader.text(6)
    const orderId = reader.text(7)
    const statusCode = reader.text(1)
    const statusText = reader.text(8)
    const tradeId = reader.text(1)
    const tradeIdText = reader.text(6)
    const paymentLimitText = reader.text(16)
    const quantityText = reader.text(15)
    const unexecutedQuantityText = reader.text(10)
    reader.skip(15)
    const inputDate = reader.text(8)
    const primaryOrderTermText = reader.text(14)
    reader.skip(3)
    reader.skip(1)
    reader.skip(1)
    const primaryLimitPrice = reader.text(10)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    reader.skip(15)
    reader.skip(4)
    reader.skip(7)
    reader.skip(14)
    reader.skip(3)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    reader.skip(10)
    reader.skip(8)
    reader.skip(1)
    reader.skip(10)
    reader.skip(1)
    orders.push({
      id: orderId || orderNumber || `${response.header.trCode}-${i}`,
      issue: { code: optionIssueCode, market: optionMarket },
      side: mapSide(tradeId),
      sideText: emptyToUndefined(tradeIdText),
      status: mapOrderStatusCode(statusCode) ?? mapOrderStatus(statusText),
      statusText: emptyToUndefined(statusText),
      quantity: parseNumber(quantityText),
      unexecutedQuantity: parseNumber(unexecutedQuantityText),
      price: yen(primaryLimitPrice),
      orderedAt: emptyToUndefined(inputDate),
      expiresAt: emptyToUndefined(primaryOrderTermText || paymentLimitText),
      orderNumber: emptyToUndefined(orderNumber),
      tradeId: emptyToUndefined(tradeId),
    })
  }
  const error = parseTrailingError(reader, response)
  return filterOrders({ orders, error }, options)
}

const filterOrders = (list: OrderList, options?: OrderInquiryOptions | IssueOptions): OrderList => {
  if (!options || !('issueCode' in options)) return list
  return {
    ...list,
    orders: list.orders.filter((order) => matchesIssue(order.issue, options)),
  }
}

const parseOrderPreview = (response: MtsResponse, options: OrderPreviewInput): OrderPreview => ({
  issue: { code: options.issueCode, market: options.market },
  side: options.side,
  quantity: 'quantity' in options ? options.quantity : undefined,
  price: 'price' in options && options.price != null ? yen(String(options.price)) : undefined,
  warnings: collectMessages(response.text),
  confirmationId: response.header.lastExecutionTime || undefined,
  message: collectMessages(response.text).join('\n') || undefined,
  error: methodErrorFromHeader(response),
})

const parseOrderCorrectionPreOrder = (
  response: MtsResponse,
  options: OrderPreviewInput,
): OrderPreview => {
  const headerError = methodErrorFromHeader(response)
  const warnings = collectMessages(response.text)
  const fallback = {
    issue: { code: options.issueCode, market: options.market },
    side: options.side,
    warnings,
    confirmationId: response.header.lastExecutionTime || undefined,
    message: warnings.join('\n') || undefined,
    error: headerError,
  } satisfies OrderPreview

  if (headerError || response.buffer.length <= MTS_HEADER_BYTES) return fallback

  const reader = readerFor(response)
  const tradeTitle = reader.text(20)
  const buyingPowerTotal = reader.text(15)
  const controlledStockCode = reader.text(1)
  const deficitMessageFlag = reader.text(1)
  const deficitMessage = reader.text(1500)
  const issueCode = reader.text(5)
  const market = reader.text(3)
  const details: OrderCorrectionPreOrder['details'] = []
  const detailCount = safeCount(reader, 1)

  for (let index = 0; index < detailCount; index += 1) {
    const exchangeName = reader.text(30)
    const marketLoanKbn = reader.text(4)
    const marketIppanLoanKbn = reader.text(4)
    const currentPrice = reader.text(11)
    const tradeColorFlag = reader.text(1)
    const priceTick = reader.text(1)
    const priceTickText = reader.text(2)
    const tradeTime = reader.text(5)
    const changeText = reader.text(25)
    const volumeText = reader.text(11)
    details.push({
      exchangeName: emptyToUndefined(exchangeName),
      marketLoanKbn: emptyToUndefined(marketLoanKbn),
      marketIppanLoanKbn: emptyToUndefined(marketIppanLoanKbn),
      currentPrice: yen(currentPrice),
      tradeColorFlag: emptyToUndefined(tradeColorFlag),
      priceTick: emptyToUndefined(priceTick),
      priceTickText: emptyToUndefined(priceTickText),
      tradeTime: emptyToUndefined(tradeTime),
      changeText: emptyToUndefined(changeText),
      volumeText: emptyToUndefined(volumeText),
    })
  }

  const orderNumber = reader.text(6)
  const orderId = reader.text(7)
  const primaryOrderMethod = reader.text(3)
  const primaryTriggerZone = reader.text(1)
  const primaryTriggerPrice = reader.text(10)
  const status = reader.text(1)
  const statusText = reader.text(6)
  const tradeId = reader.text(1)
  const tradeName = reader.text(6)
  const quantityText = reader.text(8)
  const quantityDetailText = reader.text(20)
  reader.skip(18)
  reader.skip(2)
  reader.skip(40)
  reader.skip(40)
  const orderLimit = reader.text(2)
  const orderLimitText = reader.text(20)
  const priceSteps: StockOrderPreOrderPriceStep[] = []
  const priceStepCount = safeCount(reader, 4)

  for (let index = 0; index < priceStepCount; index += 1) {
    const from = reader.text(11)
    const to = reader.text(11)
    priceSteps.push({ from: yen(from), to: yen(to) })
  }

  const sessionRange = reader.text(30)
  const inputDateText = reader.text(8)
  const primaryOrderTerm = reader.text(14)
  const nonSpecificTradeText = reader.text(12)
  const marketName = reader.text(10)
  const rbeOrderStatus = reader.text(1)
  const priceCondition = reader.text(1)
  const price = reader.text(10)
  const exchangeName = reader.text(30)
  const transId = reader.text(1)
  const ptsDayNightFlag = reader.text(1)
  const smallTickFlag = reader.text(1)
  const juniorBuyingPowerTotal = reader.text(17)
  const secondaryPriceCondition = reader.text(1)
  const secondaryPrice = reader.text(15)
  const autoOrderKind = reader.text(4)
  const autoOrderNumber = reader.text(7)
  const autoOrderInputDate = reader.text(14)
  const secondaryOrderMethod = reader.text(3)
  const secondaryTriggerZone = reader.text(1)
  const secondaryTriggerPrice = reader.text(10)
  const secondaryOrderCondition = reader.text(1)
  const secondaryLimitPrice = reader.text(10)
  const secondaryOrderTerm = reader.text(8)
  const secondaryOcoPriceCondition = reader.text(1)
  const secondaryOcoPrice = reader.text(10)
  reader.skip(1)
  const exchangeList = reader.text(30)

  const issue = {
    code: emptyToUndefined(issueCode) ?? options.issueCode,
    market: publicDomesticMarket(market, 'orders.cash.correction') ?? options.market,
  }
  const parsedPrice = yen(price)
  const parsedQuantity = parseNumber(quantityText)
  const correction: OrderCorrectionPreOrder = {
    issue,
    tradeTitle: emptyToUndefined(tradeTitle),
    buyingPowerTotal: yen(buyingPowerTotal),
    controlledStockCode: emptyToUndefined(controlledStockCode),
    hasTradeWarning: controlledStockCode === '1',
    deficitMessageFlag: emptyToUndefined(deficitMessageFlag),
    deficitMessage: emptyToUndefined(deficitMessage),
    details,
    orderNumber: emptyToUndefined(orderNumber),
    orderId: emptyToUndefined(orderId),
    primaryOrderMethod: emptyControlFieldToUndefined(primaryOrderMethod),
    primaryTriggerZone: emptyControlFieldToUndefined(primaryTriggerZone),
    primaryTriggerPrice: parseNumber(primaryTriggerPrice),
    status: emptyToUndefined(status),
    statusText: emptyToUndefined(statusText),
    tradeId: emptyToUndefined(tradeId),
    tradeName: emptyToUndefined(tradeName),
    quantity: parsedQuantity,
    quantityText: emptyToUndefined(quantityDetailText),
    orderLimit: emptyToUndefined(orderLimit),
    orderLimitText: emptyToUndefined(orderLimitText),
    priceSteps,
    sessionRange: emptyToUndefined(sessionRange),
    inputDateText: emptyToUndefined(inputDateText),
    primaryOrderTerm: emptyToUndefined(primaryOrderTerm),
    nonSpecificTradeText: emptyToUndefined(nonSpecificTradeText),
    marketName: emptyToUndefined(marketName),
    rbeOrderStatus: emptyToUndefined(rbeOrderStatus),
    priceCondition: emptyControlFieldToUndefined(priceCondition),
    price: parsedPrice.value,
    priceAmount: parsedPrice,
    exchangeName: emptyToUndefined(exchangeName),
    transId: emptyToUndefined(transId),
    ptsDayNightFlag: emptyToUndefined(ptsDayNightFlag),
    smallTickFlag: emptyToUndefined(smallTickFlag),
    juniorBuyingPowerTotal: yen(juniorBuyingPowerTotal),
    secondaryPriceCondition: emptyControlFieldToUndefined(secondaryPriceCondition),
    secondaryPrice: parseNumber(secondaryPrice),
    secondaryPriceAmount: yen(secondaryPrice),
    autoOrderKind: emptyToUndefined(autoOrderKind),
    autoOrderNumber: emptyToUndefined(autoOrderNumber),
    autoOrderInputDate: emptyToUndefined(autoOrderInputDate),
    secondaryOrderMethod: emptyControlFieldToUndefined(secondaryOrderMethod),
    secondaryTriggerZone: emptyControlFieldToUndefined(secondaryTriggerZone),
    secondaryTriggerPrice: parseNumber(secondaryTriggerPrice),
    secondaryOrderCondition: emptyControlFieldToUndefined(secondaryOrderCondition),
    secondaryLimitPrice: parseNumber(secondaryLimitPrice),
    secondaryLimitPriceAmount: yen(secondaryLimitPrice),
    secondaryOrderTerm: emptyToUndefined(secondaryOrderTerm),
    secondaryOcoPriceCondition: emptyControlFieldToUndefined(secondaryOcoPriceCondition),
    secondaryOcoPrice: parseNumber(secondaryOcoPrice),
    secondaryOcoPriceAmount: yen(secondaryOcoPrice),
    exchangeList: emptyToUndefined(exchangeList),
  }

  return {
    issue,
    side: correction.tradeId ? mapSide(correction.tradeId) : options.side,
    quantity: parsedQuantity ?? undefined,
    price: parsedPrice,
    warnings,
    confirmationId: response.header.lastExecutionTime || undefined,
    message: warnings.join('\n') || undefined,
    correction,
    error: headerError,
  }
}

const parseThemeOrderPreview = (
  response: MtsResponse,
  options: ThemeInvestmentOrderOptions,
): OrderPreview => ({
  issue: { code: options.themeId, name: options.themeId },
  side: options.side,
  quantity: options.amount,
  warnings: collectMessages(response.text),
  confirmationId: response.header.lastExecutionTime || undefined,
  message: collectMessages(response.text).join('\n') || undefined,
  error: methodErrorFromHeader(response),
})

const parseOrderReceipt = (response: MtsResponse): OrderReceipt => {
  const error = methodErrorFromHeader(response)
  return {
    accepted: !error?.code || error.code === '000000',
    orderId: response.text.slice(MTS_HEADER_BYTES).match(/\b[0-9]{6,}\b/)?.[0],
    acceptedAt: response.header.lastExecutionTime || undefined,
    message: collectMessages(response.text).join('\n') || undefined,
    error,
  }
}

type StockOrderPreOrderInput =
  | CashOrderOptions
  | CashOrderPreOrderOptions
  | MarginOpenOrderPreOrderOptions
  | MarginCloseOrderPreOrderOptions
  | ActualDeliveryOrderPreOrderOptions

const parseStockOrderPreOrder = (
  response: MtsResponse,
  options: StockOrderPreOrderInput,
): StockOrderPreOrder => {
  const headerError = methodErrorFromHeader(response)
  const fallback = {
    issue: { code: options.issueCode, market: options.market },
    market: options.market,
    priceSteps: [],
    orderTerms: [],
    orderTermDates: [],
    paymentLimits: [],
    error: headerError,
  } satisfies StockOrderPreOrder

  if (headerError || response.buffer.length <= MTS_HEADER_BYTES) return fallback

  const reader = readerFor(response)
  const tradeTitle = reader.text(20)
  const buyingPowerTotal = reader.text(25)
  const controlledStockCode = reader.text(1)
  const deficitMessageFlag = reader.text(1)
  const deficitMessage = reader.text(1500)
  const issueCode = reader.text(5)
  const market = reader.text(3)
  const issueName = reader.text(30)
  const exchangeList = reader.text(30)
  const exchangeListName = reader.text(30)
  const exchangeListIndexFlag = reader.text(1)
  const marketLoanKbn = reader.text(4)
  const marketIppanLoanKbn = reader.text(4)
  const currentPrice = reader.text(11)
  const tradeColorFlag = reader.text(1)
  const priceTick = reader.text(1)
  const priceTickText = reader.text(2)
  const tradeTime = reader.text(5)
  const changeText = reader.text(25)
  const volume = reader.text(11)
  const lotSize = reader.text(20)
  const priceSteps: StockOrderPreOrderPriceStep[] = []
  const priceStepCount = safeCount(reader, 4)

  for (let index = 0; index < priceStepCount; index += 1) {
    const from = reader.text(11)
    const to = reader.text(11)
    priceSteps.push({ from: yen(from), to: yen(to) })
  }

  const sessionRange = reader.text(30)
  const basePrice = reader.text(11)
  const orderTerms: string[] = []
  const orderTermDates: string[] = []
  const orderTermCount = safeCount(reader, 2)
  for (let index = 0; index < orderTermCount; index += 1) {
    const term = reader.text(8)
    const termDate = reader.text(8)
    const normalizedTerm = emptyControlFieldToUndefined(term)
    const normalizedTermDate = emptyControlFieldToUndefined(termDate)
    if (normalizedTerm) orderTerms.push(normalizedTerm)
    if (normalizedTermDate) orderTermDates.push(normalizedTermDate)
  }

  const paymentLimits: StockOrderPreOrder['paymentLimits'] = []
  const paymentLimitCount = safeCount(reader, 2)
  for (let index = 0; index < paymentLimitCount; index += 1) {
    const text = reader.text(16)
    const code = reader.text(1)
    paymentLimits.push({
      text: emptyToUndefined(text),
      code: emptyToUndefined(code),
    })
  }

  const nonSpecificTradeText = reader.text(12)
  const paymentLimitText = reader.text(16)
  const acquisitionPrice = reader.text(11)
  const position = reader.text(36)
  const unexecutedQuantity = reader.text(16)
  const lotSize2 = reader.text(11)
  const ptsDayNightFlag = reader.text(1)
  const sorServiceType = reader.text(1)
  const isaServiceKbn = reader.text(1)
  const isaBuyLimit = reader.text(12)
  const isaGrowthServiceKbn = reader.text(1)
  const smallTickFlag = reader.text(1)
  const ippanShort = reader.text(1)
  const ippanLong = reader.text(1)
  const dayBuy = reader.text(1)
  const daySell = reader.text(1)
  const premiumShortSelling = reader.text(1)
  const premiumFee = reader.text(25)
  const ippanPaymentLimit = reader.text(2)
  const positionStatus = reader.text(1)
  const juniorNisaBuyLimit = reader.text(12)
  const juniorNisaServiceKbn = reader.text(1)
  const juniorBuyingPowerTotal = reader.text(17)
  const sKabuCode = reader.text(1)

  return {
    issue: {
      code: emptyToUndefined(issueCode) ?? options.issueCode,
      market: publicDomesticMarket(market, 'orders.preOrder') ?? options.market,
      name: emptyToUndefined(stripIssueCodePrefix(issueName, issueCode)),
    },
    tradeTitle: emptyToUndefined(tradeTitle),
    buyingPowerTotal: yen(buyingPowerTotal),
    controlledStockCode: emptyToUndefined(controlledStockCode),
    hasTradeWarning: controlledStockCode === '1',
    market: publicDomesticMarket(market, 'orders.preOrder') ?? options.market,
    exchangeList: emptyToUndefined(exchangeList),
    exchangeListName: emptyToUndefined(exchangeListName),
    exchangeListIndexFlag: emptyToUndefined(exchangeListIndexFlag),
    marketLoanKbn: emptyToUndefined(marketLoanKbn),
    marketIppanLoanKbn: emptyToUndefined(marketIppanLoanKbn),
    currentPrice: yen(currentPrice),
    tradeColorFlag: emptyToUndefined(tradeColorFlag),
    priceTick: emptyToUndefined(priceTick),
    priceTickText: emptyToUndefined(priceTickText),
    tradeTime: emptyToUndefined(tradeTime),
    changeText: emptyToUndefined(changeText),
    volume: parseNumber(volume),
    lotSize: parseNumber(lotSize),
    priceSteps,
    sessionRange: emptyToUndefined(sessionRange),
    basePrice: yen(basePrice),
    orderTerms,
    orderTermDates,
    paymentLimits,
    nonSpecificTradeText: emptyToUndefined(nonSpecificTradeText),
    paymentLimitText: emptyToUndefined(paymentLimitText),
    acquisitionPrice: yen(acquisitionPrice),
    position: parseNumber(position),
    unexecutedQuantity: parseNumber(unexecutedQuantity),
    lotSize2: parseNumber(lotSize2),
    ptsDayNightFlag: emptyToUndefined(ptsDayNightFlag),
    sorServiceType: emptyToUndefined(sorServiceType),
    nisa: {
      serviceKbn: emptyToUndefined(isaServiceKbn),
      buyLimit: yen(isaBuyLimit),
      growthServiceKbn: emptyToUndefined(isaGrowthServiceKbn),
      juniorServiceKbn: emptyToUndefined(juniorNisaServiceKbn),
      juniorBuyLimit: yen(juniorNisaBuyLimit),
      juniorBuyingPowerTotal: yen(juniorBuyingPowerTotal),
    },
    smallTickFlag: emptyToUndefined(smallTickFlag),
    margin: {
      tradeTypes: stockPreOrderMarginTradeTypes(paymentLimits),
      ippanShort: emptyToUndefined(ippanShort),
      ippanLong: emptyToUndefined(ippanLong),
      dayBuy: emptyToUndefined(dayBuy),
      daySell: emptyToUndefined(daySell),
      premiumShortSelling: emptyToUndefined(premiumShortSelling),
      premiumFee: yen(premiumFee),
      ippanPaymentLimit: emptyToUndefined(ippanPaymentLimit),
      positionStatus: emptyToUndefined(positionStatus),
    },
    sKabu: {
      code: emptyToUndefined(sKabuCode),
      available: sKabuCode === '1',
    },
    deficitMessageFlag: emptyToUndefined(deficitMessageFlag),
    deficitMessage: emptyToUndefined(deficitMessage),
    error: headerError,
  }
}

const stockPreOrderMarginTradeTypes = (
  paymentLimits: StockOrderPreOrder['paymentLimits'],
): MarginOpenTradeType[] => {
  const tradeTypes = paymentLimits
    .map((paymentLimit) => marginOpenTradeTypeFromCode(paymentLimit.code))
    .filter((value): value is MarginOpenTradeType => Boolean(value))
  return [...new Set(tradeTypes)]
}

const marginOpenTradeTypeFromCode = (
  value: string | undefined,
): MarginOpenTradeType | undefined => {
  if (value === '6') return 'standard'
  if (value === '9') return 'generalBuy'
  if (value === 'A') return 'generalSellShort'
  if (value === 'B') return 'generalSellInventoryLimited'
  if (value === 'C') return 'generalSellInventoryUnlimited'
  if (value === 'D') return 'day'
  if (value === 'E') return 'hyper'
  return undefined
}

const parseThemeInvestmentList = (
  response: MtsResponse,
  options: ThemeInvestmentPreOrderOptions,
): ThemeInvestmentList => {
  const reader = readerFor(response)
  const buyingPowerTotal = reader.text(25)
  const deficitMessageFlag = reader.text(1)
  const deficitMessage = reader.text(1500)
  const isaBuyLimit = reader.text(12)
  const juniorNisaBuyLimit = reader.text(12)
  const buyingPowerTotalJuniorNisa = reader.text(17)
  const count = safeCount(reader, 4)
  const issues: ThemeInvestmentList['themes'][number]['issues'] = []

  for (let index = 0; index < count; index += 1) {
    const productName = reader.text(30)
    const exchangeCode = reader.text(3)
    const controlledStockCode = reader.text(1)
    const nisaServiceKbn = reader.text(1)
    const juniorNisaServiceKbn = reader.text(1)
    const growthNisaServiceKbn = reader.text(1)
    const sKabuCode = reader.text(1)
    const lotSize = reader.text(10)
    const currentPrice = reader.text(11)
    const tradeColorFlag = reader.text(1)
    const priceTick = reader.text(1)
    const priceTickText = reader.text(2)
    const tradeTime = reader.text(5)

    const code = options.components[index]?.issueCode
    if (!code) continue
    issues.push({
      code,
      market:
        publicDomesticMarket(exchangeCode, 'orders.themeInvestment.list') ?? options.exchangeCode,
      name: emptyToUndefined(productName),
      controlledStockCode: emptyToUndefined(controlledStockCode),
      hasTradeWarning: Boolean(emptyToUndefined(controlledStockCode)),
      nisaServiceKbn: emptyToUndefined(nisaServiceKbn),
      juniorNisaServiceKbn: emptyToUndefined(juniorNisaServiceKbn),
      growthNisaServiceKbn: emptyToUndefined(growthNisaServiceKbn),
      sKabuCode: emptyToUndefined(sKabuCode),
      sKabuAvailable: sKabuCode === '1',
      lotSize: parseNumber(lotSize),
      currentPrice: yen(currentPrice),
      tradeColorFlag: emptyToUndefined(tradeColorFlag),
      priceTick: emptyToUndefined(priceTick),
      priceTickText: emptyToUndefined(priceTickText),
      tradeTime: emptyToUndefined(tradeTime),
    })
  }

  return {
    themes: [
      {
        id: options.themeId,
        name: options.themeName ?? options.themeId,
        issues,
      },
    ],
    buyingPowerTotal: yen(buyingPowerTotal),
    isaBuyLimit: yen(isaBuyLimit),
    juniorNisaBuyLimit: yen(juniorNisaBuyLimit),
    buyingPowerTotalJuniorNisa: yen(buyingPowerTotalJuniorNisa),
    deficitMessage: emptyToUndefined(deficitMessage),
    deficitMessageFlag: emptyToUndefined(deficitMessageFlag),
    error: methodErrorFromHeader(response),
  }
}

const assertTradingAllowed = (options: { allowTrading?: true }, name: string) => {
  if (options.allowTrading !== true) {
    throw new Error(
      `${name} requires allowTrading: true because it can place or modify a real order`,
    )
  }
}

const assertNoOmitConfirmation = (options: unknown, methodName: string) => {
  if (
    options &&
    typeof options === 'object' &&
    !Array.isArray(options) &&
    (options as { omitConfirmation?: unknown }).omitConfirmation
  ) {
    throw new Error(
      `${methodName} cannot use omitConfirmation because APK confirmation calls may submit orders`,
    )
  }
}

const assertCashOrderOptions = (options: CashOrderOptions) => {
  if (options.accountType && options.depositType && options.accountType !== options.depositType) {
    throw new Error('orders.cash accountType and depositType must match when both are specified')
  }
  if (options.kind === 's') {
    if (options.market !== 'STK') {
      throw new Error('orders.cash with kind: "s" requires market: "STK"')
    }
    return
  }

  assertStandardStockOrderOptions(options, 'orders.cash')
}

const assertStandardStockOrderOptions = (options: StandardCashOrderOptions, methodName: string) => {
  if (options.accountType && options.depositType && options.accountType !== options.depositType) {
    throw new Error(`${methodName} accountType and depositType must match when both are specified`)
  }
  const priceCondition = cashOrderPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(priceCondition) && options.price == null) {
    throw new Error(`${methodName} priceCondition: "${priceCondition}" requires price`)
  }
  if (!cashOrderPriceConditionRequiresPrice(priceCondition) && options.price != null) {
    throw new Error(`${methodName} priceCondition: "${priceCondition}" cannot specify price`)
  }
  if (options.orderTerm === 'date') normalizeOrderDate(options.orderDate)
  if (options.orderTerm !== 'date' && options.orderDate) {
    throw new Error(`${methodName} orderDate requires orderTerm: "date"`)
  }

  const orderMethod = cashOrderMethod(options)
  const hasTrigger = options.triggerZone != null || options.triggerPrice != null
  const hasSecondary = options.secondaryPriceCondition != null || options.secondaryPrice != null
  if (orderMethod === 'normal') {
    if (hasTrigger)
      throw new Error(`${methodName} trigger fields require orderMethod: "stop" or "oco"`)
    if (hasSecondary) throw new Error(`${methodName} secondary fields require orderMethod: "oco"`)
  }
  if (orderMethod === 'stop' || orderMethod === 'oco') {
    if (!options.triggerZone) {
      throw new Error(`${methodName} orderMethod: "${orderMethod}" requires triggerZone`)
    }
    if (options.triggerPrice == null) {
      throw new Error(`${methodName} orderMethod: "${orderMethod}" requires triggerPrice`)
    }
  }
  if (orderMethod === 'stop' && hasSecondary) {
    throw new Error(`${methodName} orderMethod: "stop" cannot specify secondary fields`)
  }
  if (orderMethod === 'oco') {
    if (!options.secondaryPriceCondition) {
      throw new Error(`${methodName} orderMethod: "oco" requires secondaryPriceCondition`)
    }
    if (
      cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition) &&
      options.secondaryPrice == null
    ) {
      throw new Error(`${methodName} orderMethod: "oco" requires secondaryPrice`)
    }
    if (
      !cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition) &&
      options.secondaryPrice != null
    ) {
      throw new Error(
        `${methodName} secondaryPriceCondition: "${options.secondaryPriceCondition}" cannot specify secondaryPrice`,
      )
    }
  }
}

const assertMarginOpenOrderOptions = (options: MarginOpenOrderOptions) => {
  assertStandardStockOrderOptions(options, 'orders.margin.open')
  marginOpenTradeTypeCode(options.marginTradeType)
}

const assertMarginCloseOrderOptions = (options: MarginCloseOrderOptions) => {
  assertStandardStockOrderOptions(options, 'orders.margin.close')
  marginCloseTradeTypeCode(options.marginCloseTradeType)
  if (options.positionId && !options.marginPositions?.length) {
    throw new Error(
      'orders.margin.close positionId is not enough for the APK payload; specify marginPositions',
    )
  }
  if (!options.marginPositions?.length) {
    throw new Error('orders.margin.close requires marginPositions selected from the APK fields')
  }
  if (options.marginClosePositionOrder) {
    throw new Error(
      'orders.margin.close marginClosePositionOrder is only sent by orders.margin.estimateSummary/placeSummary',
    )
  }
}

const assertMarginCloseSummaryOrderOptions = (options: MarginCloseSummaryOrderOptions) => {
  assertStandardStockOrderOptions(options, 'orders.margin.placeSummary')
  marginCloseTradeTypeCode(options.marginCloseTradeType)
  marginClosePositionOrderCode(options.marginClosePositionOrder)
  if (options.marginPositions?.length) {
    throw new Error(
      'orders.margin.placeSummary does not send marginPositions; use orders.margin.close for specified close',
    )
  }
}

const assertActualDeliveryOrderOptions = (options: ActualDeliveryOrderOptions) => {
  if (options.accountType && options.depositType && options.accountType !== options.depositType) {
    throw new Error(
      'orders.margin.actualDelivery accountType and depositType must match when both are specified',
    )
  }
  if (options.price != null) {
    throw new Error(
      'orders.margin.actualDelivery uses market orders in the APK and cannot specify price',
    )
  }
  if (options.positionId && !options.marginPositions?.length) {
    throw new Error(
      'orders.margin.actualDelivery positionId is not enough for the APK payload; specify marginPositions',
    )
  }
  if (!options.marginPositions?.length) {
    throw new Error(
      'orders.margin.actualDelivery requires marginPositions selected from the APK fields',
    )
  }
}

const assertThemeInvestmentOrderOptions = (
  session: SbiSession,
  options: ThemeInvestmentOrderOptions,
) => {
  if (options.accountType && options.depositType && options.accountType !== options.depositType) {
    throw new Error(
      'orders.themeInvestment accountType and depositType must match when both are specified',
    )
  }
  if (options.side !== 'buy') {
    throw new Error('orders.themeInvestment APK payload does not support side: "sell"')
  }
  if (!options.themeSetYyyymm) {
    throw new Error('orders.themeInvestment requires themeSetYyyymm from the APK handoff')
  }
  if (String(options.themeSetYyyymm).length !== 6) {
    throw new Error('orders.themeInvestment themeSetYyyymm must be 6 digits')
  }
  if (options.themeCourse == null || String(options.themeCourse).length > 2) {
    throw new Error('orders.themeInvestment themeCourse must fit the APK 2-byte field')
  }
  if (!options.components?.length) {
    throw new Error('orders.themeInvestment requires components selected from the APK fields')
  }
  if (options.components.length > 10) {
    throw new Error('orders.themeInvestment supports up to 10 component stocks from the APK')
  }
  for (const [index, component] of options.components.entries()) {
    if (!component.issueCode) {
      throw new Error(`orders.themeInvestment components.${index}.issueCode is required`)
    }
    if (component.quantity == null || String(component.quantity).length === 0) {
      throw new Error(`orders.themeInvestment components.${index}.quantity is required`)
    }
  }
  if (!session.tradePassword) {
    throw new Error('orders.themeInvestment requires tradePassword in loginWithPasskey options')
  }
  orderDepositType(session, options, 'orders.themeInvestment')
}

const assertThemeInvestmentPreOrderOptions = (options: ThemeInvestmentPreOrderOptions) => {
  if (!options.themeId) {
    throw new Error('orders.themeInvestment.list requires themeId from the APK handoff')
  }
  if (!options.exchangeCode) {
    throw new Error('orders.themeInvestment.list requires exchangeCode from the APK handoff')
  }
  if (!options.components?.length) {
    throw new Error('orders.themeInvestment.list requires components selected from the APK fields')
  }
  if (options.components.length > 10) {
    throw new Error('orders.themeInvestment.list supports up to 10 component stocks from the APK')
  }
  for (const [index, component] of options.components.entries()) {
    if (!component.issueCode) {
      throw new Error(`orders.themeInvestment.list components.${index}.issueCode is required`)
    }
  }
}

const assertOrderCancelOptions = (options: OrderCancelOptions) => {
  if (!options.orderNumber) {
    throw new Error('orders cancel requires orderNumber')
  }
}

const assertPlaceOrderCancelOptions = (
  session: SbiSession,
  options: PlaceOrderCancelOptions,
  methodName: string,
) => {
  assertOrderCancelOptions(options)
  if (!options.tradePassword && !session.tradePassword) {
    throw new Error(`${methodName} requires tradePassword in loginWithPasskey options`)
  }
}

const assertIfdOrderOptions = (options: IfdOrderOptions) => {
  assertCashOrderOptions(options)
  if (options.tradeType === 'marginOpen') {
    marginOpenTradeTypeCode(options.marginTradeType)
  } else if (options.marginTradeType) {
    throw new Error('orders.ifd marginTradeType requires tradeType: "marginOpen"')
  }
  const ifdPriceCondition = ifdOrderPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(ifdPriceCondition) && options.ifdPrice == null) {
    throw new Error(`orders.ifd ifdPriceCondition: "${ifdPriceCondition}" requires ifdPrice`)
  }
  if (!cashOrderPriceConditionRequiresPrice(ifdPriceCondition) && options.ifdPrice != null) {
    throw new Error(`orders.ifd ifdPriceCondition: "${ifdPriceCondition}" cannot specify ifdPrice`)
  }
  if (options.ifdOrderTerm === 'date') normalizeOrderDate(options.ifdOrderDate)
  if (options.ifdOrderTerm !== 'date' && options.ifdOrderDate) {
    throw new Error('orders.ifd ifdOrderDate requires ifdOrderTerm: "date"')
  }

  const method = ifdOrderMethod(options)
  const hasTrigger = options.ifdTriggerZone != null || options.ifdTriggerPrice != null
  const hasSecondary =
    options.ifdSecondaryPriceCondition != null || options.ifdSecondaryPrice != null
  if (method === 'normal') {
    if (hasTrigger)
      throw new Error('orders.ifd trigger fields require ifdOrderMethod: "stop" or "oco"')
    if (hasSecondary) throw new Error('orders.ifd secondary fields require ifdOrderMethod: "oco"')
  }
  if (method === 'stop' || method === 'oco') {
    if (!options.ifdTriggerZone) {
      throw new Error(`orders.ifd ifdOrderMethod: "${method}" requires ifdTriggerZone`)
    }
    if (options.ifdTriggerPrice == null) {
      throw new Error(`orders.ifd ifdOrderMethod: "${method}" requires ifdTriggerPrice`)
    }
  }
  if (method === 'stop' && hasSecondary) {
    throw new Error('orders.ifd ifdOrderMethod: "stop" cannot specify secondary fields')
  }
  if (method === 'oco') {
    if (!options.ifdSecondaryPriceCondition) {
      throw new Error('orders.ifd ifdOrderMethod: "oco" requires ifdSecondaryPriceCondition')
    }
    if (
      cashOrderPriceConditionRequiresPrice(options.ifdSecondaryPriceCondition) &&
      options.ifdSecondaryPrice == null
    ) {
      throw new Error('orders.ifd ifdOrderMethod: "oco" requires ifdSecondaryPrice')
    }
    if (
      !cashOrderPriceConditionRequiresPrice(options.ifdSecondaryPriceCondition) &&
      options.ifdSecondaryPrice != null
    ) {
      throw new Error(
        `orders.ifd ifdSecondaryPriceCondition: "${options.ifdSecondaryPriceCondition}" cannot specify ifdSecondaryPrice`,
      )
    }
  }
}

const prepareCashOrder = async (session: SbiSession, options: CashOrderOptions) => {
  const preOrder = await callMts(
    session,
    cashPreOrderTrCode(options),
    cashPreOrderTrin(session, options),
  )
  const preOrderInfo = parseStockOrderPreOrder(preOrder, options)
  if (options.kind === 's' && preOrderInfo.sKabu?.available === false) {
    throw new Error('orders.cash S-kabu is not available for this issue according to APK pre-order')
  }
  assertStockOrderQuantityAvailable(options, preOrderInfo, 'orders.cash')
  assertStockOrderMarketAvailable(options, preOrderInfo, 'orders.cash')
  assertStockOrderTermAvailable(options, preOrderInfo, 'orders.cash')
  assertCashOrderDepositTypeAvailable(options, preOrderInfo)
  assertCashOrderPriceSteps(options, preOrderInfo)
  await ensureTradeAuthenticated(session, options, cashPreOrderInfoForAuthentication(preOrderInfo))
}

const prepareMarginOpenOrder = async (session: SbiSession, options: MarginOpenOrderOptions) => {
  const depositType = orderDepositType(session, options, 'orders.margin.open')
  assertMarginOrderDepositType(depositType, 'orders.margin.open')
  const preOrder = await callMts(
    session,
    stockPreOrderTrCode('marginOpen', options.side),
    stockPreOrderTrin(session, options, 'marginOpen'),
  )
  const preOrderInfo = parseStockOrderPreOrder(preOrder, options)
  assertStockOrderQuantityAvailable(options, preOrderInfo, 'orders.margin.open')
  assertStockOrderMarketAvailable(options, preOrderInfo, 'orders.margin.open')
  assertStockOrderTermAvailable(options, preOrderInfo, 'orders.margin.open')
  assertMarginOpenTradeTypeAvailable(options, preOrderInfo)
  assertCashOrderPriceSteps(options, preOrderInfo, 'orders.margin.open')
}

const assertStockOrderQuantityAvailable = (
  options: { kind?: OrderKind; quantity: number },
  preOrder: StockOrderPreOrder,
  methodName: string,
) => {
  if (!Number.isInteger(options.quantity) || options.quantity <= 0) {
    throw new Error(`${methodName} quantity must be a positive integer`)
  }
  const lotSize = preOrder.lotSize2
  if (typeof lotSize !== 'number' || lotSize <= 1) return
  if (options.kind === 's') {
    if (options.quantity >= lotSize) {
      throw new Error(
        `${methodName} with kind: "s" quantity must be less than APK lotSize2: ${lotSize}`,
      )
    }
    return
  }
  if (options.quantity % lotSize !== 0) {
    throw new Error(`${methodName} quantity must be a multiple of APK lotSize2: ${lotSize}`)
  }
}

const assertStockOrderMarketAvailable = (
  options: { kind?: OrderKind; market: MarketCode },
  preOrder: StockOrderPreOrder,
  methodName: string,
) => {
  if (options.kind === 's') return
  const markets = stockPreOrderExchangeMarkets(preOrder.exchangeList)
  const market = domesticMarketToMts(options.market, methodName)
  if (!markets.length || markets.includes(market)) return
  throw new Error(
    `${methodName} market: "${options.market}" is not available according to APK pre-order exchangeList`,
  )
}

const assertStockOrderTermAvailable = (
  options: { kind?: OrderKind; orderTerm?: CashOrderTerm; orderDate?: string },
  preOrder: StockOrderPreOrder,
  methodName: string,
) => {
  if (options.kind === 's') return
  const terms = stockPreOrderTermValues(preOrder)
  if (!terms.size) return
  const orderTerm = options.orderTerm ?? 'day'
  if (!terms.has(orderTerm)) {
    throw new Error(
      `${methodName} orderTerm: "${orderTerm}" is not available according to APK pre-order`,
    )
  }
  if (orderTerm !== 'date') return
  const dates = stockPreOrderTermDates(preOrder)
  if (!dates.length) return
  const orderDate = normalizeOrderDate(options.orderDate)
  if (!dates.includes(orderDate)) {
    throw new Error(
      `${methodName} orderDate: "${orderDate}" is not available according to APK pre-order`,
    )
  }
}

const stockPreOrderTermValues = (preOrder: StockOrderPreOrder): Set<CashOrderTerm> => {
  const terms = new Set<CashOrderTerm>()
  for (const term of preOrder.orderTerms) {
    if (term === '当日中') terms.add('day')
    if (term === '今週中') terms.add('week')
    if (/\d/.test(term)) terms.add('date')
  }
  if (preOrder.orderTermDates.length) terms.add('date')
  return terms
}

const stockPreOrderTermDates = (preOrder: StockOrderPreOrder) => {
  const values = preOrder.orderTermDates.length
    ? preOrder.orderTermDates
    : preOrder.orderTerms.filter((term) => /\d/.test(term))
  return values.map((value) => value.replace(/\D/g, '')).filter((value) => value.length === 8)
}

const assertMarginOpenTradeTypeAvailable = (
  options: MarginOpenOrderOptions,
  preOrder: StockOrderPreOrder,
) => {
  const tradeTypes = preOrder.margin?.tradeTypes ?? []
  const tradeType = options.marginTradeType
  const sideTradeTypes =
    options.side === 'buy'
      ? new Set<MarginOpenTradeType>(['standard', 'generalBuy', 'day'])
      : new Set<MarginOpenTradeType>([
          'standard',
          'generalSellShort',
          'generalSellInventoryLimited',
          'generalSellInventoryUnlimited',
          'day',
          'hyper',
        ])
  if (!sideTradeTypes.has(tradeType)) {
    throw new Error(
      `orders.margin.open marginTradeType: "${tradeType}" is not selectable for side: "${options.side}" in the APK`,
    )
  }
  if (tradeTypes.length && !marginOpenTradeTypeSelectableFromPreOrder(tradeType, tradeTypes)) {
    throw new Error(
      `orders.margin.open marginTradeType: "${tradeType}" is not available according to APK pre-order`,
    )
  }
}

const marginOpenTradeTypeSelectableFromPreOrder = (
  tradeType: MarginOpenTradeType,
  tradeTypes: MarginOpenTradeType[],
) => {
  if (tradeTypes.includes(tradeType)) return true
  if (tradeType === 'generalSellInventoryLimited') {
    return tradeTypes.includes('generalSellInventoryUnlimited')
  }
  return false
}

const STOCK_PRE_ORDER_EXCHANGE_MARKET_CODES = new Set([
  'SOR',
  'TKY',
  'NGY',
  'FKO',
  'SPR',
  'PTS',
  'PTX',
])

const stockPreOrderExchangeMarkets = (value: string | undefined): string[] => {
  if (!value) return []
  const markets: string[] = []
  for (let index = 0; index < value.length; index += 3) {
    const code = value.slice(index, index + 3)
    if (STOCK_PRE_ORDER_EXCHANGE_MARKET_CODES.has(code) && !markets.includes(code)) {
      markets.push(code)
    }
  }
  return markets
}

const assertCashOrderDepositTypeAvailable = (
  options: CashOrderOptions,
  preOrder: StockOrderPreOrder,
) => {
  const depositType = cashOrderDepositType(options)
  if (!depositType || depositType === 'specific' || depositType === 'general') return
  if (depositType === 'growthInvestment' && preOrder.nisa?.growthServiceKbn !== '1') {
    throw new Error(
      'orders.cash depositType: "growthInvestment" is not available according to APK pre-order',
    )
  }
  if (depositType === 'nisa' && preOrder.nisa?.serviceKbn !== '1') {
    throw new Error('orders.cash depositType: "nisa" is not available according to APK pre-order')
  }
  if (depositType === 'juniorNisa' && preOrder.nisa?.juniorServiceKbn !== '1') {
    throw new Error(
      'orders.cash depositType: "juniorNisa" is not available according to APK pre-order',
    )
  }
  if (depositType === 'unknown') {
    throw new Error('orders.cash depositType: "unknown" cannot be sent as an APK order payload')
  }
}

const assertCashOrderPriceSteps = (
  options: CashOrderOptions,
  preOrder: StockOrderPreOrder,
  methodName = 'orders.cash',
) => {
  if (options.kind === 's') return
  const values: Array<{ field: string; value: number | undefined }> = []
  const priceCondition = cashOrderPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(priceCondition)) {
    values.push({ field: 'price', value: options.price })
  }
  const method = cashOrderMethod(options)
  if (method !== 'normal') values.push({ field: 'triggerPrice', value: options.triggerPrice })
  if (
    method === 'oco' &&
    options.secondaryPriceCondition &&
    cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition)
  ) {
    values.push({ field: 'secondaryPrice', value: options.secondaryPrice })
  }

  for (const { field, value } of values) {
    if (value == null) continue
    const step = cashOrderPriceStepFor(preOrder, value)
    if (!step || priceMatchesStep(value, step)) continue
    throw new Error(`${methodName} ${field} must match APK price step ${step}`)
  }
}

const cashOrderPriceStepFor = (preOrder: StockOrderPreOrder, price: number) => {
  const steps = preOrder.priceSteps
    .map((step) => ({
      upper: step.from?.value,
      step: step.to?.value,
    }))
    .filter(
      (step): step is { upper: number; step: number } =>
        typeof step.upper === 'number' &&
        typeof step.step === 'number' &&
        step.upper > 0 &&
        step.step > 0,
    )
    .sort((left, right) => left.upper - right.upper)
  if (!steps.length) return undefined
  return steps.find((step) => price <= step.upper)?.step ?? steps.at(-1)?.step
}

const priceMatchesStep = (price: number, step: number) =>
  Math.abs(price / step - Math.round(price / step)) < 1e-8

const cashPreOrderInfoForAuthentication = (preOrder: StockOrderPreOrder): CashPreOrderInfo => ({
  issueCode: preOrder.issue.code,
  market: preOrder.issue.market,
  issueName: preOrder.issue.name,
})

const ensureTradeAuthenticated = async (
  session: SbiSession,
  options: CashOrderOptions,
  preOrderInfo: CashPreOrderInfo,
) => {
  if (!session.deviceIdRegistered) {
    throw new Error(
      'orders.cash requires deviceId in loginWithPasskey options; SBI returns trade authentication status 99 without F1131 device registration',
    )
  }
  const trin = tradeAuthenticationTrin(options, preOrderInfo)
  debugMts('F1135 request', {
    preOrderInfo,
    value: trin.trimEnd(),
    bytes: shiftJisByteLength(trin.trimEnd()),
  })
  const response = await callMts(session, 'F1135', trin)
  const authentication = parseTradeAuthentication(response)
  debugMts('F1135 response', authentication)
  if (authentication.status === 'success') return
  if (authentication.status === 'needDial') {
    await handlePhoneTradeAuthentication(session, authentication)
    return
  }
  if (authentication.status === 'excessivelyRequested') {
    throw new Error('trade authentication was requested too many times; retry later')
  }
  throw new Error(`trade authentication failed with status ${authentication.statusCode}`)
}

const handlePhoneTradeAuthentication = async (
  session: SbiSession,
  authentication: TradeAuthenticationInfo,
) => {
  const request = tradeAuthenticationRequest(authentication)
  if (!session.tradeAuthentication?.onRequired) {
    const destination = request.sbiCallNo ?? request.phoneNo ?? request.telNo
    throw new Error(
      [
        'trade authentication requires phone verification before order confirmation',
        destination ? `call: ${destination}` : undefined,
        request.authLimitTime ? `limit: ${request.authLimitTime}` : undefined,
      ]
        .filter(Boolean)
        .join(', '),
    )
  }

  await session.tradeAuthentication.onRequired(request)
  await confirmPhoneTradeAuthentication(session)
}

const tradeAuthenticationRequest = (
  authentication: TradeAuthenticationInfo,
): SbiTradeAuthenticationRequest => ({
  type: 'phone',
  telNo: authentication.telNo,
  phoneNo: authentication.phoneNo,
  sbiCallNo: authentication.sbiCallNo,
  authLimitTime: authentication.authLimitTime,
})

const confirmPhoneTradeAuthentication = async (session: SbiSession) => {
  const attempts = session.tradeAuthentication?.confirmAttempts ?? 1
  const intervalMs = session.tradeAuthentication?.confirmIntervalMs ?? 1000
  let lastStatus: TradeAuthenticationConfirmStatus = 'unexpected'
  let lastStatusCode = ''

  for (let index = 0; index < attempts; index += 1) {
    if (index > 0) await sleep(intervalMs)
    const response = await callMts(session, 'F1136')
    lastStatusCode = readTradeAuthenticationConfirmStatusCode(response)
    lastStatus = tradeAuthenticationConfirmStatus(lastStatusCode)
    debugMts('F1136 response', { status: lastStatus, statusCode: lastStatusCode })
    if (lastStatus === 'success') return
    if (lastStatus !== 'authNotComplete') break
  }

  if (lastStatus === 'authNotComplete') {
    throw new Error('trade authentication phone verification is not complete')
  }
  if (lastStatus === 'expired') throw new Error('trade authentication phone verification expired')
  if (lastStatus === 'excessivelyRequested') {
    throw new Error('trade authentication phone verification was requested too many times')
  }
  throw new Error(`trade authentication confirmation failed with status ${lastStatusCode}`)
}

const parseTradeAuthentication = (response: MtsResponse): TradeAuthenticationInfo => {
  const reader = readerFor(response)
  const telNo = reader.text(20)
  const phoneNo = reader.text(20)
  const faxNo = reader.text(20)
  const sbiCallNo = reader.text(20)
  const authLimitTime = reader.text(14)
  const statusCode = reader.text(2)
  return {
    status: tradeAuthenticationStatus(statusCode),
    statusCode,
    telNo: emptyToUndefined(telNo),
    phoneNo: emptyToUndefined(phoneNo),
    faxNo: emptyToUndefined(faxNo),
    sbiCallNo: emptyToUndefined(sbiCallNo),
    authLimitTime: emptyToUndefined(authLimitTime),
  }
}

const readTradeAuthenticationConfirmStatusCode = (response: MtsResponse) =>
  readerFor(response).text(2)

const tradeAuthenticationStatus = (statusCode: string): TradeAuthenticationStatus => {
  if (statusCode === '00') return 'success'
  if (statusCode === '11') return 'needDial'
  if (statusCode === '13') return 'excessivelyRequested'
  return 'unexpected'
}

const tradeAuthenticationConfirmStatus = (statusCode: string): TradeAuthenticationConfirmStatus => {
  if (statusCode === '00') return 'success'
  if (statusCode === '11') return 'authNotComplete'
  if (statusCode === '12') return 'expired'
  if (statusCode === '13') return 'excessivelyRequested'
  return 'unexpected'
}

const tradeAuthenticationTrin = (options: CashOrderOptions, preOrderInfo: CashPreOrderInfo) =>
  fixedTrin([
    {
      width: 256,
      value:
        [
          preOrderInfo.issueCode ?? options.issueCode,
          String(options.quantity),
          tradeAuthenticationTradeName(options),
          preOrderInfo.issueName ?? '',
        ].join(',') + ';',
    },
  ])

const tradeAuthenticationTradeName = (options: CashOrderOptions) => {
  return options.side === 'sell' ? '現物売' : '現物買'
}

const stripIssueCodePrefix = (name: string, issueCode?: string) => {
  const trimmedName = name.trim()
  const trimmedCode = issueCode?.trim()
  if (!trimmedCode) return trimmedName
  return trimmedName.replace(new RegExp(`^${escapeRegExp(trimmedCode)}[\\s　]+`), '')
}

const escapeRegExp = (value: string) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

const readerFor = (response: MtsResponse) => makeFixedReader(response.buffer, MTS_HEADER_BYTES)

const makeFixedReader = (buffer: Buffer, initialOffset = 0) => {
  let offset = initialOffset
  let lastFlag: string | undefined
  return {
    text: (width: number) => {
      const text = readShiftJisField(buffer, offset, width)
      offset += width
      lastFlag = text.length === 1 ? text : lastFlag
      return text
    },
    int: (width: number) =>
      parseNumber(readShiftJisField(buffer, offset, width), () => {
        offset += width
      }),
    skip: (width: number) => {
      offset += width
    },
    get remaining() {
      return Math.max(0, buffer.length - offset)
    },
    get lastFlag() {
      return lastFlag
    },
  }
}

const fixedTrin = (fields: FixedField[]) =>
  fields.map((field) => padField(field.value, field.width, field.align, field.pad)).join('')

const accountTrin = (session: SbiSession) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
  ])

const accountPowerTrin = (session: SbiSession) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
  ])

const listAccountTrin = (
  session: SbiSession,
  options?: CashPositionOptions | MarginPositionOptions | IssueOptions,
  extra?: string,
) =>
  fixedTrin([
    { width: 3, value: optionsWithPaging(hasPaging(options) ? options : undefined).index },
    { width: 3, value: optionsWithPaging(hasPaging(options) ? options : undefined).limit },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    ...(extra !== undefined ? [{ width: 1, value: extra }] : []),
  ])

const marginCloseListTrin = (session: SbiSession, options: MarginPositionOptions) =>
  listAccountTrin(session, options, sideCode(options.side)) +
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 3, value: options.market },
  ])

const issuePositionTrin = (session: SbiSession, options: IssueOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: domesticMarketToMts(options.market, 'account.positions.cashForIssue') },
  ])

const issueTrin = (options: IssueOptions) =>
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: domesticMarketToMts(options.market, 'market.issue') },
    { width: 1, value: '' },
  ])

const normalizedIssueChartOptions = (options: IssueChartOptions) => {
  const period = options.period ?? 'day'
  const unit = options.unit ?? CHART_DEFAULT_UNITS[period]
  const count = options.count ?? DEFAULT_CHART_COUNT

  if (!(period in CHART_PERIOD_MTS_CODES)) {
    throw new Error('period must be minute, day, week, or month')
  }
  if (!Number.isInteger(unit) || unit <= 0) {
    throw new Error('unit must be a positive integer')
  }
  if (period === 'minute' && !CHART_MINUTE_UNITS.has(unit)) {
    throw new Error('minute chart unit must be 1, 5, 10, or 15')
  }
  if (period !== 'minute' && unit !== 1) {
    throw new Error('day, week, and month chart unit must be 1')
  }
  if (!Number.isInteger(count) || count <= 0 || count > 9999) {
    throw new Error('count must be an integer between 1 and 9999')
  }

  return { period, unit, count }
}

const issueChartTrin = (options: IssueChartOptions) => {
  const { period, unit, count } = normalizedIssueChartOptions(options)
  return fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: domesticMarketToMts(options.market, 'market.issue.chart') },
    { width: 1, value: CHART_PERIOD_MTS_CODES[period] },
    { width: 2, value: unit },
    { width: 8, value: '' },
    { width: 8, value: '' },
    { width: 4, value: count },
  ])
}

const newsListTrin = () =>
  fixedTrin([
    { width: 3, value: '' },
    { width: 10, value: '' },
    { width: 8, value: '' },
    { width: 6, value: '' },
    { width: 30, value: '' },
  ])

const marketRankingTrin = () =>
  fixedTrin([
    { width: 2, value: '01' },
    { width: 2, value: '01' },
    { width: 4, value: '0000' },
    { width: 1, value: '0' },
    { width: 4, value: '0' },
    { width: 4, value: '999' },
  ])

const tradingInfoTrCode = (options: BoardOptions) => {
  if (options.side === 'cashSell') return 'F2108'
  if (options.side === 'marginOpenSell') return 'F2114'
  if (options.side === 'marginOpen' || options.side === 'marginOpenBuy') return 'F2109'
  if (options.side === 'marginCloseSell') return 'F2212'
  if (options.side === 'marginClose' || options.side === 'marginCloseBuy') return 'F2208'
  return 'F2107'
}

const tradingInfoTrin = (session: SbiSession, options: BoardOptions) =>
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: domesticMarketToMts(options.market, 'market.issue.tradingInfo') },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: depositTypeCode(options.accountType) },
    { width: 1, value: '' },
    { width: 1, value: '' },
  ])

const openOrdersTrin = (session: SbiSession, options: IssueOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: '1' },
    { width: 5, value: options.issueCode },
    { width: 3, value: domesticMarketToMts(options.market, 'market.issue.openOrders') },
    { width: 1, value: '' },
    { width: 1, value: '1' },
  ])

const watchlistTrin = () => fixedTrin([{ width: 4, value: '0' }])

const orderInquiryTrin = (session: SbiSession, options?: OrderInquiryOptions) =>
  fixedTrin([
    { width: 3, value: optionsWithPaging(options).index },
    { width: 3, value: optionsWithPaging(options).limit },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: '' },
  ])

const recentOrdersTrin = (session: SbiSession, options?: OrderInquiryOptions) =>
  fixedTrin([
    { width: 3, value: optionsWithPaging(options).index },
    { width: 3, value: optionsWithPaging(options).limit },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: '1' },
    { width: 6, value: '' },
    { width: 1, value: '' },
    { width: 1, value: '' },
  ])

const cashOrderTrin = (session: SbiSession, options: CashOrderOptions) =>
  appCashOrderTrin(session, options)

const cashPreOrderTrin = (
  session: SbiSession,
  options: CashOrderOptions | CashOrderPreOrderOptions,
) => stockPreOrderTrin(session, options, 'cash')

type StockPreOrderTradeType =
  | 'cash'
  | 'marginOpen'
  | 'marginClose'
  | ActualDeliveryOrderOptions['kind']

const stockPreOrderTrin = (
  session: SbiSession,
  options: StockOrderPreOrderInput,
  tradeType: StockPreOrderTradeType,
) =>
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: stockPreOrderMarket(options, tradeType) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: stockPreOrderDepositType(options, tradeType) },
    { width: 1, value: stockPreOrderMarginCloseTradeType(options, tradeType) },
    { width: 1, value: '' },
  ])

const stockPreOrderDepositType = (
  options: StockOrderPreOrderInput,
  tradeType: StockPreOrderTradeType,
) =>
  stockPreOrderSide(options, tradeType) === 'sell'
    ? orderDepositTypeCode(cashOrderDepositType(options))
    : ''

const stockPreOrderSide = (
  options: StockOrderPreOrderInput,
  tradeType: StockPreOrderTradeType,
): TradeSide => {
  if (tradeType === 'genwatashi') return 'sell'
  if (tradeType === 'genbiki') return 'buy'
  if (!('side' in options)) {
    throw new Error(`orders preOrder with tradeType "${tradeType}" requires side`)
  }
  return options.side
}

const stockPreOrderMarket = (
  options: StockOrderPreOrderInput,
  tradeType: StockPreOrderTradeType,
) => {
  if (tradeType === 'genbiki' || tradeType === 'genwatashi') return null
  if (!isCashPreOrderInput(options) || options.kind !== 's') {
    return domesticMarketToMts(options.market, 'orders preOrder')
  }
  if (!options.preOrderMarket) {
    throw new Error('orders.cash.preOrder with kind: "s" requires preOrderMarket')
  }
  return domesticMarketToMts(options.preOrderMarket, 'orders.cash.preOrder')
}

const stockPreOrderMarginCloseTradeType = (
  options: StockOrderPreOrderInput,
  tradeType: StockPreOrderTradeType,
) => {
  if (tradeType !== 'marginClose') return null
  const marginCloseTradeType = (options as MarginCloseOrderPreOrderOptions).marginCloseTradeType
  return marginCloseTradeType ? marginCloseTradeTypeCode(marginCloseTradeType) : null
}

const isCashPreOrderInput = (
  options: StockOrderPreOrderInput,
): options is CashOrderOptions | CashOrderPreOrderOptions => 'kind' in options

interface AppStockOrderTrinOptions {
  issueCode: string
  market: string
  quantity: number
  price?: number
  priceCondition: CashOrderPriceCondition
  depositType: AccountType | DepositType
  marginTradeTypeCode: string
  orderTermCode: string
  orderMethod: CashOrderMethod
  triggerZone?: CashOrderTriggerZone
  triggerPrice?: number
  marginPositions?: StockOrderMarginPosition[]
  bCode?: string
  ippanMarginPaymentLimit?: string
  secondaryPriceCondition?: CashOrderPriceCondition
  secondaryPrice?: number
  sorLastMarket?: string
  omitConfirmation?: boolean
  methodName: string
}

interface OmitConfirmationOption {
  omitConfirmation?: boolean
}

const appStockOrderTrin = (session: SbiSession, options: AppStockOrderTrinOptions) => {
  if (!session.tradePassword) {
    throw new Error(`${options.methodName} requires tradePassword in loginWithPasskey options`)
  }
  const isPriceBased = cashOrderPriceConditionRequiresPrice(options.priceCondition)
  const secondaryRequiresPrice =
    options.secondaryPriceCondition != null &&
    cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition)
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: options.market },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(options.priceCondition) },
    { width: 10, value: isPriceBased ? options.price : '' },
    { width: 1, value: orderDepositTypeCode(options.depositType) },
    { width: 1, value: options.marginTradeTypeCode },
    { width: 8, value: options.orderTermCode },
    ...stockOrderMarginPositionFields(options.marginPositions),
    { width: 3, value: cashOrderMethodCode(options.orderMethod) },
    { width: 1, value: triggerZoneCode(options.triggerZone) },
    { width: 10, value: options.triggerPrice ?? '' },
    { width: 1, value: options.omitConfirmation ? '1' : (options.bCode ?? '2') },
    { width: 1, value: '' },
    { width: 2, value: options.ippanMarginPaymentLimit ?? '' },
    {
      width: 1,
      value: options.secondaryPriceCondition
        ? cashOrderPriceConditionCode(options.secondaryPriceCondition)
        : '',
    },
    {
      width: 10,
      value: secondaryRequiresPrice ? options.secondaryPrice : '',
      align: 'right',
      pad: secondaryRequiresPrice ? '0' : ' ',
    },
    { width: 3, value: options.sorLastMarket ?? '' },
  ])
}

const appCashOrderTrin = (
  session: SbiSession,
  options: CashOrderOptions | PlaceCashOrderOptions,
) => {
  const depositType = orderDepositType(session, options, 'orders.cash')
  const standardOptions = options.kind === 's' ? undefined : options
  const priceCondition = cashOrderPriceCondition(options)
  return appStockOrderTrin(session, {
    issueCode: options.issueCode,
    market: orderMarketCode(options),
    quantity: options.quantity,
    price: standardOptions?.price,
    priceCondition,
    depositType,
    marginTradeTypeCode: '0',
    orderTermCode: cashOrderTermCode(options),
    orderMethod: cashOrderMethod(options),
    triggerZone: standardOptions?.triggerZone,
    triggerPrice: standardOptions?.triggerPrice,
    ippanMarginPaymentLimit: standardOptions?.ippanMarginPaymentLimit,
    secondaryPriceCondition: standardOptions?.secondaryPriceCondition,
    secondaryPrice: standardOptions?.secondaryPrice,
    sorLastMarket: sorLastMarketCode(session, options),
    omitConfirmation: 'omitConfirmation' in options ? options.omitConfirmation : undefined,
    methodName: 'orders.cash',
  })
}

const stockOrderMarginPositionFields = (
  positions: StockOrderMarginPosition[] = [],
  countWidth = 2,
) => {
  const maxCount = 10 ** countWidth - 1
  if (positions.length > maxCount) {
    throw new Error(`stock order marginPositions cannot exceed ${maxCount} records`)
  }
  return [
    { width: countWidth, value: positions.length.toString().padStart(countWidth, '0') },
    ...positions.flatMap((position) => [
      { width: 8, value: normalizeStockOrderRecordDate(position.openTradeDate, 'openTradeDate') },
      { width: 13, value: position.openPrice },
      { width: 8, value: position.quantity },
      {
        width: 8,
        value: normalizeStockOrderRecordDate(position.orgNewTradeDate, 'orgNewTradeDate'),
      },
      { width: 3, value: position.bargainMarketCode },
    ]),
  ]
}

const normalizeStockOrderRecordDate = (value: string, fieldName: string) => {
  const date = value.replace(/\D/g, '')
  if (date.length !== 8) {
    throw new Error(`stock order marginPositions.${fieldName} must be yyyyMMdd or yyyy-MM-dd`)
  }
  return date
}

const orderMarketCode = (options: { kind?: string; market: MarketCode }) => {
  if (options.kind === 's') {
    if (options.market !== 'STK') {
      throw new Error('orders.cash with kind: "s" requires market: "STK"')
    }
    return options.market
  }
  return domesticMarketToMts(options.market, 'orders')
}

const cashOrderDepositType = (options: { depositType?: DepositType; accountType?: AccountType }) =>
  options.depositType ?? options.accountType

const orderDepositType = (
  session: SbiSession,
  options: { depositType?: DepositType; accountType?: AccountType },
  methodName: string,
): AccountType | DepositType => {
  const depositType = cashOrderDepositType(options) ?? session.profile.accountType
  if (!depositType) {
    throw new Error(`${methodName} requires accountType or depositType when login profile has none`)
  }
  return depositType
}

const assertMarginOrderDepositType = (
  depositType: AccountType | DepositType,
  methodName: string,
) => {
  if (depositType !== 'specific') {
    throw new Error(
      `${methodName} requires depositType/accountType: "specific" for APK margin orders`,
    )
  }
}

const assertActualDeliveryDepositType = (
  depositType: AccountType | DepositType,
  methodName: string,
) => {
  if (depositType !== 'specific' && depositType !== 'general') {
    throw new Error(`${methodName} supports only "specific" or "general" depositType/accountType`)
  }
}

const CASH_ORDER_PRICE_CONDITION_CODES = {
  limit: '',
  limitAtOpen: 'Z',
  limitAtClose: 'I',
  limitIoc: 'P',
  market: 'N',
  marketAtOpen: 'Y',
  marketAtClose: 'H',
  marketIoc: 'O',
  funari: 'F',
} as const satisfies Record<CashOrderPriceCondition, string>

const PRICE_BASED_CASH_ORDER_CONDITIONS = new Set<CashOrderPriceCondition>([
  'limit',
  'limitAtOpen',
  'limitAtClose',
  'limitIoc',
  'funari',
])

const cashOrderPriceCondition = (options: CashOrderOptions): CashOrderPriceCondition => {
  if (options.kind === 's') return 'market'
  if (options.priceCondition) return options.priceCondition
  if (options.kind === 'limit' || options.price != null) return 'limit'
  return 'market'
}

const cashOrderPriceConditionCode = (value: CashOrderPriceCondition) =>
  CASH_ORDER_PRICE_CONDITION_CODES[value]

const cashOrderPriceConditionRequiresPrice = (value: CashOrderPriceCondition) =>
  PRICE_BASED_CASH_ORDER_CONDITIONS.has(value)

const CASH_ORDER_TERM_CODES = {
  day: '',
  week: 'WEEKLY',
} as const satisfies Record<Exclude<CashOrderTerm, 'date'>, string>

const cashOrderTermCode = (options: {
  kind?: OrderKind
  orderTerm?: CashOrderTerm
  orderDate?: string
}) => {
  if (options.kind === 's') return ''
  const term = options.orderTerm ?? 'day'
  return orderTermCode(term, options.orderDate)
}

const orderTermCode = (term: CashOrderTerm, date?: string) => {
  if (term === 'date') return normalizeOrderDate(date)
  return CASH_ORDER_TERM_CODES[term]
}

const normalizeOrderDate = (value: string | undefined) => {
  const date = value?.replace(/\D/g, '') ?? ''
  if (date.length !== 8) throw new Error('orders.cash orderDate must be yyyyMMdd or yyyy-MM-dd')
  return date
}

const CASH_ORDER_METHOD_CODES = {
  normal: '',
  stop: 'SLO',
  oco: 'OCO',
} as const satisfies Record<CashOrderMethod, string>

const cashOrderMethod = (options: {
  kind?: OrderKind
  price?: number
  orderMethod?: CashOrderMethod
}): CashOrderMethod => {
  if (options.kind === 's') return 'normal'
  if (options.orderMethod) return options.orderMethod
  if (options.kind === 'stop') return 'stop'
  if (options.kind === 'oco') return 'oco'
  return 'normal'
}

const cashOrderMethodCode = (value: CashOrderMethod) => CASH_ORDER_METHOD_CODES[value]

const TRIGGER_ZONE_CODES = {
  above: '0',
  below: '1',
} as const satisfies Record<CashOrderTriggerZone, string>

const triggerZoneCode = (value: CashOrderTriggerZone | undefined) =>
  value ? TRIGGER_ZONE_CODES[value] : ''

const secondaryPriceConditionCode = (options: CashOrderOptions) => {
  if (options.kind === 's') return ''
  return options.secondaryPriceCondition
    ? cashOrderPriceConditionCode(options.secondaryPriceCondition)
    : ''
}

const secondaryPriceConditionRequiresPrice = (options: CashOrderOptions) =>
  options.kind !== 's' &&
  options.secondaryPriceCondition != null &&
  cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition)

const ifdOrderPriceCondition = (options: IfdOrderOptions): CashOrderPriceCondition => {
  if (options.ifdPriceCondition) return options.ifdPriceCondition
  if (options.ifdPrice != null) return 'limit'
  return 'market'
}

const ifdOrderTermCode = (options: IfdOrderOptions) =>
  orderTermCode(options.ifdOrderTerm ?? 'day', options.ifdOrderDate)

const ifdOrderMethod = (options: IfdOrderOptions): CashOrderMethod => {
  if (options.ifdOrderMethod) return options.ifdOrderMethod
  if (options.kind === 'ifdo') return 'oco'
  return 'normal'
}

const ifdSecondaryPriceConditionCode = (options: IfdOrderOptions) =>
  options.ifdSecondaryPriceCondition
    ? cashOrderPriceConditionCode(options.ifdSecondaryPriceCondition)
    : ''

const ifdSecondaryPriceConditionRequiresPrice = (options: IfdOrderOptions) =>
  options.ifdSecondaryPriceCondition != null &&
  cashOrderPriceConditionRequiresPrice(options.ifdSecondaryPriceCondition)

const sorLastMarketCode = (
  _session: SbiSession,
  _options: {
    market: MarketCode
    sorLastMarket?: MarketCode
    depositType?: DepositType
    accountType?: AccountType
  },
) => {
  return ''
}

const marginOpenOrderTrin = (
  session: SbiSession,
  options: MarginOpenOrderOptions & OmitConfirmationOption,
) => {
  const depositType = orderDepositType(session, options, 'orders.margin.open')
  assertMarginOrderDepositType(depositType, 'orders.margin.open')
  const priceCondition = cashOrderPriceCondition(options)
  return appStockOrderTrin(session, {
    issueCode: options.issueCode,
    market: orderMarketCode(options),
    quantity: options.quantity,
    price: options.price,
    priceCondition,
    depositType,
    marginTradeTypeCode: marginOpenTradeTypeCode(options.marginTradeType),
    orderTermCode: cashOrderTermCode(options),
    orderMethod: cashOrderMethod(options),
    triggerZone: options.triggerZone,
    triggerPrice: options.triggerPrice,
    ippanMarginPaymentLimit: options.ippanMarginPaymentLimit,
    secondaryPriceCondition: options.secondaryPriceCondition,
    secondaryPrice: options.secondaryPrice,
    sorLastMarket: sorLastMarketCode(session, options),
    omitConfirmation: options.omitConfirmation,
    methodName: 'orders.margin.open',
  })
}

const marginCloseOrderTrin = (
  session: SbiSession,
  options: MarginCloseOrderOptions & OmitConfirmationOption,
) => {
  const depositType = orderDepositType(session, options, 'orders.margin.close')
  assertMarginOrderDepositType(depositType, 'orders.margin.close')
  const priceCondition = cashOrderPriceCondition(options)
  const secondaryRequiresPrice = secondaryPriceConditionRequiresPrice(options)
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: orderMarketCode(options) },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(priceCondition) },
    {
      width: 10,
      value: cashOrderPriceConditionRequiresPrice(priceCondition) ? options.price : '',
    },
    { width: 1, value: orderDepositTypeCode(depositType) },
    { width: 1, value: marginCloseTradeTypeCode(options.marginCloseTradeType) },
    { width: 8, value: cashOrderTermCode(options) },
    ...stockOrderMarginPositionFields(options.marginPositions, 4),
    { width: 3, value: cashOrderMethodCode(cashOrderMethod(options)) },
    { width: 1, value: triggerZoneCode(options.triggerZone) },
    { width: 10, value: options.triggerPrice ?? '' },
    { width: 1, value: options.omitConfirmation ? '1' : '2' },
    { width: 1, value: secondaryPriceConditionCode(options) },
    {
      width: 10,
      value: secondaryRequiresPrice ? options.secondaryPrice : '',
      align: 'right',
      pad: secondaryRequiresPrice ? '0' : ' ',
    },
    { width: 3, value: sorLastMarketCode(session, options) },
  ])
}

const marginCloseSummaryOrderTrin = (
  session: SbiSession,
  options: MarginCloseSummaryOrderOptions & OmitConfirmationOption,
) => {
  const depositType = orderDepositType(session, options, 'orders.margin.placeSummary')
  assertMarginOrderDepositType(depositType, 'orders.margin.placeSummary')
  const priceCondition = cashOrderPriceCondition(options)
  const secondaryRequiresPrice = secondaryPriceConditionRequiresPrice(options)
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: sideCode(options.side) },
    { width: 5, value: options.issueCode },
    { width: 3, value: orderMarketCode(options) },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(priceCondition) },
    {
      width: 10,
      value: cashOrderPriceConditionRequiresPrice(priceCondition) ? options.price : '',
    },
    { width: 1, value: orderDepositTypeCode(depositType) },
    { width: 1, value: marginCloseTradeTypeCode(options.marginCloseTradeType) },
    { width: 8, value: cashOrderTermCode(options) },
    { width: 3, value: cashOrderMethodCode(cashOrderMethod(options)) },
    { width: 1, value: triggerZoneCode(options.triggerZone) },
    { width: 10, value: options.triggerPrice ?? '' },
    { width: 2, value: marginClosePositionOrderCode(options.marginClosePositionOrder) },
    { width: 1, value: options.omitConfirmation ? '1' : '2' },
    { width: 1, value: secondaryPriceConditionCode(options) },
    {
      width: 10,
      value: secondaryRequiresPrice ? options.secondaryPrice : '',
      align: 'right',
      pad: secondaryRequiresPrice ? '0' : ' ',
    },
    { width: 3, value: sorLastMarketCode(session, options) },
  ])
}

const actualDeliveryOrderTrin = (
  session: SbiSession,
  options: ActualDeliveryOrderOptions & OmitConfirmationOption,
) => {
  const depositType = orderDepositType(session, options, 'orders.margin.actualDelivery')
  assertActualDeliveryDepositType(depositType, 'orders.margin.actualDelivery')
  return appStockOrderTrin(session, {
    issueCode: options.issueCode,
    market: orderMarketCode(options),
    quantity: options.quantity,
    priceCondition: 'market',
    depositType,
    marginTradeTypeCode: '0',
    orderTermCode: '',
    orderMethod: 'normal',
    marginPositions: options.marginPositions,
    ippanMarginPaymentLimit: options.ippanMarginPaymentLimit,
    omitConfirmation: options.omitConfirmation,
    methodName: 'orders.margin.actualDelivery',
  })
}

const MARGIN_OPEN_TRADE_TYPE_CODES = {
  standard: '6',
  generalBuy: '9',
  generalSellShort: 'A',
  generalSellInventoryLimited: 'B',
  generalSellInventoryUnlimited: 'C',
  day: 'D',
  hyper: 'E',
} as const satisfies Record<MarginOpenTradeType, string>

const marginOpenTradeTypeCode = (value: MarginOpenTradeType | undefined) => {
  const code = value ? MARGIN_OPEN_TRADE_TYPE_CODES[value] : undefined
  if (!code) throw new Error(`orders.margin.open unsupported marginTradeType: ${String(value)}`)
  return code
}

const MARGIN_CLOSE_TRADE_TYPE_CODES = {
  sixMonth: '6',
  noLimit: '9',
  oneDay: 'A',
  fifteenDay: 'D',
} as const satisfies Record<MarginCloseTradeType, string>

const marginCloseTradeTypeCode = (value: MarginCloseTradeType) => {
  const code = MARGIN_CLOSE_TRADE_TYPE_CODES[value]
  if (!code)
    throw new Error(`orders.margin.close unsupported marginCloseTradeType: ${String(value)}`)
  return code
}

const MARGIN_CLOSE_POSITION_ORDER_CODES = {
  profitFirst: '61',
  lossFirst: '51',
  newestFirst: '26',
  oldestFirst: '16',
  specify: '0',
} as const satisfies Record<MarginClosePositionOrder, string>

const marginClosePositionOrderCode = (value: MarginClosePositionOrder | undefined) => {
  const code = value ? MARGIN_CLOSE_POSITION_ORDER_CODES[value] : undefined
  if (!code) {
    throw new Error(
      `orders.margin.placeSummary unsupported marginClosePositionOrder: ${String(value)}`,
    )
  }
  return code
}

const ifdOrderTrin = (session: SbiSession, options: IfdOrderOptions & OmitConfirmationOption) => {
  if (!session.tradePassword) {
    throw new Error('orders.ifd requires tradePassword in loginWithPasskey options')
  }
  const depositType = orderDepositType(session, options, 'orders.ifd')
  const priceCondition = cashOrderPriceCondition(options)
  const ifdPriceCondition = ifdOrderPriceCondition(options)
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: options.market },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(priceCondition) },
    {
      width: 10,
      value: cashOrderPriceConditionRequiresPrice(priceCondition) ? options.price : '',
    },
    { width: 1, value: orderDepositTypeCode(depositType) },
    { width: 1, value: ifdPrimaryMarginTradeTypeCode(options) },
    { width: 8, value: cashOrderTermCode(options) },
    { width: 3, value: cashOrderMethodCode(cashOrderMethod(options)) },
    { width: 1, value: triggerZoneCode(options.triggerZone) },
    { width: 10, value: options.triggerPrice ?? '' },
    { width: 1, value: options.omitConfirmation ? '1' : '2' },
    { width: 1, value: '' },
    { width: 2, value: options.ippanMarginPaymentLimit ?? '' },
    { width: 1, value: secondaryPriceConditionCode(options) },
    {
      width: 10,
      value: secondaryPriceConditionRequiresPrice(options) ? options.secondaryPrice : '',
      align: 'right',
      pad: secondaryPriceConditionRequiresPrice(options) ? '0' : ' ',
    },
    { width: 4, value: 'IF' },
    { width: 1, value: cashOrderPriceConditionCode(ifdPriceCondition) },
    {
      width: 10,
      value: cashOrderPriceConditionRequiresPrice(ifdPriceCondition) ? options.ifdPrice : '',
      align: 'right',
      pad: '0',
    },
    { width: 8, value: ifdOrderTermCode(options) },
    { width: 3, value: cashOrderMethodCode(ifdOrderMethod(options)) },
    { width: 1, value: triggerZoneCode(options.ifdTriggerZone) },
    {
      width: 10,
      value: options.ifdTriggerPrice ?? '',
      align: 'right',
      pad: options.ifdTriggerPrice != null ? '0' : ' ',
    },
    { width: 1, value: ifdSecondaryPriceConditionCode(options) },
    {
      width: 10,
      value: ifdSecondaryPriceConditionRequiresPrice(options) ? options.ifdSecondaryPrice : '',
      align: 'right',
      pad: options.ifdSecondaryPriceCondition ? '0' : ' ',
    },
  ])
}

const ifdPrimaryMarginTradeTypeCode = (options: IfdOrderOptions) =>
  options.tradeType === 'marginOpen' ? marginOpenTradeTypeCode(options.marginTradeType) : '0'

const orderCorrectionSubmitTrin = (session: SbiSession, options: OrderCorrectionOptions) => {
  if (!session.tradePassword) {
    throw new Error('orders correction submit requires tradePassword in loginWithPasskey options')
  }
  const required = {
    orderNumber: options.orderNumber,
    orderId: options.orderId,
    issueCode: options.issueCode,
    market: options.market,
    tradeId: options.tradeId,
    quantity: options.quantity,
  }
  const missing = Object.entries(required)
    .filter(([, value]) => value == null || value === '')
    .map(([key]) => key)
  if (missing.length) {
    throw new Error(`orders correction submit requires ${missing.join(', ')}`)
  }
  const priceCondition = orderCorrectionPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(priceCondition) && options.price == null) {
    throw new Error(`orders correction priceCondition: "${priceCondition}" requires price`)
  }
  if (!cashOrderPriceConditionRequiresPrice(priceCondition) && options.price != null) {
    throw new Error(`orders correction priceCondition: "${priceCondition}" cannot specify price`)
  }
  const secondaryRequiresPrice =
    options.secondaryPriceCondition != null &&
    cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition)
  if (secondaryRequiresPrice && options.secondaryPrice == null) {
    throw new Error('orders correction secondaryPriceCondition requires secondaryPrice')
  }
  if (
    options.secondaryPriceCondition != null &&
    !secondaryRequiresPrice &&
    options.secondaryPrice != null
  ) {
    throw new Error('orders correction secondaryPriceCondition cannot specify secondaryPrice')
  }
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: 'P' },
    { width: 6, value: options.orderNumber },
    { width: 7, value: options.orderId },
    { width: 5, value: options.issueCode },
    { width: 3, value: options.market },
    { width: 1, value: options.tradeId },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(priceCondition) },
    { width: 10, value: cashOrderPriceConditionRequiresPrice(priceCondition) ? options.price : '' },
    { width: 12, value: options.depositTypeText ?? '' },
    { width: 1, value: options.status ?? '' },
    { width: 3, value: cashOrderMethodCode(options.orderMethod ?? 'normal') },
    { width: 1, value: triggerZoneCode(options.triggerZone) },
    { width: 10, value: options.triggerPrice ?? '' },
    { width: 1, value: options.rbeOrderStatus ?? '' },
    { width: 1, value: options.correctionControlFlag ?? '2' },
    { width: 1, value: orderCorrectionSecondaryPriceConditionCode(options) },
    {
      width: 10,
      value: secondaryRequiresPrice ? options.secondaryPrice : '',
      align: 'right',
      pad: secondaryRequiresPrice ? '0' : ' ',
    },
  ])
}

const orderIfdCorrectionSubmitTrin = (session: SbiSession, options: OrderCorrectionOptions) => {
  const primary = orderCorrectionSubmitTrin(session, options)
  const ifdPriceCondition = orderCorrectionIfdPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(ifdPriceCondition) && options.ifdPrice == null) {
    throw new Error(
      `orders ifd correction ifdPriceCondition: "${ifdPriceCondition}" requires ifdPrice`,
    )
  }
  if (!cashOrderPriceConditionRequiresPrice(ifdPriceCondition) && options.ifdPrice != null) {
    throw new Error(
      `orders ifd correction ifdPriceCondition: "${ifdPriceCondition}" cannot specify ifdPrice`,
    )
  }
  const ifdSecondaryRequiresPrice =
    options.ifdSecondaryPriceCondition != null &&
    cashOrderPriceConditionRequiresPrice(options.ifdSecondaryPriceCondition)
  if (ifdSecondaryRequiresPrice && options.ifdSecondaryPrice == null) {
    throw new Error('orders ifd correction ifdSecondaryPriceCondition requires ifdSecondaryPrice')
  }
  if (
    options.ifdSecondaryPriceCondition != null &&
    !ifdSecondaryRequiresPrice &&
    options.ifdSecondaryPrice != null
  ) {
    throw new Error(
      'orders ifd correction ifdSecondaryPriceCondition cannot specify ifdSecondaryPrice',
    )
  }
  return (
    primary +
    fixedTrin([
      { width: 4, value: 'IF' },
      { width: 1, value: cashOrderPriceConditionCode(ifdPriceCondition) },
      {
        width: 10,
        value: cashOrderPriceConditionRequiresPrice(ifdPriceCondition) ? options.ifdPrice : '',
        align: 'right',
        pad: '0',
      },
      { width: 3, value: cashOrderMethodCode(options.ifdOrderMethod ?? 'normal') },
      { width: 1, value: triggerZoneCode(options.ifdTriggerZone) },
      {
        width: 10,
        value: options.ifdTriggerPrice ?? '',
        align: 'right',
        pad: options.ifdTriggerPrice != null ? '0' : ' ',
      },
      {
        width: 1,
        value: options.ifdSecondaryPriceCondition
          ? cashOrderPriceConditionCode(options.ifdSecondaryPriceCondition)
          : '',
      },
      {
        width: 10,
        value: ifdSecondaryRequiresPrice ? options.ifdSecondaryPrice : '',
        align: 'right',
        pad: ifdSecondaryRequiresPrice ? '0' : ' ',
      },
    ])
  )
}

const orderCorrectionPreOrderTrin = (session: SbiSession, options: OrderCorrectionOptions) => {
  if (!options.orderNumber) {
    throw new Error('orders correction pre-order requires orderNumber')
  }
  return fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 6, value: options.orderNumber },
    { width: 1, value: options.tradeId ?? '' },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: options.correctionType ?? '' },
  ])
}

const orderCorrectionPriceCondition = (
  options: OrderCorrectionOptions,
): CashOrderPriceCondition => {
  if (options.priceCondition) return options.priceCondition
  if (options.price != null) return 'limit'
  return 'market'
}

const orderCorrectionSecondaryPriceConditionCode = (options: OrderCorrectionOptions) =>
  options.secondaryPriceCondition
    ? cashOrderPriceConditionCode(options.secondaryPriceCondition)
    : ''

const orderCorrectionIfdPriceCondition = (
  options: OrderCorrectionOptions,
): CashOrderPriceCondition => {
  if (options.ifdPriceCondition) return options.ifdPriceCondition
  if (options.ifdPrice != null) return 'limit'
  return 'market'
}

const orderCancelPreOrderTrin = (session: SbiSession, options: OrderCancelOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 6, value: options.orderNumber },
    { width: 1, value: options.tradeId ?? '' },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: options.cancelType ?? '' },
  ])

const orderCancelSubmitTrin = (session: SbiSession, options: PlaceOrderCancelOptions) =>
  fixedTrin([
    { width: 32, value: mtsTradePassword(options.tradePassword ?? session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: '' },
    { width: 6, value: options.orderNumber },
    { width: 7, value: '' },
    { width: 5, value: '' },
    { width: 3, value: '' },
    { width: 1, value: options.tradeId ?? '' },
    { width: 8, value: '' },
    { width: 1, value: '' },
    { width: 10, value: '' },
    { width: 12, value: '' },
    { width: 1, value: '' },
    { width: 3, value: '' },
    { width: 1, value: '' },
    { width: 10, value: '' },
    { width: 1, value: '' },
    { width: 1, value: '' },
    { width: 1, value: '' },
    { width: 10, value: '', align: 'right', pad: ' ' },
  ])

const themePreOrderTrin = (session: SbiSession, options: ThemeInvestmentPreOrderOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 4, value: options.components.length },
    ...options.components.flatMap((component) => [
      { width: 5, value: component.issueCode },
      { width: 3, value: options.exchangeCode },
    ]),
  ])

const themeOrderTrin = (session: SbiSession, options: ThemeInvestmentOrderOptions) => {
  const depositType = orderDepositType(session, options, 'orders.themeInvestment')
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 10, value: options.themeId },
    { width: 6, value: options.themeSetYyyymm },
    { width: 2, value: options.themeCourse },
    { width: 1, value: orderDepositTypeCode(depositType) },
    { width: 1, value: '0' },
    { width: 8, value: null },
    { width: 2, value: String(options.components.length).padStart(2, '0') },
    ...options.components.flatMap((component) => [
      { width: 5, value: component.issueCode },
      { width: 1, value: 'N' },
      { width: 10, value: '' },
      { width: 8, value: component.quantity },
    ]),
  ])
}

const cashPreOrderTrCode = (options: CashOrderOptions | CashOrderPreOrderOptions) =>
  options.side === 'sell' ? 'F2102' : 'F2101'

const stockPreOrderTrCode = (tradeType: StockPreOrderTradeType, side: TradeSide) => {
  if (tradeType === 'cash') return side === 'sell' ? 'F2102' : 'F2101'
  if (tradeType === 'marginOpen') return side === 'sell' ? 'F2113' : 'F2103'
  if (tradeType === 'marginClose') return side === 'sell' ? 'F2211' : 'F2201'
  return tradeType === 'genwatashi' ? 'F2214' : 'F2204'
}

const cashConfirmTrCode = (options: CashOrderOptions) => {
  if (options.kind === 'ifd') return 'F2151'
  return options.side === 'sell' ? 'F2124' : 'F2104'
}

const cashReceptionTrCode = (options: PlaceCashOrderOptions) => {
  if (options.kind === 'ifd') return 'F2161'
  return options.side === 'sell' ? 'F2135' : 'F2105'
}

const marginOpenConfirmTrCode = (options: MarginOpenOrderOptions) =>
  options.side === 'sell' ? 'F2126' : 'F2125'

const marginOpenReceptionTrCode = (options: MarginOpenOrderOptions) =>
  options.side === 'sell' ? 'F2137' : 'F2136'

const marginCloseConfirmTrCode = (options: MarginCloseOrderOptions) =>
  options.side === 'sell' ? 'F2292' : 'F2282'

const marginCloseReceptionTrCode = (options: MarginCloseOrderOptions) =>
  options.side === 'sell' ? 'F2293' : 'F2283'

const marginCloseSummaryConfirmTrCode = (options: MarginCloseOrderOptions) =>
  options.side === 'sell' ? 'F2262' : 'F2242'

const marginCloseSummaryReceptionTrCode = (options: MarginCloseOrderOptions) =>
  options.side === 'sell' ? 'F2263' : 'F2243'

const actualDeliveryConfirmTrCode = (options: ActualDeliveryOrderOptions) =>
  options.kind === 'genwatashi' ? 'F2225' : 'F2205'

const actualDeliveryReceptionTrCode = (options: ActualDeliveryOrderOptions) =>
  options.kind === 'genwatashi' ? 'F2236' : 'F2206'

const actualDeliverySide = (options: Pick<ActualDeliveryOrderOptions, 'kind'>): TradeSide =>
  options.kind === 'genwatashi' ? 'sell' : 'buy'

const ifdConfirmTrCode = (options: IfdOrderOptions) => {
  if (options.tradeType === 'marginOpen') return options.side === 'sell' ? 'F2154' : 'F2153'
  return options.side === 'sell' ? 'F2152' : 'F2151'
}

const ifdReceptionTrCode = (options: IfdOrderOptions) => {
  if (options.tradeType === 'marginOpen') return options.side === 'sell' ? 'F2164' : 'F2163'
  return options.side === 'sell' ? 'F2162' : 'F2161'
}

const padField = (
  value: string | number | null | undefined,
  width: number,
  align: 'left' | 'right' = 'left',
  pad = ' ',
) => {
  const clipped = clipShiftJisField(String(value ?? ''), width)
  const padding = pad.repeat(Math.max(0, width - shiftJisByteLength(clipped)))
  return align === 'right' ? `${padding}${clipped}` : `${clipped}${padding}`
}

const clipShiftJisField = (value: string, width: number) => {
  let clipped = ''
  let length = 0
  for (const char of value) {
    const charLength = shiftJisByteLength(char)
    if (length + charLength > width) break
    clipped += char
    length += charLength
  }
  return clipped
}

const shiftJisByteLength = (value: string) => iconv.encode(value, 'Shift_JIS').length

const encodeMtsForm = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${formEncodeShiftJis(key)}=${formEncodeShiftJis(value)}`)
    .join('&')

const formEncodeShiftJis = (value: string) => {
  let encoded = ''
  for (const char of value) {
    const charCode = char.codePointAt(0)
    if (char === ' ') {
      encoded += '+'
    } else if (charCode != null && isJavaUrlEncoderSafeAscii(charCode)) {
      encoded += char
    } else {
      for (const byte of iconv.encode(char, 'Shift_JIS')) {
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
      }
    }
  }
  return encoded
}

const isJavaUrlEncoderSafeAscii = (charCode: number) =>
  (charCode >= 0x30 && charCode <= 0x39) ||
  (charCode >= 0x41 && charCode <= 0x5a) ||
  (charCode >= 0x61 && charCode <= 0x7a) ||
  charCode === 0x2d ||
  charCode === 0x2e ||
  charCode === 0x2a ||
  charCode === 0x5f

const optionsWithPaging = (options?: { index?: number; limit?: number }) => ({
  index: options?.index ?? DEFAULT_PAGE_INDEX,
  limit: options?.limit ?? DEFAULT_PAGE_LIMIT,
})

const hasPaging = (options: unknown): options is { index?: number; limit?: number } =>
  typeof options === 'object' && options !== null && ('index' in options || 'limit' in options)

const filterCashPositions = (
  list: CashPositionList,
  options?: IssueOptions | CashPositionOptions,
): CashPositionList => ({
  ...list,
  positions: list.positions.filter((position) => matchesIssue(position.issue, options)),
})

const filterMarginPositions = (
  list: MarginPositionList,
  options?: IssueOptions | MarginPositionOptions,
): MarginPositionList => ({
  ...list,
  positions: list.positions.filter((position) => matchesIssue(position.issue, options)),
})

const matchesIssue = (
  issue: IssueRef,
  options?: IssueOptions | CashPositionOptions | MarginPositionOptions,
) =>
  (!options?.issueCode || issue.code === options.issueCode) &&
  (!options?.market || issue.market === options.market)

const parseTrailingError = (
  reader: ReturnType<typeof makeFixedReader>,
  response: MtsResponse,
): SbiMethodError | undefined => {
  if (reader.remaining < 207) return undefined
  const status = reader.text(1)
  const code = reader.text(6)
  const message = reader.text(200)
  const error = {
    status: emptyToUndefined(status),
    code: emptyToUndefined(code),
    message: emptyToUndefined(message),
  }
  throwIfMethodError(error, response)
  return error
}

const throwIfMtsHeaderError = (header: MtsHeader, requestUrl: string) => {
  if (!header.resultCode || header.resultCode === '000000') return
  throw new SbiServerError({
    code: header.resultCode,
    trCode: header.trCode,
    requestUrl,
  })
}

const throwIfMethodError = (error: SbiMethodError, response: MtsResponse) => {
  if (!error.code || error.code === '000000') return
  throw new SbiServerError({
    code: error.code,
    status: error.status,
    serverMessage: error.message,
    trCode: response.header.trCode,
    requestUrl: response.requestUrl,
  })
}

const methodErrorFromHeader = (response: MtsResponse): SbiMethodError | undefined =>
  response.header.resultCode && response.header.resultCode !== '000000'
    ? { code: response.header.resultCode }
    : undefined

const readShiftJisField = (buffer: Buffer, offset: number, width: number) =>
  decodeShiftJis(buffer.subarray(offset, offset + width)).trim()

const decodeShiftJis = (value: Buffer | ArrayBuffer | Uint8Array) =>
  new TextDecoder('shift_jis' as never).decode(
    value instanceof Buffer ? value : new Uint8Array(value),
  )

const parseNumber = (text: string, after?: () => void) => {
  after?.()
  const normalized = text
    .replace(/[,\s円株%]/g, '')
    .replace(/^△/, '-')
    .replace(/[()]/g, '')
  if (!normalized || normalized === '-' || normalized === '--') return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

const yen = (text: string): CurrencyAmount => ({
  value: parseNumber(text),
  text: text.trim(),
  currency: 'JPY',
})

const chartYen = (text: string): CurrencyAmount => {
  const value = parseNumber(text)
  return {
    value: value == null ? null : value * 0.01,
    text: text.trim(),
    currency: 'JPY',
  }
}

const percent = (text: string): PercentValue => ({ value: parseNumber(text), text: text.trim() })

const signed = (text: string, flag?: string): SignedTextValue => {
  const value = parseNumber(text)
  return {
    value,
    text: text.trim(),
    sign: flagToSign(flag, value),
  }
}

const flagToSign = (flag: string | undefined, value: number | null): SignedTextValue['sign'] => {
  if (value === 0) return 'zero'
  if (flag === '1' || flag === '+' || (value != null && value > 0)) return 'positive'
  if (flag === '2' || flag === '-' || (value != null && value < 0)) return 'negative'
  return undefined
}

const addSignedTextValues = (
  left?: SignedTextValue,
  right?: SignedTextValue,
): SignedTextValue | undefined => {
  if (left?.value == null && right?.value == null) return undefined
  const value = (left?.value ?? 0) + (right?.value ?? 0)
  return { value, text: String(value), sign: flagToSign(undefined, value) }
}

const sumCurrencyAmounts = (
  amounts: Array<CurrencyAmount | undefined>,
): CurrencyAmount | undefined => {
  const values = amounts
    .map((amount) => amount?.value)
    .filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return undefined
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    value: total,
    text: total.toLocaleString('ja-JP'),
    currency: 'JPY',
  }
}

const emptyToUndefined = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const emptyControlFieldToUndefined = (value: string | undefined) => {
  const trimmed = value?.replaceAll('\0', '').trim()
  return trimmed ? trimmed : undefined
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const extractIssueName = (value: string) => {
  const parts = value.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : emptyToUndefined(value)
}

const subtractNullable = (left: number | null, right: number | null) => {
  if (left == null) return null
  return left - (right ?? 0)
}

const parseNumberFromParentheses = (value: string) => parseNumber(inParentheses(value) ?? '')
const inParentheses = (value: string) => value.match(/\(([^)]*)\)/)?.[1]
const beforeParentheses = (value: string) => value.split('(')[0] ?? value
const firstColonValue = (value: string) => value.split(':')[0] ?? value
const priceBeforeTimestamp = (value: string) => beforeParentheses(firstColonValue(value))
const lastReadFlag = (reader: ReturnType<typeof makeFixedReader>) => reader.lastFlag

const safeCount = (reader: ReturnType<typeof makeFixedReader>, width: number) => {
  const count = reader.int(width)
  if (count == null || count < 0 || count > 1000) return 0
  return count
}

const collectMessages = (text: string) =>
  text
    .slice(MTS_HEADER_BYTES)
    .replaceAll('\u0000', '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /[ぁ-んァ-ン一-龯A-Za-z]/.test(line))
    .slice(0, 20)

const joinDateTime = (date: string, time: string) => {
  const d = date.replace(/\D/g, '')
  const t = time.replace(/\D/g, '')
  if (d.length !== 8) return undefined
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}${t.length >= 4 ? `T${t.slice(0, 2)}:${t.slice(2, 4)}:00` : ''}`
}

const mapAccountType = (value: string | undefined) => {
  if (value === '0') return 'specific'
  if (value === '1' || value === '-') return 'general'
  if (value === 'H') return 'growthInvestment'
  if (value === '4') return 'nisa'
  if (['5', '6', '7', 'J'].includes(value ?? '')) return 'juniorNisa'
  return 'unknown'
}

const mapDepositType = (value: string | undefined) => mapAccountType(value)

const depositTypeCode = (value: BoardOptions['accountType']) => {
  if (value === 'specific') return '1'
  if (value === 'nisa') return '2'
  if (value === 'juniorNisa') return '3'
  if (value === 'general') return '0'
  return ''
}

const orderDepositTypeCode = (value: AccountType | undefined) => {
  if (value === 'specific') return '0'
  if (value === 'general') return '1'
  if (value === 'growthInvestment') return 'H'
  if (value === 'nisa') return '4'
  if (value === 'juniorNisa') return '5'
  return ''
}

const mtsTradePassword = (value: string | undefined) => value?.replaceAll('¥', '\\') ?? ''

const mapSide = (value: string | undefined): TradeSide =>
  value && ['1', '3', '5', '7', '9', 'A', 'D'].includes(value) ? 'buy' : 'sell'
const sideCode = (side?: TradeSide) => (side === 'sell' ? '2' : side === 'buy' ? '1' : '')

const mapOrderStatusCode = (value: string | undefined): OrderStatus | undefined => {
  if (!value) return undefined
  if (['0', '1', '2', '7', '8', '9', 'A'].includes(value)) return 'open'
  if (value === '3') return 'cancelled'
  if (value === '4') return 'expired'
  if (value === '5') return 'executed'
  if (value === '6') return 'rejected'
  return undefined
}

const mapOrderStatus = (text: string): OrderStatus => {
  if (/約定|全部/.test(text)) return 'executed'
  if (/取消/.test(text)) return 'cancelled'
  if (/失効/.test(text)) return 'expired'
  if (/拒否|エラー/.test(text)) return 'rejected'
  if (/受付|注文|未約定/.test(text)) return 'open'
  return 'unknown'
}

export type { SbiClientMethods }
