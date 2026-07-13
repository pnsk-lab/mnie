/**
 * The bank uses a traditional server-side session, while `fetch` deliberately
 * does not retain cookies. This small jar is intentionally limited to the
 * single origin used by this provider.
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

    const maxAge = attributes
      .map((attribute) => attribute.trim())
      .find((attribute) => attribute.toLowerCase().startsWith('max-age='))
    if (maxAge && /^max-age\s*=\s*0$/i.test(maxAge)) {
      this.#cookies.delete(name)
      return
    }

    const expires = attributes
      .map((attribute) => attribute.trim())
      .find((attribute) => attribute.toLowerCase().startsWith('expires='))
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
