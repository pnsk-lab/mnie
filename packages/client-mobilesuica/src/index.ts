export interface MobileSuicaCaptcha {
  /** Raw CAPTCHA image bytes. */
  image: Uint8Array
  contentType: string
}

export interface MobileSuicaLoginOptions {
  /** Mobile Suica account email. Defaults to `MOBILE_SUICA_USER`. */
  user?: string
  /** Mobile Suica password. Defaults to `MOBILE_SUICA_PASS`. */
  password?: string
  /** Mobile Suica web origin. Paths, queries, and fragments are not accepted. */
  baseURL: string | URL
  /** Displays the CAPTCHA to the account holder and returns its answer. */
  onCaptcha: (captcha: MobileSuicaCaptcha) => string | Promise<string>
}

export interface MobileSuicaUsageHistoryItem {
  date: string
  type: string
  detail: string
  amount: number | null
  balance: number | null
}

export interface MobileSuicaProfile {
  readonly baseURL: string
  /** Reads the 100 SF (electronic money) usage-history rows shown by Mobile Suica. */
  getUsageHistory(): Promise<MobileSuicaUsageHistoryItem[]>
  logout(): Promise<void>
}

interface LoginPage {
  url: URL
  formAction: string
  fields: Record<string, string>
  captchaUrl: URL
}

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

/** Normalizes and validates an origin-only Mobile Suica URL. */
export const normalizeMobileSuicaOrigin = (baseURL: string | URL): string => {
  const url = new URL(baseURL)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[]
    }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const separator = pair.indexOf('=')
      if (separator > 0) this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
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
  const bytes = await response.arrayBuffer()
  return new TextDecoder('shift_jis' as never).decode(bytes)
}

const decodeHtmlAttribute = (value: string) =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

const attribute = (tag: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  return value === undefined ? undefined : decodeHtmlAttribute(value)
}

const inputFields = (html: string) => {
  const fields: Record<string, string> = {}
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(input[0], 'name')
    if (name) fields[name] = attribute(input[0], 'value') ?? ''
  }
  return fields
}

const required = (value: string | undefined, name: string) => {
  if (value === undefined || value.length === 0) throw new Error(`response did not include ${name}`)
  return value
}

const readCredentials = (options: MobileSuicaLoginOptions) => {
  const user = options.user ?? process.env.MOBILE_SUICA_USER
  const password = options.password ?? process.env.MOBILE_SUICA_PASS
  if (!user || !password) throw new Error('user and password are required')
  return { user, password }
}

const parseLoginPage = (html: string, url: URL): LoginPage => {
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find((match) =>
    /\bname=["']MailAddress["']/i.test(match[2] ?? ''),
  )
  if (!form) throw new Error('login page did not include the Mobile Suica login form')
  const formAction = required(attribute(form[1] ?? '', 'action'), 'login form action')
  const captchaTag = [...(form[2] ?? '').matchAll(/<img\b[^>]*>/gi)].find((match) =>
    /captcha/i.test(attribute(match[0], 'src') ?? ''),
  )?.[0]
  const captchaSrc = captchaTag ? attribute(captchaTag, 'src') : undefined
  if (!captchaSrc) throw new Error('login page did not include a CAPTCHA image')
  return {
    url,
    formAction,
    fields: inputFields(form[2] ?? ''),
    captchaUrl: new URL(captchaSrc, url),
  }
}

const captchaEditorState = (answer: string) => `|0|01||[[[[]],[],[]],[{},[]],"05${answer}"]`

const parseAmount = (value: string) => {
  const normalized = value.replace(/[￥円,\s]/g, '')
  if (!normalized || normalized === '-') return null
  if (!/^-?\d+$/.test(normalized)) return null
  return Number(normalized)
}

const textContent = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

const tableRows = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...(row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      textContent(cell[1] ?? ''),
    ),
  )

export const parseMobileSuicaUsageHistory = (html: string): MobileSuicaUsageHistoryItem[] => {
  const records: MobileSuicaUsageHistoryItem[] = []
  for (const cells of tableRows(html)) {
    // The first cell is the print-selection checkbox. The 100 history rows in
    // the observed page have eight cells, with the date in the second cell.
    if (cells.length < 8 || !/\d{4}|\d{1,2}[/.月]/.test(cells[1] ?? '')) continue
    records.push({
      date: cells[1] ?? '',
      type: cells[2] ?? '',
      detail: [cells[4], cells[6]].filter((value) => value?.length).join(' '),
      amount: parseAmount(cells[3] ?? ''),
      balance: parseAmount(cells[5] ?? ''),
    })
  }
  if (records.length === 0) throw new Error('usage history page did not include any usage rows')
  return records
}

