import type { ApiKeySettings } from '../../api'

export const defaultApiKeyPolicy = (): ApiKeySettings => ({
  maxOrderPriceJpy: null,
  maxOrderAmountJpy: null,
  allowedMethods: null,
  scopes: ['read'],
})
