export type TradeSide = 'buy' | 'sell'
export type OrderKind = 'standard' | 's'
export type CashOrderAccountType = 'specific' | 'general' | 'growthInvestment' | 'nisa'
export type CashOrderMarket = 'auto' | 'XTKS' | 'XNAS' | 'XNYS' | 'ARCX' | 'STK'
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

export type RpcMessage = {
  id: number
  method: string
  params?: unknown
}

export type OrderPreview = {
  issue: {
    code: string
    market: string
  }
  side: string
  quantity: number
  warnings: string[]
  confirmationId?: string
  message?: string
}

export type JsonRpcResponse = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    message?: string
  }
}

export type RealtimePricePoint = {
  at: string
  price: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number | null
}

export type ChartNotice = {
  title: string
  detail?: string
}

export type Stock = {
  code: string
  name: string
  symbol: string
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

export type OrderRow = {
  id: string
  date: string
  stock: string
  market: string
  side: TradeSide
  kind: OrderKind
  quantity: number | null
  price: number | null
  status: '注文中' | '約定済' | '取消済'
  orderNumber?: string
  tradeId?: string
}

export type Position = {
  code: string
  name: string
  market: string
  quantity: number
  avgPrice: number
  marketValue: number
  profitLoss: number
  profitLossRate: number
  type?: string
}
