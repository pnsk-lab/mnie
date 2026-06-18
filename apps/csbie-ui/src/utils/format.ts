export const currency = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)

export const number = (value: number) => new Intl.NumberFormat('ja-JP').format(value)

export const signedCurrency = (value: number) =>
  `${value >= 0 ? '+' : '-'}${currency(Math.abs(value))}`

export const signedPercent = (value: number, fractionDigits = 2) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(fractionDigits)}%`
