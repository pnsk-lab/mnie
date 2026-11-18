import { describe, expect, it } from 'vite-plus/test'
import { CookieJar } from './cookie-jar'

const expired = 'Thu, 01 Jan 1970 00:00:00 GMT'
const future = 'Fri, 01 Jan 2100 00:00:00 GMT'

const responseWithCookies = (...cookies: string[]) => {
  const headers = new Headers()
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { headers })
}

describe('CookieJar', () => {
  it.each(['-1', '-60', '0'])('deletes an existing cookie with Max-Age=%s', (maxAge) => {
    const jar = new CookieJar()
    jar.apply(responseWithCookies('session=old', 'other=keep'))
    jar.apply(responseWithCookies(`session=discard; Max-Age=${maxAge}; Expires=${future}`))

    expect(jar.header()).toBe('other=keep')
    expect(jar.export()).toEqual({ other: 'keep' })
  })

  it('uses a positive Max-Age over a past Expires and overwrites the old value', () => {
    const jar = new CookieJar()
    jar.apply(responseWithCookies('session=old'))
    jar.apply(responseWithCookies(`session=new; mAx-AgE = 60; Expires=${expired}`))

    expect(jar.header()).toBe('session=new')
  })

  it('honors Expires when Max-Age is absent or invalid', () => {
    const jar = new CookieJar()
    jar.apply(
      responseWithCookies(
        `session=old; Expires=${future}`,
        'other=keep; Expires=invalid',
        'another=old',
      ),
    )
    expect(jar.header()).toBe('session=old; other=keep; another=old')

    jar.apply(
      responseWithCookies(
        `session=discard; Expires=${expired}`,
        `another=discard; Max-Age=-1junk; Expires=${expired}`,
      ),
    )
    expect(jar.header()).toBe('other=keep')
  })

  it('applies multiple Set-Cookie headers in order', () => {
    const jar = new CookieJar()
    jar.apply(responseWithCookies('session=old', 'session=new', 'other=a=b'))
    expect(jar.header()).toBe('session=new; other=a=b')

    jar.apply(responseWithCookies('session=discard; Max-Age=0', 'session=reissued'))
    expect(jar.header()).toBe('other=a=b; session=reissued')
  })

  it('reads combined Set-Cookie headers without splitting the Expires date', () => {
    const jar = new CookieJar()
    const response = responseWithCookies(`session=active; Expires=${future}, other=keep`)
    Object.defineProperty(response.headers, 'getSetCookie', { value: undefined })

    jar.apply(response)

    expect(jar.header()).toBe('session=active; other=keep')
  })

  it('round-trips the saved cookie record and replaces the previous jar contents', () => {
    const original = new CookieJar()
    original.apply(responseWithCookies('session=active; Max-Age=60', 'deleted=old'))
    original.apply(responseWithCookies('deleted=discard; Max-Age=-1'))
    const saved = JSON.parse(JSON.stringify(original.export()))

    const restored = new CookieJar()
    restored.apply(responseWithCookies('stale=old'))
    restored.import(saved)

    expect(saved).toEqual({ session: 'active' })
    expect(restored.header()).toBe('session=active')
    restored.import({})
    expect(restored.header()).toBe('')
  })
})
