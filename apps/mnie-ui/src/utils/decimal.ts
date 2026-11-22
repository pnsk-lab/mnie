/** Exact arithmetic for balance previews; the server validates balances and versions again. */
export const subtractDecimal = (left: string, right: string) => {
  const parse = (value: string) => {
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('数量を正しく入力してください')
    const [integer, fraction = ''] = value.split('.')
    return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length }
  }
  const a = parse(left),
    b = parse(right)
  const scale = Math.max(a.scale, b.scale)
  const value =
    a.coefficient * 10n ** BigInt(scale - a.scale) - b.coefficient * 10n ** BigInt(scale - b.scale)
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0')
  const decimal = scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '')
    : digits
  return `${value < 0n ? '-' : ''}${decimal}`
}
