import { expect, test } from 'vitest'
import { CookieJar } from './cookie-jar'

test('stores all Set-Cookie headers and serializes them as a Cookie header', () => {
  const jar = new CookieJar()
  jar.apply(
    new Response(null, {
      headers: [
        ['set-cookie', 'session=abc; Path=/; HttpOnly'],
        ['set-cookie', 'csrf=def; Path=/'],
      ],
    }),
  )

  expect(jar.header()).toBe('session=abc; csrf=def')
  expect(jar.export()).toEqual({ session: 'abc', csrf: 'def' })
})

test('handles combined Set-Cookie headers and removes expired cookies', () => {
  const jar = new CookieJar()
  jar.import({ session: 'old', csrf: 'old-csrf' })
  // Node/Bun expose individual Set-Cookie values via getSetCookie. The fallback
  // is used by runtimes that expose only the combined header value.
  jar.apply({
    headers: {
      get: () => 'session=new; Path=/, csrf=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    },
  } as unknown as Response)

  expect(jar.header()).toBe('session=new')
})

test('removes a cookie when Max-Age is zero', () => {
  const jar = new CookieJar()
  jar.import({ session: 'active' })
  jar.apply(new Response(null, { headers: { 'set-cookie': 'session=; Max-Age=0; Path=/' } }))

  expect(jar.export()).toEqual({})
})
