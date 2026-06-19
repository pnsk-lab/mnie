import type {
  CashOrderAccountType,
  CashOrderMarket,
  CashOrderMethod,
  CashOrderPriceCondition,
  CashOrderTriggerZone,
  OrderKind,
  TradeSide,
} from '../types/trading'

export const tradeSideOptions: Array<{ label: string; value: TradeSide; tone: 'buy' | 'sell' }> = [
  { label: '購入', value: 'buy', tone: 'buy' },
  { label: '売却', value: 'sell', tone: 'sell' },
]

export const orderKindOptions: Array<{ label: string; value: OrderKind }> = [
  { label: '通常単元', value: 'standard' },
  { label: 'S株', value: 's' },
]

export const cashOrderAccountTypeOptions: Array<{
  label: string
  value: CashOrderAccountType
}> = [
  { label: '特定', value: 'specific' },
  { label: '一般', value: 'general' },
  { label: 'NISA成長投資枠', value: 'growthInvestment' },
  { label: 'NISA', value: 'nisa' },
]

export const cashOrderMarketOptions: Array<{
  label: string
  value: CashOrderMarket
}> = [
  { label: '自動', value: 'auto' },
  { label: '東証', value: 'TKY' },
  { label: '名証', value: 'NGY' },
  { label: '福証', value: 'FKO' },
  { label: '札証', value: 'SPR' },
  { label: 'SOR', value: 'SOR' },
  { label: 'PTS', value: 'PTS' },
  { label: 'PTS(X)', value: 'PTX' },
]

export const sKabuOrderMarketOptions: Array<{
  label: string
  value: CashOrderMarket
}> = [{ label: 'S株', value: 'STK' }]

export const cashOrderPriceConditionOptions: Array<{
  label: string
  value: CashOrderPriceCondition
}> = [
  { label: '成行', value: 'market' },
  { label: '指値', value: 'limit' },
  { label: '寄成', value: 'marketAtOpen' },
  { label: '寄指', value: 'limitAtOpen' },
  { label: '引成', value: 'marketAtClose' },
  { label: '引指', value: 'limitAtClose' },
  { label: 'IOC成', value: 'marketIoc' },
  { label: 'IOC指', value: 'limitIoc' },
  { label: '不成', value: 'funari' },
]

export const cashOrderMethodOptions: Array<{
  label: string
  value: CashOrderMethod
}> = [
  { label: '通常', value: 'normal' },
  { label: '逆指値', value: 'stop' },
  { label: 'OCO', value: 'oco' },
]

export const cashOrderTriggerZoneOptions: Array<{
  label: string
  value: CashOrderTriggerZone
}> = [
  { label: '以上', value: 'above' },
  { label: '以下', value: 'below' },
]
