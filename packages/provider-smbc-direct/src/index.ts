/** Options shared by the SMBC direct client implementation. */
export interface SmbcDirectClientOptions {
  /** SMBC Direct transaction origin. Paths, queries, and fragments are not accepted. */
  baseURL: string | URL
  /** SMBC Direct login-page origin. Paths, queries, and fragments are not accepted. */
  loginURL: string | URL
}

export interface LoginWithPasskeyOptions {
  /** `<branch>-<account>`. Defaults to `SMBC_USER`. */
  user?: string
  /** Login password. Defaults to `SMVC_PASS`. */
  password?: string
  /** SMBC Direct transaction origin. Defaults to `SMBC_DIRECT_BASE_URL`. */
  baseURL?: string | URL
  /** SMBC Direct login-page origin. Defaults to `SMBC_DIRECT_LOGIN_BASE_URL`. */
  loginURL?: string | URL
  /** Ordinary-deposit account item code. Defaults to the code observed in the HAR. */
  accountItemCode?: string
}

export interface SmbcDirectBalance {
  branchNo: string
  accountNo: string
  accountItemCode: string
  currency: 'JPY'
  amount: number
  displayValue: string
}

export interface SmbcDirectAccount {
  branchNo: string
  accountNo: string
  accountItemCode: string
  type: 'ordinary-deposit'
}

export interface SmbcDirectTransaction {
  id: string
  date: string
  amount: number
  balance: number
  description: string
  type: 'deposit' | 'withdrawal'
}

export interface SmbcDirectTransactions {
  startDate: string
  endDate: string
  depositsTotal: number
  withdrawalsTotal: number
  transactions: SmbcDirectTransaction[]
}

export interface SmbcDirectTransferFeeOptions {
  /** Amount in JPY. The request is not a transfer and never opens a confirmation page. */
  amount: number
  sourceAccountIndex?: string
  recipientName?: string
  usePoint?: boolean
  scheduledDate?: string
}

export interface SmbcDirectProfile {
  readonly baseURL: string
  readonly branchNo: string
  readonly accountNo: string
  readonly session: { export(): SmbcDirectSession }
  getAccounts(): Promise<SmbcDirectAccount[]>
  getBalance(): Promise<SmbcDirectBalance>
  getTransactions(options: { startDate: string; endDate: string }): Promise<SmbcDirectTransactions>
  /** Returns the bank-provided saved/previous transfer-recipient payload. Does not transfer money. */
  getTransferRecipients(): Promise<unknown>
  /** Returns the bank-provided recipient payload for a prior recipient. Does not transfer money. */
  getTransferRecipient(index: string): Promise<unknown>
  /** Calculates a transfer fee only; it neither confirms nor executes a transfer. */
  estimateTransferFee(options: SmbcDirectTransferFeeOptions): Promise<unknown>
  /** Navigates to the account-list page to keep the authenticated session active. */
  continueSession(): Promise<void>
  logout(): Promise<void>
}

