import { createHash } from 'node:crypto'
import * as iconv from 'iconv-lite'
import type {
  AccountType,
  Board,
  BoardPriceLevel,
  BuyingPower,
  CashPosition,
  CashPositionList,
  ChartPeriod,
  ChartPrice,
  CurrencyAmount,
  DomesticMarket,
  IssueChart,
  IssueRef,
  IssueSearchItem,
  IssueSearchResult,
  IssueSearchStatus,
  MarginPosition,
  MarginPositionList,
  MarketIndex,
  NewsItem,
  NewsList,
  Order,
  OrderList,
  OrderPreview,
  OrderReceipt,
  OrderStatus,
  PercentValue,
  Quote,
  Ranking,
  RankingItem,
  SbiMethodError,
  SbiSession,
  SbiTradeAuthenticationRequest,
  SignedTextValue,
  ThemeInvestmentList,
  TradeSide,
  Watchlist,
} from '../types'
import type {
  AccountPowerOptions,
  ActualDeliveryOrderOptions,
  BoardOptions,
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
  MarginCloseOrderOptions,
  MarginOpenOrderOptions,
  MarketIssueBoardPollingOptions,
  MarginPositionOptions,
  OrderCancelOptions,
  OrderCorrectionOptions,
  OrderInquiryOptions,
  PlaceCashOrderOptions,
  PlaceOrderCancelOptions,
  SbiClientMethods,
  ThemeInvestmentOrderOptions,
} from './types'
import { SbiServerError } from './error-map'

const COMM_GATE_PATH = '/mtsmobile/commgate'
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

type MtsHeader = {
  sessionId: string
  trCode: string
  resultCode: string
  notification: string
  lastExecutionTime: string
  maintenance: string
}

type MtsResponse = {
  status: number
  requestUrl: string
  header: MtsHeader
  buffer: Buffer
  text: string
}

type FixedField = {
  width: number
  value?: string | number | null
  align?: 'left' | 'right'
  pad?: string
}

type OrderPreviewInput = {
  issueCode: string
  market?: string
  side: TradeSide
  quantity?: number
  price?: number
}

type CashPreOrderInfo = {
  issueCode?: string
  market?: string
  issueName?: string
}

const cashCorrectionPreviewInput = {
  issueCode: '',
  market: '',
  side: 'buy',
} satisfies OrderPreviewInput

type TradeAuthenticationStatus = 'success' | 'needDial' | 'excessivelyRequested' | 'unexpected'

