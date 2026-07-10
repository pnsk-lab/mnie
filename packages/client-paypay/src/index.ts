export interface PayPayLoginOptions {
  /** An account label used only to select and identify this profile. */
  accountId?: string
  /** Access token issued to an already authenticated PayPay app session. Defaults to `PAYPAY_ACCESS_TOKEN`. */
  accessToken?: string
  /** PayPay API origin. Defaults to `PAYPAY_BASE_URL`. Paths, queries, and fragments are not accepted. */
  baseURL?: string | URL
  /** App/device/integrity headers required by the current PayPay session. Defaults to `PAYPAY_HEADERS_JSON`. */
  headers?: Record<string, string>
}

export interface PayPayAccountOptions extends Omit<PayPayLoginOptions, 'accountId'> {
  accountId: string
}

export interface PayPayBalance {
  currency: string
  /** Total PayPay balance in the smallest unit reported by the API (JPY for the PayPay app). */
  amount: number
  transferableAmount: number
  payoutableAmount: number
}

export interface PayPayProfile {
  readonly accountId: string
  readonly baseURL: string
  getBalance(): Promise<PayPayBalance>
}

export interface PayPayClient {
  readonly baseURL: string
  login(accountId: string): Promise<PayPayProfile>
  login(options: PayPayLoginOptions): Promise<PayPayProfile>
  loginAll(): Promise<PayPayProfile[]>
}

interface PayPayBalanceInfoResponse {
  balance?: unknown
  currency?: unknown
}

interface PayPayWalletResponse {
  payload?: {
    walletSummary?: {
      totalBalanceInfo?: PayPayBalanceInfoResponse
      transferableBalanceInfo?: PayPayBalanceInfoResponse
      payoutableBalanceInfo?: PayPayBalanceInfoResponse
    }
  }
  error?: unknown
}

interface ResolvedPayPayLoginOptions {
  accountId: string
  accessToken: string
  baseURL: string
  headers: Record<string, string>
}

const walletDisplayInfoPath = '/bff/v2/getWalletDisplayInfo'

export const normalizePayPayOrigin = (value: string | URL): string => {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

const requiredString = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}

const readHeaders = (value: Record<string, string> | undefined) => {
  if (value) return validateHeaders(value)
  const serialized = process.env.PAYPAY_HEADERS_JSON
  if (!serialized) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error('PAYPAY_HEADERS_JSON must be a JSON object of string headers')
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('PAYPAY_HEADERS_JSON must be a JSON object of string headers')
  }
  return validateHeaders(parsed as Record<string, unknown>)
}

const validateHeaders = (headers: Record<string, unknown>) => {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!name.trim() || typeof value !== 'string') {
      throw new Error('PayPay headers must have non-empty names and string values')
    }
    if (name.toLowerCase() === 'authorization') {
      throw new Error('provide accessToken instead of an authorization header')
    }
    result[name] = value
  }
  return result
}

const readOptions = (options: PayPayLoginOptions): ResolvedPayPayLoginOptions => {
  const baseURL = options.baseURL ?? process.env.PAYPAY_BASE_URL
  return {
    accountId: options.accountId ?? process.env.PAYPAY_ACCOUNT_ID ?? 'default',
    accessToken: requiredString(
      options.accessToken ?? process.env.PAYPAY_ACCESS_TOKEN,
      'accessToken',
    ),
    baseURL: normalizePayPayOrigin(
      requiredString(baseURL?.toString(), 'baseURL (or PAYPAY_BASE_URL)'),
    ),
    headers: readHeaders(options.headers),
  }
}

const readBalanceInfo = (value: PayPayBalanceInfoResponse | undefined, name: string) => {
  if (!value || typeof value.balance !== 'number' || !Number.isSafeInteger(value.balance)) {
    throw new Error(`PayPay wallet response did not include integer ${name}.balance`)
  }
  if (typeof value.currency !== 'string' || !value.currency) {
    throw new Error(`PayPay wallet response did not include ${name}.currency`)
  }
  return { amount: value.balance, currency: value.currency }
}

const createProfile = (options: ResolvedPayPayLoginOptions): PayPayProfile => ({
  accountId: options.accountId,
  baseURL: options.baseURL,
  async getBalance() {
    const url = new URL(walletDisplayInfoPath, options.baseURL)
    url.searchParams.set('usingPaymentInfoV2', 'false')
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${options.accessToken}`,
        ...options.headers,
      },
    })
    if (!response.ok) throw new Error(`PayPay wallet request failed: HTTP ${response.status}`)
    const result = (await response.json()) as PayPayWalletResponse
    if (result.error !== undefined) throw new Error('PayPay wallet request returned an API error')
    const summary = result.payload?.walletSummary
    if (!summary) throw new Error('PayPay wallet response did not include payload.walletSummary')
    const total = readBalanceInfo(summary.totalBalanceInfo, 'totalBalanceInfo')
    const transferable = readBalanceInfo(summary.transferableBalanceInfo, 'transferableBalanceInfo')
    const payoutable = readBalanceInfo(summary.payoutableBalanceInfo, 'payoutableBalanceInfo')
    if (transferable.currency !== total.currency || payoutable.currency !== total.currency) {
      throw new Error('PayPay wallet response used inconsistent currencies')
    }
    return {
      currency: total.currency,
      amount: total.amount,
      transferableAmount: transferable.amount,
      payoutableAmount: payoutable.amount,
    }
  },
})

/** Creates a profile from one authenticated PayPay app session. */
export const login = async (options: PayPayLoginOptions = {}): Promise<PayPayProfile> =>
  createProfile(readOptions(options))

/** Returns the total wallet balance for a logged-in profile. */
export const getBalance = ({ profile }: { profile: PayPayProfile }) => profile.getBalance()

/** Creates an isolated multi-account client. Each configured account has its own token and app headers. */
export const createPayPayClient = (options: {
  baseURL: string | URL
  accounts: PayPayAccountOptions[]
}): PayPayClient => {
  const baseURL = normalizePayPayOrigin(options.baseURL)
  if (options.accounts.length === 0) throw new Error('accounts must not be empty')
  const accounts = new Map<string, PayPayAccountOptions>()
  for (const account of options.accounts) {
    if (!account.accountId.trim()) throw new Error('accountId is required')
    if (accounts.has(account.accountId))
      throw new Error(`duplicate accountId: ${account.accountId}`)
    accounts.set(account.accountId, account)
  }
  const loginAccount = async (accountId: string) => {
    const account = accounts.get(accountId)
    if (!account) throw new Error(`unknown PayPay account: ${accountId}`)
    return login({ ...account, baseURL })
  }
  function clientLogin(accountId: string): Promise<PayPayProfile>
  function clientLogin(loginOptions: PayPayLoginOptions): Promise<PayPayProfile>
  function clientLogin(argument: string | PayPayLoginOptions) {
    return typeof argument === 'string' ? loginAccount(argument) : login({ ...argument, baseURL })
  }
  return {
    baseURL,
    login: clientLogin,
    loginAll: () => Promise.all([...accounts.keys()].map(loginAccount)),
  }
}