const submit = async (
  url: URL,
  fields: Record<string, string>,
  jar: CookieJar,
  referer: URL,
  name: string,
) =>
  responseText(
    await fetchWithCookies(
      url,
      {
        method: 'POST',
        headers: {
          ...browserHeaders,
          'content-type': 'application/x-www-form-urlencoded',
          origin: url.origin,
          referer: referer.toString(),
        },
        body: formBody(fields),
      },
      jar,
    ),
    name,
  )

const formBody = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields).toString()
  // The page declares Shift_JIS. All dynamic fields used here are ASCII, except
  // the submit label, whose observed Shift_JIS bytes are required by this form.
  return fields.LOGIN === 'LOGIN'
    ? body.replace(/(?:^|&)LOGIN=[^&]*/, 'LOGIN=%83%8D%83O%83C%83%93')
    : body
}

export const login = async (options: MobileSuicaLoginOptions): Promise<MobileSuicaProfile> => {
  const baseURL = normalizeMobileSuicaOrigin(options.baseURL)
  const { user, password } = readCredentials(options)
  const jar = new CookieJar()
  const entryUrl = new URL('/', baseURL)
  const loginResponse = await fetchWithCookies(entryUrl, { headers: browserHeaders }, jar)
  const loginPage = parseLoginPage(
    await responseText(loginResponse, 'login page request'),
    entryUrl,
  )
  const captchaResponse = await fetchWithCookies(
    loginPage.captchaUrl,
    {
      headers: {
        ...browserHeaders,
        accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
      },
    },
    jar,
  )
  if (!captchaResponse.ok)
    throw new Error(`CAPTCHA image request failed: HTTP ${captchaResponse.status}`)
  const answer = (
    await options.onCaptcha({
      image: new Uint8Array(await captchaResponse.arrayBuffer()),
      contentType: captchaResponse.headers.get('content-type') ?? 'application/octet-stream',
    })
  ).trim()
  if (!answer) throw new Error('onCaptcha must return a non-empty answer')

  const loginUrl = new URL(loginPage.formAction, loginPage.url)
  const topPage = await submit(
    loginUrl,
    {
      ...loginPage.fields,
      MailAddress: user,
      Password: password,
      WebCaptcha1__editor: answer,
      WebCaptcha1__editor_clientState: captchaEditorState(answer),
      // The server identifies the pressed submit control by its name. Keeping its
      // value ASCII avoids an unnecessary form-charset dependency.
      LOGIN: 'LOGIN',
    },
    jar,
    loginPage.url,
    'login request',
  )
  const transfer =
    /((?:https?:)?\/\/[^"'\s<>]+\/)?([^"'\s<>]*SuicaChangeTransfer\.aspx\?[^"'\s<>]+)/i.exec(
      topPage,
    )?.[0]
  if (!transfer) {
    const state = ['SuicaChangeTransfer', 'LoginForm.aspx', 'WebCaptcha1__editor', 'ログアウト']
      .filter((marker) => topPage.includes(marker))
      .join(', ')
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(topPage)?.[1]?.trim()
    throw new Error(
      `login response did not include a Suica selection transfer (${state || 'none'}; ${title || 'untitled'})`,
    )
  }
  const transferUrl = new URL(transfer.replace(/&amp;/g, '&'), baseURL)
  const selection = await submit(transferUrl, {}, jar, loginUrl, 'Suica selection request')
  const historyAction = /<form\b[^>]*\baction=["']([^"']*SuicaDisp\.aspx[^"']*)/i.exec(
    selection,
  )?.[1]
  if (!historyAction) throw new Error('Suica selection response did not include usage history')
  const historyUrl = new URL(historyAction.replace(/&amp;/g, '&'), baseURL)

  return {
    baseURL,
    async getUsageHistory() {
      const html = await submit(historyUrl, {}, jar, transferUrl, 'usage history request')
      return parseMobileSuicaUsageHistory(html)
    },
    async logout() {
      const response = await fetchWithCookies(
        new URL('/ka/lg/Logout.aspx', baseURL),
        {
          method: 'POST',
          headers: {
            ...browserHeaders,
            origin: baseURL,
            referer: historyUrl.toString(),
          },
        },
        jar,
      )
      if (!response.ok) throw new Error(`logout request failed: HTTP ${response.status}`)
    },
  }
}