/** Converts an authenticated SMBC Direct session to the provider-neutral API. */
export const createProvider = (profile: SmbcDirectProfile): FinancialProvider<CommonOperations> => {
  const accountId = `${profile.branchNo}-${profile.accountNo}`
  const accounts = async (): Promise<Page<Account>> => ({
    items: (await profile.getAccounts()).map((value) => ({
      id: `${value.branchNo}-${value.accountNo}`,
      providerId: 'smbc-direct',
      kind: 'bank',
      name: 'SMBC Direct ordinary deposit',
      maskedNumber: `***${value.accountNo.slice(-4)}`,
    })),
  })
  return {
    descriptor: { id: 'smbc-direct', name: 'SMBC Direct' },
    accountId,
    capabilities: () => ['accounts:read', 'balances:read', 'transactions:read', 'transfers:read'],
    operations: () => [
      'accounts.list',
      'balances.list',
      'transactions.list',
      'transfers.recipients.list',
    ],
    checkAvailability: async () => {
      try {
        await profile.continueSession()
        return { ok: true }
      } catch (message) {
        return { ok: false, message }
      }
    },
    invoke: async (name, request) => {
      if (name === 'accounts.list') return accounts() as never
      if (name === 'balances.list') {
        const input = request as { accountId?: string }
        if (input.accountId && input.accountId !== accountId) return [] as never
        const value = await profile.getBalance()
        const result: Balance[] = [
          {
            accountId,
            type: 'current',
            amount: {
              kind: 'money',
              money: { currency: value.currency, value: String(value.amount) },
            },
            asOf: new Date().toISOString(),
          },
        ]
        return result as never
      }
      if (name === 'transactions.list') {
        const input = request as { from?: string; to?: string }
        if (!input.from || !input.to) {
          throw new Error('transactions.list requires from and to for SMBC Direct')
        }
        const value = await profile.getTransactions({ startDate: input.from, endDate: input.to })
        const items: Transaction[] = value.transactions.map((transaction) => {
          const base = {
            id: transaction.id,
            accountId,
            status: 'posted' as const,
            amount: {
              kind: 'money' as const,
              money: { currency: 'JPY', value: String(transaction.amount) },
            },
            occurredAt: transaction.date,
            description: transaction.description,
            balanceAfter: {
              kind: 'money' as const,
              money: { currency: 'JPY', value: String(transaction.balance) },
            },
          }
          return transaction.type === 'deposit'
            ? { ...base, kind: 'deposit' as const, direction: 'credit' as const }
            : { ...base, kind: 'withdrawal' as const, direction: 'debit' as const }
        })
        return { items } as Page<Transaction> as never
      }
      if (name === 'transfers.recipients.list') {
        const value = await profile.getTransferRecipients()
        if (!Array.isArray(value)) throw new Error('SMBC Direct recipients were not a list')
        return {
          items: value.map((item, index) => ({ id: String(index), name: String(item) })),
        } as never
      }
      throw new Error(`unsupported SMBC Direct operation: ${name}`)
    },
    exportSession: () => profile.session.export(),
    close: () => profile.logout(),
  }
}

export interface SmbcDirectSession {
  baseURL: string
  user: string
  password: string
  accountItemCode: string
  cookies: Record<string, string>
  topPage: { html: string; url: string }
}

export interface SmbcDirectLoginChallenge {
  /** Completes the session after approval in the SMBC app. */
  finished2fa(): Promise<SmbcDirectProfile>
  /** QR image represented as a PNG Base64 Data URL. */
  qrurl: string
  /** SMBC app deep link encoded by the QR image. */
  url: string
}

interface Credentials {
  branchNo: string
  accountNo: string
  password: string
}

interface LoginContext {
  baseURL: string
  credentials: Credentials
  accountItemCode: string
  jar: CookieJar
  headers: Record<string, string>
  confirmationForm: Record<string, string>
  confirmationUrl: string
}

const defaultAccountItemCode = '2206'

/** Normalizes and validates an origin-only SMBC Direct URL. */
export const normalizeSmbcDirectOrigin = (baseURL: string | URL): string => {
  const url = new URL(baseURL)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const separator = pair.indexOf('=')
      if (separator > 0) this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  get(name: string) {
    return this.#cookies.get(name)
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  export() {
    return Object.fromEntries(this.#cookies)
  }

  import(cookies: Record<string, string>) {
    this.#cookies = new Map(Object.entries(cookies))
  }
}

const splitSetCookie = (header: string | null) =>
  header ? header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()) : []

const fetchWithCookies = async (url: URL, init: RequestInit, jar: CookieJar) => {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(url, { ...init, headers, redirect: 'manual' })
  jar.apply(response)
  return response
}

const responseText = async (response: Response, name: string) => {
  if (!response.ok) throw new Error(`${name} failed: HTTP ${response.status}`)
  return response.text()
}

const formFields = (html: string, formName: string) => {
  const escapedName = formName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const form = new RegExp(
    `<form\\b[^>]*\\bname=["']${escapedName}["'][^>]*>([\\s\\S]*?)</form>`,
    'i',
  ).exec(html)?.[1]
  if (!form) throw new Error(`response did not include ${formName} form`)

  const fields: Record<string, string> = {}
  for (const input of form.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname=["']([^"']+)["']/i.exec(input[0])?.[1]
    const value = /\bvalue=["']([^"']*)["']/i.exec(input[0])?.[1]
    if (name && value !== undefined) fields[name] = value
  }
  return fields
}

const required = (fields: Record<string, string>, name: string) => {
  const value = fields[name]
  if (value === undefined) throw new Error(`form did not include ${name}`)
  return value
}

const inlineVariable = (html: string, name: string) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = new RegExp(`(?:const|let|var)\\s+${escapedName}\\s*=\\s*['"]([^'"]+)['"]`).exec(
    html,
  )?.[1]
  if (!value) throw new Error(`response did not include ${name}`)
  return value
}

