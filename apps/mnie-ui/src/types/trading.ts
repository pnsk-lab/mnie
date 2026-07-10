export type TradeSide = 'buy' | 'sell'
export type OrderKind = 'standard' | 's'
export type CashOrderAccountType = 'specific' | 'general' | 'growthInvestment' | 'nisa'
export type CashOrderMarket =
  | 'auto'
  | 'XTKS'
  | 'XNGO'
  | 'XFKA'
  | 'XSAP'
  | 'XNAS'
  | 'XNYS'
  | 'ARCX'
  | 'STK'
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
export type CashOrderMethod = 'normal' | 'stop' | 'oco'
export type CashOrderTriggerZone = 'above' | 'below'
export type ChartMode = 'line' | 'box'
export type ChartRange = '1D' | '3D' | '3M' | '1Y' | 'ALL'

export interface RpcMessage {
  id: number
  method: string
  params?: unknown
}

export interface OrderPreview {
  issue: {
    code: string
    market: string
  }
  side: string
  quantity: number
  price?: {
    value: number | null
    text: string
    currency?: string
  }
  warnings: string[]
  confirmationId?: string
  message?: string
}

export interface JsonRpcResponse {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    message?: string
  }
}

export interface RealtimePricePoint {
  at: string
  price: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number | null
}

export interface ChartNotice {
  title: string
  detail?: string
}

export interface MarketIndex {
  code?: string
  name: string
  value: number | null
  valueText: string
  change: number | null
  changeText: string
  changeRate: number | null
  changeRateText: string
  sign: 'positive' | 'negative' | 'zero'
  timestamp?: string
}

export interface Stock {
  code: string
  name: string
  symbol: string
  searchText?: string
  country: string
  market: string
  sector: string
  price: number
  change: number
  changeAmount: number
  volume: number
  open: number
  high: number
  low: number
  prevClose: number
  sShare: boolean
  history: number[]
  box: {
    min: number
    q1: number
    median: number
    q3: number
    max: number
  }
}

export interface OrderRow {
  id: string
  code: string
  date: string
  stock: string
  market: string
  side: TradeSide
  kind: OrderKind
  quantity: number | null
  unexecutedQuantity?: number | null
  executedQuantity?: number | null
  price: number | null
  status: '注文中' | '約定済' | '取消済'
  orderNumber?: string
  orderSubNo?: string
  tradeId?: string
  accountType?: string
  cancelable?: boolean
  correctable?: boolean
}

export type OrderDetail = OrderRow & {
  expiresAt?: string
  statusText?: string
  depositType?: string
  accountInformation?: string
}

export interface TradeRecordRow {
  id: string
  code: string
  stock: string
  market: string
  type: string
  quantity: number | null
  price: number | null
  amount: number | null
  tradeDate?: string
  valueDate?: string
  accountType?: string
  settlementCurrencyCode?: string
}

export interface Position {
  code: string
  name: string
  market: string
  quantity: number
  avgPrice: number
  currentPrice?: number | null
  marketValue: number
  profitLoss: number
  profitLossRate: number
  type?: string
  accountType?: CashOrderAccountType | string
}
