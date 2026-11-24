const guarded = new Set([
  'investments.orders.preview',
  'investments.orders.create',
  'investments.orders.replace.preview',
  'investments.orders.replace',
  'investments.orders.cancel',
])
export const accountScopedPortfolioMethods = new Set([
  'portfolio.accounts.get',
  'portfolio.accounts.balances',
  'portfolio.accounts.positions',
  'portfolio.accounts.orders',
  'portfolio.accounts.history',
  'portfolio.overview.get',
  'portfolio.valuation.get',
  'portfolio.history.list',
])
/** Preserve the effective legacy global policy for a binding, including the
 * former additional unprefixed check for order operations. */
export function legacyAccountMethods(methods: string[] | null | undefined): string[] | null {
  if (methods == null) return null
  const allowed = methods.filter((method) => {
    if (accountScopedPortfolioMethods.has(method)) return true
    if (!method.startsWith('account.')) return false
    const operation = method.slice('account.'.length)
    return !guarded.has(operation) || methods.includes(operation)
  })
  // Discovery was previously accessible for any bound account, independent
  // of the legacy global allowlist.
  return [
    ...new Set([...allowed, 'account.operations', 'account.capabilities', 'account.availability']),
  ]
}