const readCredentials = (options: LoginWithPasskeyOptions): Credentials => {
  const user = options.user ?? process.env.SMBC_USER
  const password = options.password ?? process.env.SMVC_PASS
  if (!user || !password)
    throw new Error('user/password are required (or set SMBC_USER and SMVC_PASS)')
  const match = /^(\d+)-(\d+)$/.exec(user)
  if (!match) throw new Error('user must be formatted as <branch>-<account>')
  const [, branchNo, accountNo] = match
  if (!branchNo || !accountNo) throw new Error('user must be formatted as <branch>-<account>')
  return { branchNo, accountNo, password }
}

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
}

const requestTopPage = async (
  context: LoginContext,
  completionHtml: string,
  completionUrl: string,
) => {
  if (/\bname=["']TPALTOP["']/i.test(completionHtml))
    return { html: completionHtml, url: completionUrl }
  const header = formFields(completionHtml, 'DIRECTHEADERFORM')
  const response = await fetchWithCookies(
    new URL('/ib/web/top/TPALTOPacctList.smbc', context.baseURL),
    {
      method: 'POST',
      headers: {
        ...context.headers,
        'content-type': 'application/x-www-form-urlencoded',
        origin: context.baseURL,
        referer: completionUrl,
      },
      body: new URLSearchParams(header),
    },
    context.jar,
  )
  return { html: await responseText(response, 'top-page request'), url: response.url }
}

const parseBalance = (value: unknown, context: LoginContext): SmbcDirectBalance => {
  if (typeof value !== 'string')
    throw new Error('balance response did not include ajaxSavingAccountBalance')
  const normalized = value.replace(/[￥円,\s]/g, '')
  if (!/^-?\d+$/.test(normalized)) throw new Error('balance response was not a yen amount')
  return {
    branchNo: context.credentials.branchNo,
    accountNo: context.credentials.accountNo,
    accountItemCode: context.accountItemCode,
    currency: 'JPY',
    amount: Number(normalized),
    displayValue: value,
  }
}

const parseYen = (value: unknown, name: string) => {
  if (typeof value !== 'string') throw new Error(`${name} was not a yen amount`)
  const normalized = value.replace(/[￥円,\s]/g, '')
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${name} was not a yen amount`)
  return Number(normalized)
}

const dateParameter = (value: string, name: string) => {
  if (!/^\d{8}$/.test(value)) throw new Error(`${name} must be YYYYMMDD`)
  return value
}

const createProfile = (
  context: LoginContext,
  initialTopPage: { html: string; url: string },
): SmbcDirectProfile => {
  let topPage = initialTopPage

  const topPageForms = () => {
    const topForm = formFields(topPage.html, 'TPALTOP')
    return {
      topForm,
      headerForm: formFields(topPage.html, 'DIRECTHEADERFORM'),
      token: required(topForm, '_TOKEN'),
      formId: required(topForm, '_FORMID'),
    }
  }

  const continueSession = async () => {
    const { headerForm } = topPageForms()
    const response = await fetchWithCookies(
      new URL('/ib/web/top/TPALTOPacctList.smbc', context.baseURL),
      {
        method: 'POST',
        headers: {
          ...context.headers,
          'content-type': 'application/x-www-form-urlencoded',
          origin: context.baseURL,
          referer: topPage.url,
        },
        body: new URLSearchParams(headerForm),
      },
      context.jar,
    )
    topPage = {
      html: await responseText(response, 'continue-session request'),
      url: response.url,
    }
  }

  const requestTransferPage = async () => {
    const { headerForm } = topPageForms()
    const response = await fetchWithCookies(
      new URL('/ib/web/transfer/TFTPTOPfurikomi.smbc', context.baseURL),
      {
        method: 'POST',
        headers: {
          ...context.headers,
          'content-type': 'application/x-www-form-urlencoded',
          origin: context.baseURL,
          referer: topPage.url,
        },
        body: new URLSearchParams(headerForm),
      },
      context.jar,
    )
    const url = response.url
    return {
      form: formFields(await responseText(response, 'transfer page request'), 'TFFMIN1'),
      url,
    }
  }

  const transferAjax = async (
    event: 'TFFMIN1Ajaxkakojizensearch' | 'TFFMIN1Ajaxkakoselect' | 'TFFMIN1Ajaxcalcfee',
    body: Record<string, string>,
  ): Promise<unknown> => {
    const transfer = await requestTransferPage()
    const url = new URL(`/ib/ajax/transfer/${event}.smbc`, context.baseURL)
    url.searchParams.set('_TOKEN', required(transfer.form, '_TOKEN'))
    url.searchParams.set('_FORMID', required(transfer.form, '_FORMID'))
    const response = await fetchWithCookies(
      url,
      {
        method: 'POST',
        headers: {
          ...context.headers,
          'content-type': 'application/json; charset=UTF-8',
          origin: context.baseURL,
          referer: transfer.url,
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      },
      context.jar,
    )
    if (!response.ok) throw new Error(`${event} failed: HTTP ${response.status}`)
    const text = await response.text()
    if (!text) throw new Error(`${event} returned an empty response`)
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  return {
    baseURL: context.baseURL,
    branchNo: context.credentials.branchNo,
    accountNo: context.credentials.accountNo,
    session: {
      export: () => ({
        baseURL: context.baseURL,
        user: `${context.credentials.branchNo}-${context.credentials.accountNo}`,
        password: context.credentials.password,
        accountItemCode: context.accountItemCode,
        cookies: context.jar.export(),
        topPage: { ...topPage },
      }),
    },
    async getAccounts() {
      return [
        {
          branchNo: context.credentials.branchNo,
          accountNo: context.credentials.accountNo,
          accountItemCode: context.accountItemCode,
          type: 'ordinary-deposit',
        },
      ]
    },
    async getBalance() {
      const { token, formId } = topPageForms()
      const url = new URL('/ib/ajax/top/TPALTOPAjaxSavingBalance.smbc', context.baseURL)
      url.searchParams.set('_TOKEN', token)
      url.searchParams.set('_FORMID', formId)
      const response = await fetchWithCookies(
        url,
        {
          method: 'POST',
          headers: {
            ...context.headers,
            'content-type': 'application/json; charset=UTF-8',
            origin: context.baseURL,
            referer: topPage.url,
            'x-requested-with': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            accountBranchCode: context.credentials.branchNo.padStart(4, '0'),
            accountItemCode: context.accountItemCode,
            accountNo: context.credentials.accountNo,
          }),
        },
        context.jar,
      )
      if (!response.ok) throw new Error(`balance request failed: HTTP ${response.status}`)
      const body: unknown = await response.json()
      const value =
        body && typeof body === 'object'
          ? (body as { response?: { ajaxSavingAccountBalance?: unknown } }).response
              ?.ajaxSavingAccountBalance
          : undefined
      return parseBalance(value, context)
    },
    async getTransactions(options) {
      const startDate = dateParameter(options.startDate, 'startDate')
      const endDate = dateParameter(options.endDate, 'endDate')
      if (startDate > endDate) throw new Error('startDate must not be after endDate')

      const { topForm } = topPageForms()
      const detailResponse = await fetchWithCookies(
        new URL('/ib/web/top/TPALTOPaccountFutsuDetail.smbc', context.baseURL),
        {
          method: 'POST',
          headers: {
            ...context.headers,
            'content-type': 'application/x-www-form-urlencoded',
            origin: context.baseURL,
            referer: topPage.url,
          },
          body: new URLSearchParams({
            ...topForm,
            moudaiBrNo: context.credentials.branchNo.padStart(4, '0'),
            moudaiAcNo: context.credentials.accountNo,
            accountBranchCode: context.credentials.branchNo.padStart(4, '0'),
            accountItemCode: context.accountItemCode,
            accountNo: context.credentials.accountNo,
          }),
        },
        context.jar,
      )
      const detailUrl = detailResponse.url
      const detailHtml = await responseText(detailResponse, 'account detail request')
      const detailForm = formFields(detailHtml, 'AIFCDT3')
      const url = new URL('/ib/ajax/accountinquiry/AIFCDT3Ajaxkikannshokai.smbc', context.baseURL)
      url.searchParams.set('_TOKEN', required(detailForm, '_TOKEN'))
      url.searchParams.set('_FORMID', required(detailForm, '_FORMID'))
      const response = await fetchWithCookies(
        url,
        {
          method: 'POST',
          headers: {
            ...context.headers,
            'content-type': 'application/json; charset=UTF-8',
            origin: context.baseURL,
            referer: detailUrl,
            'x-requested-with': 'XMLHttpRequest',
          },
          body: JSON.stringify({ mStartYmd: startDate, mEndYmd: endDate }),
        },
        context.jar,
      )
      if (!response.ok) throw new Error(`transaction request failed: HTTP ${response.status}`)
      const body: unknown = await response.json()
      const result = body as {
        success?: unknown
        response?: {
          nyukinGoukei?: unknown
          syukkinGoukei?: unknown
          meisai?: Array<Record<string, unknown>>
        }
      }
      if (result.success !== true || !result.response || !Array.isArray(result.response.meisai)) {
        throw new Error('transaction response was invalid')
      }
      return {
        startDate,
        endDate,
        depositsTotal: parseYen(result.response.nyukinGoukei, 'deposit total'),
        withdrawalsTotal: parseYen(result.response.syukkinGoukei, 'withdrawal total'),
        transactions: result.response.meisai.map((entry) => {
          const amount = parseYen(entry.amount, 'transaction amount')
          return {
            id: String(entry.meisaiId ?? ''),
            date: String(entry.dispDate ?? ''),
            amount,
            balance: parseYen(entry.torihikigobalance, 'transaction balance'),
            description: String(entry.comment ?? ''),
            type: entry.depositWithdrawTypeFlag === '1' ? 'withdrawal' : 'deposit',
          }
        }),
      }
    },
    async getTransferRecipients() {
      return transferAjax('TFFMIN1Ajaxkakojizensearch', {})
    },
    async getTransferRecipient(index) {
      if (!index) throw new Error('index is required')
      return transferAjax('TFFMIN1Ajaxkakoselect', { kakoJizenIndex: index })
    },
    async estimateTransferFee(options) {
      if (!Number.isSafeInteger(options.amount) || options.amount <= 0) {
        throw new Error('amount must be a positive safe integer in JPY')
      }
      return transferAjax('TFFMIN1Ajaxcalcfee', {
        shukkinAccountRadio: options.sourceAccountIndex ?? '0',
        uketorininNameNyuryoku: options.recipientName ?? '',
        furikomiAmountNyuryoku: String(options.amount),
        usePointRadio: options.usePoint ? '1' : '0',
        furikomiShiteiDatePulldown: options.scheduledDate ?? '0',
      })
    },
    continueSession,
    async logout() {
      const { headerForm } = topPageForms()
      const response = await fetchWithCookies(
        new URL('/ib/web/loginlogout/TPALTOPlogout1.smbc', context.baseURL),
        {
          method: 'POST',
          headers: {
            ...context.headers,
            'content-type': 'application/x-www-form-urlencoded',
            origin: context.baseURL,
            referer: topPage.url,
          },
          body: new URLSearchParams(headerForm),
        },
        context.jar,
      )
      await responseText(response, 'logout request')
    },
  }
}

/** Starts SMBC Direct login and returns the QR challenge plus its completion callback. */
export const loginWithPasskey = async (
  options: LoginWithPasskeyOptions = {},
): Promise<SmbcDirectLoginChallenge> => {
  const configuredBaseURL = options.baseURL ?? process.env.SMBC_DIRECT_BASE_URL
  const configuredLoginURL = options.loginURL ?? process.env.SMBC_DIRECT_LOGIN_BASE_URL
  if (!configuredBaseURL) throw new Error('SMBC_DIRECT_BASE_URL is required')
  if (!configuredLoginURL) throw new Error('SMBC_DIRECT_LOGIN_BASE_URL is required')
  const baseURL = normalizeSmbcDirectOrigin(configuredBaseURL)
  const loginURL = normalizeSmbcDirectOrigin(configuredLoginURL)
  const context: LoginContext = {
    baseURL,
    credentials: readCredentials(options),
    accountItemCode: options.accountItemCode ?? defaultAccountItemCode,
    jar: new CookieJar(),
    headers: browserHeaders,
    confirmationForm: {},
    confirmationUrl: '',
  }

  const loginPage = await fetchWithCookies(
    new URL('/aib/aibgsjsw5001.jsp', loginURL),
    { headers: context.headers },
    context.jar,
  )
  const loginForm = formFields(await responseText(loginPage, 'login page request'), 'LLDLDIL')
  const confirmation = await fetchWithCookies(
    new URL('/ib/web/loginlogout/LLDLDILnextPreTS.smbc', baseURL),
    {
      method: 'POST',
      headers: {
        ...context.headers,
        'content-type': 'application/x-www-form-urlencoded',
        origin: baseURL,
        referer: loginPage.url,
      },
      body: new URLSearchParams({
        _FRAMEID: required(loginForm, '_FRAMEID'),
        _TARGETID: required(loginForm, '_TARGETID'),
        _LUID: required(loginForm, '_LUID'),
        _TOKEN: required(loginForm, '_TOKEN'),
        _FORMID: 'LLDLDIL',
        _SUBINDEX: '',
        switchLoginDomainReqFlag: '',
        swKeyboardUseFlagSw2: '0',
        branchNo: context.credentials.branchNo,
        accountNo: context.credentials.accountNo,
        userId1: '',
        userId2: '',
        password: context.credentials.password,
      }),
    },
    context.jar,
  )
  const confirmationHtml = await responseText(confirmation, 'login request')
  context.confirmationForm = formFields(confirmationHtml, 'BCATBCA')
  context.confirmationUrl = confirmation.url

  const qrCode = inlineVariable(confirmationHtml, 'qrCode')
  const appUrl = new URL('smbcdirectapp:///biometrics/ADBA')
  appUrl.searchParams.set('userId', inlineVariable(confirmationHtml, 'userId'))
  appUrl.searchParams.set(
    'confirmationNumber',
    inlineVariable(confirmationHtml, 'confirmationNumber'),
  )
  appUrl.searchParams.set('createdTime', inlineVariable(confirmationHtml, 'createdTime'))

  return {
    qrurl: `data:image/png;base64,${qrCode}`,
    url: appUrl.toString(),
    async finished2fa() {
      const sessionBefore = context.jar.get('JSESSIONID')
      const response = await fetchWithCookies(
        new URL('/ib/web/loginlogout/LLDLDILnextPostTS.smbc', baseURL),
        {
          method: 'POST',
          headers: {
            ...context.headers,
            'content-type': 'application/x-www-form-urlencoded',
            origin: baseURL,
            referer: context.confirmationUrl,
          },
          body: new URLSearchParams({
            _FRAMEID: required(context.confirmationForm, '_FRAMEID'),
            _TARGETID: required(context.confirmationForm, '_TARGETID'),
            _LUID: required(context.confirmationForm, '_LUID'),
            _TOKEN: required(context.confirmationForm, '_TOKEN'),
            _FORMID: 'BCATBCA',
            _SUBINDEX: '',
            takeOverTransitionType: required(context.confirmationForm, 'takeOverTransitionType'),
            validMillisecond: required(context.confirmationForm, 'validMillisecond'),
          }),
        },
        context.jar,
      )
      const completionHtml = await responseText(response, 'login completion request')
      const sessionAfter = context.jar.get('JSESSIONID')
      if (!sessionAfter || sessionAfter === sessionBefore) {
        throw new Error('SMBC app approval was not completed before finished2fa()')
      }
      return createProfile(context, await requestTopPage(context, completionHtml, response.url))
    },
  }
}

/** Starts QR authentication; `finished2fa()` resolves to the common provider interface. */
export const connect = async (options: LoginWithPasskeyOptions = {}) => {
  const challenge = await loginWithPasskey(options)
  return {
    qrurl: challenge.qrurl,
    url: challenge.url,
    finished2fa: async (): Promise<FinancialProvider<CommonOperations>> =>
      createProvider(await challenge.finished2fa()),
  }
}

/** Retrieves the ordinary-deposit balance for an authenticated SMBC Direct profile. */
export const getBalance = async ({ profile }: { profile: SmbcDirectProfile }) =>
  profile.getBalance()

/** Lists currently configured SMBC Direct accounts. */
export const getAccounts = async ({ profile }: { profile: SmbcDirectProfile }) =>
  profile.getAccounts()

/** Retrieves ordinary-deposit transactions in the requested inclusive date range. */
export const getTransactions = async ({
  profile,
  startDate,
  endDate,
}: {
  profile: SmbcDirectProfile
  startDate: string
  endDate: string
}) => profile.getTransactions({ startDate, endDate })

/** Navigates to the account-list page so SMBC Direct keeps the session active. */
export const continueSession = async ({ profile }: { profile: SmbcDirectProfile }) =>
  profile.continueSession()

/** Lists saved and previously used transfer recipients without creating a transfer. */
export const getTransferRecipients = async ({ profile }: { profile: SmbcDirectProfile }) =>
  profile.getTransferRecipients()

/** Calculates a transfer fee without creating, confirming, or executing a transfer. */
export const estimateTransferFee = async ({
  profile,
  ...options
}: { profile: SmbcDirectProfile } & SmbcDirectTransferFeeOptions) =>
  profile.estimateTransferFee(options)

export const exportSession = (profile: SmbcDirectProfile): SmbcDirectSession =>
  profile.session.export()

export const importSession = async (session: SmbcDirectSession): Promise<SmbcDirectProfile> => {
  const baseURL = normalizeSmbcDirectOrigin(session.baseURL)
  const credentials = readCredentials({ user: session.user, password: session.password })
  if (!session.accountItemCode || !session.topPage?.html || !session.topPage.url) {
    throw new Error('SMBC Direct session is missing authenticated state')
  }
  const topPageUrl = new URL(session.topPage.url)
  if (topPageUrl.origin !== baseURL)
    throw new Error('SMBC Direct session top-page origin is invalid')
  const jar = new CookieJar()
  jar.import(session.cookies)
  return createProfile(
    {
      baseURL,
      credentials,
      accountItemCode: session.accountItemCode,
      jar,
      headers: browserHeaders,
      confirmationForm: {},
      confirmationUrl: baseURL,
    },
    { html: session.topPage.html, url: topPageUrl.toString() },
  )
}

export interface SmbcDirectClient {
  readonly baseURL: string
  loginWithPasskey(
    options?: Omit<LoginWithPasskeyOptions, 'baseURL' | 'loginURL'>,
  ): Promise<SmbcDirectLoginChallenge>
  importSession(session: SmbcDirectSession): Promise<SmbcDirectProfile>
}

/** Creates an SMBC Direct client with fixed origin configuration. */
export const createSmbcDirectClient = (options: SmbcDirectClientOptions): SmbcDirectClient => {
  const baseURL = normalizeSmbcDirectOrigin(options.baseURL)
  const loginURL = normalizeSmbcDirectOrigin(options.loginURL)
  return {
    baseURL,
    loginWithPasskey: (loginOptions = {}) =>
      loginWithPasskey({ ...loginOptions, baseURL, loginURL }),
    importSession,
  }
}
import type {
  Account,
  Balance,
  CommonOperations,
  FinancialProvider,
  Page,
  Transaction,
} from '@mnie/types'
