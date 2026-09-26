/**
 * VPass runs a server-side session that `fetch` will not retain on its own.
 *
 * The app API and the member-site API sit on different hosts under one
 * registrable domain, and the session cookies the login response sets are what
 * the member-site calls authenticate with. So this jar is deliberately flat: it
 * holds one cookie set and replays it to both origins, which is the behaviour
 * the app's shared `CookieManager` has.
 */
export class CookieJar {
  #cookies = new Map<string, string>()

  apply(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'))
    for (const value of values) this.#apply(value)
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

  #apply(setCookie: string) {
    const [pair, ...attributes] = setCookie.split(';')
    if (!pair) return
    const separator = pair.indexOf('=')
    if (separator <= 0) return

    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (!name) return

    const normalized = attributes.map((attribute) => attribute.trim())

    const maxAge = normalized.find((attribute) => attribute.toLowerCase().startsWith('max-age='))
    if (maxAge && /^max-age\s*=\s*0$/i.test(maxAge)) {
      this.#cookies.delete(name)
      return
    }

    const expires = normalized.find((attribute) => attribute.toLowerCase().startsWith('expires='))
    if (expires) {
      const date = new Date(expires.slice(expires.indexOf('=') + 1))
      if (!Number.isNaN(date.valueOf()) && date <= new Date()) {
        this.#cookies.delete(name)
        return
      }
    }

    this.#cookies.set(name, value)
  }
}

const splitSetCookie = (header: string | null) =>
  header ? header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()) : []
