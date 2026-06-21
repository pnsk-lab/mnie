import type { ApiKeySettings } from '../../api'

export const defaultApiKeyPolicy = (): ApiKeySettings => ({
  maxTradesPerHour: 10,
  maxTradesPer6Hours: 30,
  maxTradesPerDay: 80,
  maxOrderPriceJpy: null,
  maxOrderAmountJpy: null,
  allowedMethods: null,
  scopes: ['read'],
})