type TradeAuthenticationInfo = {
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

type IzanagiIssueSearchItem = {
  stockName?: string | null
  stockCode?: string | null
  mkt?: string | null
  extract?: string | null
  extractWord?: string | null
  boldFrom?: string | null
  boldTo?: string | null
  hitString?: string | null
}

type IzanagiIssueSearchResponse = {
  status?: string | null
  stocks?: IzanagiIssueSearchItem[] | null
}

export const registerDeviceId = async (session: SbiSession, deviceId: string) => {
  await callMts(session, 'F1131', fixedTrin([{ width: 36, value: deviceId }]))
}

export const createMethodsFromSession = (session: SbiSession): SbiClientMethods => {
  const client: SbiClientMethods = {
    session: {
      profile: async () => session.profile,
    },
    account: {
      profile: async () => session.profile,
      power: {
        buyingPower: async (options) => fetchAccountPower(session, options),
        collateralRatio: async (options) =>
          fetchAccountPower(session, { includeMarginAccount: true, ...options }),
      },
      positions: {
        cash: async (options) =>
          parseCashPositions(
            await callMts(session, 'F2631', listAccountTrin(session, options)),
            options,
          ),
        cashDetail: async (options) =>
          parseCashPositions(
            await callMts(session, 'F2632', listAccountTrin(session, options)),
            options,
          ),
        cashForIssue: async (options) => {
          const list = parseCashPositions(
            await callMts(session, 'F2602', issuePositionTrin(session, options)),
            options,
          )
          return filterCashPositions(list, options)
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
        unrealized: async () => {
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
          callIssueSearch(session, ISSUE_SEARCH_PATH, 'inputWord', options),
        suggest: async (options) => callIssueSearch(session, ISSUE_SUGGEST_PATH, 'term', options),
        allowedPrices: async (options) =>
          parseAllowedPrices(await callMts(session, 'F1112', issueTrin(options)), options),
        board: async (options) =>
          parseBoardLike(await callMts(session, 'F1207', issueTrin(options)), options),
        pollBoard: (options) =>
          pollMarketIssueBoard(
            async () =>
              parseBoardLike(await callMts(session, 'F1207', issueTrin(options)), options),
            options,
          ),
        chart: async (options) =>
          parseIssueChart(
            await callMtsReturningHeaderError(session, 'F1851', issueChartTrin(options)),
            options,
          ),
        openOrders: async (options) =>
          parseOrdersLoose(
            await callMtsReturningHeaderError(session, 'F2504', openOrdersTrin(session, options)),
            options,
          ),
        tradingInfo: async (options) =>
          parseBoardLike(
            await callMts(session, tradingInfoTrCode(options), tradingInfoTrin(session, options)),
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
          parseOrdersLoose(
            await callMtsReturningHeaderError(session, 'F2503', orderInquiryTrin(session, options)),
            options,
          ),
        open: async (options) =>
          parseOrdersLoose(
            await callMtsReturningHeaderError(session, 'F2511', recentOrdersTrin(session, options)),
            options,
          ),
      },
      cash: {
        estimate: async (options) => {
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
          parseOrderPreview(
            await callMts(session, 'F2301', orderCorrectionTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        estimateCorrectionConfirm: async (options) =>
          parseOrderPreview(
            await callMts(session, 'F2302', orderCorrectionTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        placeCorrection: async (options) => {
          assertTradingAllowed(options, 'orders.cash.placeCorrection')
          return parseOrderReceipt(
            await callMts(session, 'F2302', orderCorrectionTrin(session, options)),
          )
        },
        estimateCancel: async (options) =>
          parseOrderPreview(
            await callMts(session, 'F2311', orderCancelPreOrderTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        placeCancel: async (options) => {
          assertTradingAllowed(options, 'orders.cash.placeCancel')
          return parseOrderReceipt(
            await callMts(session, 'F2302', orderCancelSubmitTrin(session, options)),
          )
        },
      },
      margin: {
        estimateOpen: async (options) =>
          parseOrderPreview(
            await callMtsReturningHeaderError(
              session,
              marginOpenConfirmTrCode(options),
              marginOpenOrderTrin(session, options),
            ),
            options,
          ),
        open: async (options) => {
          assertTradingAllowed(options, 'orders.margin.open')
          return parseOrderReceipt(
            await callMtsReturningHeaderError(
              session,
              marginOpenReceptionTrCode(options),
              marginOpenOrderTrin(session, options),
            ),
          )
        },
        estimateClose: async (options) =>
          parseOrderPreview(
            await callMts(
              session,
              marginCloseConfirmTrCode(options),
              orderConfirmTrin(session, options),
            ),
            options,
          ),
        close: async (options) => {
          assertTradingAllowed(options, 'orders.margin.close')
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseReceptionTrCode(options),
              orderConfirmTrin(session, options),
            ),
          )
        },
        estimateCloseSummary: async (options) =>
          parseOrderPreview(
            await callMts(
              session,
              marginCloseConfirmTrCode(options),
              orderConfirmTrin(session, options),
            ),
            options,
          ),
        closeSummary: async (options) => {
          assertTradingAllowed(options, 'orders.margin.closeSummary')
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseReceptionTrCode(options),
              orderConfirmTrin(session, options),
            ),
          )
        },
        estimateSummary: async (options) =>
          parseOrderPreview(
            await callMts(
              session,
              marginCloseSummaryConfirmTrCode(options),
              marginSummaryOrderTrin(session, options),
            ),
            options,
          ),
        placeSummary: async (options) => {
          assertTradingAllowed(options, 'orders.margin.placeSummary')
          return parseOrderReceipt(
            await callMts(
              session,
              marginCloseSummaryReceptionTrCode(options),
              marginSummaryOrderTrin(session, options),
            ),
          )
        },
        estimateActualDelivery: async (options) =>
          parseOrderPreview(
            await callMts(
              session,
              actualDeliveryConfirmTrCode(options),
              actualDeliveryOrderTrin(session, options),
            ),
            { ...options, side: actualDeliverySide(options) },
          ),
        actualDelivery: async (options) => {
          assertTradingAllowed(options, 'orders.margin.actualDelivery')
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
        estimate: async (options) =>
          parseOrderPreview(
            await callMts(session, ifdConfirmTrCode(options), ifdOrderTrin(session, options)),
            options,
          ),
        place: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.place')
          return parseOrderReceipt(
            await callMts(session, ifdReceptionTrCode(options), ifdOrderTrin(session, options)),
          )
        },
        estimateCorrection: async (options) =>
          parseOrderPreview(
            await callMts(session, 'F2331', orderCorrectionTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        placeCorrection: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.placeCorrection')
          return parseOrderReceipt(
            await callMts(session, 'F2332', orderCorrectionTrin(session, options)),
          )
        },
        estimateCancel: async (options) =>
          parseOrderPreview(
            await callMts(session, 'F2331', orderCorrectionTrin(session, options)),
            cashCorrectionPreviewInput,
          ),
        placeCancel: async (options) => {
          assertTradingAllowed(options, 'orders.ifd.placeCancel')
          return parseOrderReceipt(
            await callMts(session, 'F2332', orderCorrectionTrin(session, options)),
          )
        },
      },
      themeInvestment: {
        list: async () => parseThemeInvestmentList(await callMts(session, 'F1750')),
        estimate: async (options) =>
          parseThemeOrderPreview(
            await callMts(session, 'F1904', themeOrderTrin(session, options)),
            options,
          ),
        place: async (options) => {
          assertTradingAllowed(options, 'orders.themeInvestment.place')
          return parseOrderReceipt(
            await callMts(session, 'F1905', themeOrderTrin(session, options)),
          )
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
    market: emptyJsonString(item.mkt),
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
      issue: { code, market: emptyToUndefined(market), name: extractIssueName(issueName) },
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
      issue: { code, market: emptyToUndefined(market), name: extractIssueName(issueName) },
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
      issue: { code, market: emptyToUndefined(market), name: emptyToUndefined(name) },
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
      issue: { code, market: emptyToUndefined(market), name: emptyToUndefined(name) },
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
      market: emptyToUndefined(market) ?? options.market,
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
    market: emptyToUndefined(market) ?? options.market,
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
      market: emptyToUndefined(market),
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
        market: emptyToUndefined(market),
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

const parseThemeInvestmentList = (_response: MtsResponse): ThemeInvestmentList => ({ themes: [] })

const assertTradingAllowed = (options: { allowTrading?: true }, name: string) => {
  if (options.allowTrading !== true) {
    throw new Error(
      `${name} requires allowTrading: true because it can place or modify a real order`,
    )
  }
}

const assertCashOrderOptions = (options: CashOrderOptions) => {
  if (options.kind === 's') {
    const optionRecord = options as Record<string, unknown>
    const unsupportedFields = [
      'price',
      'priceCondition',
      'orderTerm',
      'orderDate',
      'orderMethod',
      'triggerZone',
      'triggerPrice',
      'secondaryPriceCondition',
      'secondaryPrice',
      'sorLastMarket',
    ].filter((key) => key in optionRecord && optionRecord[key] != null)
    if (unsupportedFields.length) {
      throw new Error(`orders.cash with kind: "s" cannot specify ${unsupportedFields.join(', ')}`)
    }
    if (options.market !== 'STK') {
      throw new Error('orders.cash with kind: "s" requires market: "STK"')
    }
    if (!Number.isInteger(options.quantity)) {
      throw new Error('orders.cash with kind: "s" requires an integer quantity')
    }
    return
  }

  const priceCondition = cashOrderPriceCondition(options)
  if (cashOrderPriceConditionRequiresPrice(priceCondition) && options.price == null) {
    throw new Error(`orders.cash priceCondition: "${priceCondition}" requires price`)
  }
  if (!cashOrderPriceConditionRequiresPrice(priceCondition) && options.price != null) {
    throw new Error(`orders.cash priceCondition: "${priceCondition}" cannot specify price`)
  }
  if (options.orderTerm === 'date') normalizeOrderDate(options.orderDate)
  if (options.orderTerm !== 'date' && options.orderDate) {
    throw new Error('orders.cash orderDate requires orderTerm: "date"')
  }

  const orderMethod = cashOrderMethod(options)
  const hasTrigger = options.triggerZone != null || options.triggerPrice != null
  const hasSecondary = options.secondaryPriceCondition != null || options.secondaryPrice != null
  if (orderMethod === 'normal') {
    if (hasTrigger)
      throw new Error('orders.cash trigger fields require orderMethod: "stop" or "oco"')
    if (hasSecondary) throw new Error('orders.cash secondary fields require orderMethod: "oco"')
  }
  if (orderMethod === 'stop' || orderMethod === 'oco') {
    if (!options.triggerZone) {
      throw new Error(`orders.cash orderMethod: "${orderMethod}" requires triggerZone`)
    }
    if (options.triggerPrice == null) {
      throw new Error(`orders.cash orderMethod: "${orderMethod}" requires triggerPrice`)
    }
  }
  if (orderMethod === 'stop' && hasSecondary) {
    throw new Error('orders.cash orderMethod: "stop" cannot specify secondary fields')
  }
  if (orderMethod === 'oco') {
    if (!options.secondaryPriceCondition) {
      throw new Error('orders.cash orderMethod: "oco" requires secondaryPriceCondition')
    }
    if (
      cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition) &&
      options.secondaryPrice == null
    ) {
      throw new Error('orders.cash orderMethod: "oco" requires secondaryPrice')
    }
    if (
      !cashOrderPriceConditionRequiresPrice(options.secondaryPriceCondition) &&
      options.secondaryPrice != null
    ) {
      throw new Error(
        `orders.cash secondaryPriceCondition: "${options.secondaryPriceCondition}" cannot specify secondaryPrice`,
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
  const preOrderInfo = parseCashPreOrderInfo(preOrder)
  await ensureTradeAuthenticated(session, options, preOrderInfo)
}

const parseCashPreOrderInfo = (response: MtsResponse): CashPreOrderInfo => {
  if (methodErrorFromHeader(response) || response.buffer.length <= MTS_HEADER_BYTES) return {}
  const reader = readerFor(response)
  reader.skip(20)
  reader.skip(25)
  reader.skip(1)
  reader.skip(1)
  reader.skip(1500)
  const issueCode = reader.text(5)
  const market = reader.text(3)
  const issueName = reader.text(30)
  return {
    issueCode: emptyToUndefined(issueCode),
    market: emptyToUndefined(market),
    issueName: emptyToUndefined(stripIssueCodePrefix(issueName, issueCode)),
  }
}

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
    { width: 3, value: options.market },
  ])

const issueTrin = (options: IssueOptions) =>
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: options.market },
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
    { width: 3, value: options.market },
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
    { width: 3, value: options.market },
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
    { width: 3, value: options.market },
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

const orderPreviewTrin = (session: SbiSession, options: StockOrderTrinOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: options.market },
    { width: 1, value: sideCode(options.side) },
  ])

const cashOrderTrin = (session: SbiSession, options: CashOrderOptions) =>
  appCashOrderTrin(session, options)

const cashPreOrderTrin = (session: SbiSession, options: CashOrderOptions) =>
  fixedTrin([
    { width: 5, value: options.issueCode },
    { width: 80, value: '' },
    { width: 3, value: options.market },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 1, value: session.profile.marginAccount ?? '' },
    { width: 1, value: cashPreOrderDepositType(options) },
    { width: 2, value: '' },
  ])

const cashPreOrderDepositType = (options: CashOrderOptions) =>
  options.side === 'sell' ? orderDepositTypeCode(options.accountType) : ''

const appCashOrderTrin = (session: SbiSession, options: CashOrderOptions) => {
  if (!session.tradePassword) {
    throw new Error('orders.cash requires tradePassword in loginWithPasskey options')
  }
  const accountType = options.accountType ?? session.profile.accountType
  const standardOptions = options.kind === 's' ? undefined : options
  const priceCondition = cashOrderPriceCondition(options)
  const isPriceBased = cashOrderPriceConditionRequiresPrice(priceCondition)
  return fixedTrin([
    { width: 32, value: mtsTradePassword(session.tradePassword) },
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 5, value: options.issueCode },
    { width: 3, value: orderMarketCode(options) },
    { width: 8, value: options.quantity },
    { width: 1, value: cashOrderPriceConditionCode(priceCondition) },
    { width: 10, value: isPriceBased ? options.price : '' },
    { width: 1, value: orderDepositTypeCode(accountType) },
    { width: 1, value: '0' },
    { width: 8, value: cashOrderTermCode(options) },
    { width: 2, value: '00' },
    { width: 3, value: cashOrderMethodCode(cashOrderMethod(options)) },
    { width: 1, value: triggerZoneCode(standardOptions?.triggerZone) },
    { width: 10, value: standardOptions?.triggerPrice ?? '' },
    { width: 1, value: '2' },
    { width: 1, value: '' },
    { width: 2, value: '' },
    { width: 1, value: secondaryPriceConditionCode(options) },
    {
      width: 10,
      value: secondaryPriceConditionRequiresPrice(options) ? standardOptions?.secondaryPrice : '',
      align: 'right',
      pad: secondaryPriceConditionRequiresPrice(options) ? '0' : ' ',
    },
    { width: 3, value: sorLastMarketCode(session, options) },
  ])
}

const orderMarketCode = (options: CashOrderOptions) => options.market

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

const cashOrderTermCode = (options: CashOrderOptions) => {
  if (options.kind === 's') return ''
  const term = options.orderTerm ?? 'day'
  if (term === 'date') return normalizeOrderDate(options.orderDate)
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

const cashOrderMethod = (options: CashOrderOptions): CashOrderMethod => {
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

const sorLastMarketCode = (session: SbiSession, options: CashOrderOptions) => {
  if (options.market !== 'SOR') return ''
  if (options.sorLastMarket) return options.sorLastMarket
  if (options.accountType === 'juniorNisa') return session.profile.sor?.juniorNisaLastMarket ?? ''
  return session.profile.sor?.lastMarket ?? ''
}

type StockOrderTrinOptions = {
  issueCode: string
  market: string
  side: TradeSide
  quantity?: number
  price?: number
  confirmationId?: string
  positionId?: string
}

const orderConfirmTrin = (session: SbiSession, options: StockOrderTrinOptions) =>
  orderPreviewTrin(session, options) +
  fixedTrin([
    { width: 16, value: options.quantity, align: 'right', pad: '0' },
    { width: 11, value: options.price ?? '', align: 'right', pad: '0' },
    { width: 20, value: mtsTradePassword(session.tradePassword) },
    { width: 32, value: (options as PlaceCashOrderOptions).confirmationId ?? '' },
    { width: 32, value: (options as MarginCloseOrderOptions).positionId ?? '' },
  ])

const marginOpenOrderTrin = (session: SbiSession, options: MarginOpenOrderOptions) =>
  orderConfirmTrin(session, options)

const marginSummaryOrderTrin = (session: SbiSession, options: MarginCloseOrderOptions) =>
  orderConfirmTrin(session, options)

const actualDeliveryOrderTrin = (session: SbiSession, options: ActualDeliveryOrderOptions) =>
  orderConfirmTrin(session, { ...options, side: actualDeliverySide(options) })

const ifdOrderTrin = (session: SbiSession, options: IfdOrderOptions) =>
  orderConfirmTrin(session, options)

const orderCorrectionTrin = (session: SbiSession, options: OrderCorrectionOptions) =>
  fixedTrin([
    { width: 3, value: session.profile.butenCode ?? session.profile.branchCode },
    { width: 7, value: session.profile.accountNumber },
    { width: 20, value: options.orderId },
    { width: 16, value: options.quantity ?? '', align: 'right', pad: '0' },
    { width: 11, value: options.price ?? '', align: 'right', pad: '0' },
    { width: 20, value: mtsTradePassword(session.tradePassword) },
  ])

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
    { width: 1, value: 'P' },
    { width: 6, value: options.orderNumber },
    { width: 7, value: options.orderId ?? '' },
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
    { width: 1, value: '2' },
    { width: 1, value: '' },
    { width: 10, value: '', align: 'right', pad: ' ' },
  ])

const themeOrderTrin = (session: SbiSession, options: ThemeInvestmentOrderOptions) =>
  fixedTrin([
    { width: 20, value: options.themeId },
    { width: 1, value: sideCode(options.side) },
    { width: 16, value: options.amount ?? '', align: 'right', pad: '0' },
    { width: 20, value: mtsTradePassword(session.tradePassword) },
  ])

const cashPreOrderTrCode = (options: CashOrderOptions) =>
  options.side === 'sell' ? 'F2102' : 'F2101'

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

const actualDeliverySide = (options: ActualDeliveryOrderOptions): TradeSide =>
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
  if (value === '1') return 'specific'
  if (value === '2') return 'nisa'
  if (value === '3') return 'juniorNisa'
  if (value === '0') return 'general'
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
