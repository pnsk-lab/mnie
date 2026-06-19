export type CurrencyCode = 'JPY' | 'USD'

export const currencyCodeForMarket = (market?: string): CurrencyCode =>
  market === 'XNAS' || market === 'XNYS' || market === 'ARCX' ? 'USD' : 'JPY'

export const currency = (value: number, currencyCode: CurrencyCode = 'JPY') =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: currencyCode === 'JPY' ? 0 : 3,
  }).format(value)

export const currencyForMarket = (value: number, market?: string) =>
  currency(value, currencyCodeForMarket(market))

export const number = (value: number) => new Intl.NumberFormat('ja-JP').format(value)

export const signedCurrency = (value: number, currencyCode: CurrencyCode = 'JPY') =>
  `${value >= 0 ? '+' : '-'}${currency(Math.abs(value), currencyCode)}`

export const signedCurrencyForMarket = (value: number, market?: string) =>
  signedCurrency(value, currencyCodeForMarket(market))

export const signedPercent = (value: number, fractionDigits = 2) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(fractionDigits)}%`
