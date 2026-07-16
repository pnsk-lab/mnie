import { expect, test } from 'vite-plus/test'
import {
  createStarbucksJpClient,
  getdeviceFingerprint,
  getFingerPrintHeaders,
  getIoBlackbox,
  normalizeStarbucksOrigin,
} from './index'

const origins = {
  apiOrigin: 'https://api.example.test',
  loginOrigin: 'https://login.example.test',
  appOrigin: 'https://app.example.test',
}

test('provides empty fingerprint placeholders', async () => {
  expect(await getIoBlackbox()).toBe('')
  expect(await getdeviceFingerprint()).toBe('')
  expect(await getFingerPrintHeaders()).toEqual({ 'X-SAPIG-DeviceFingerPrint': '' })
})

test('rejects an origin containing a path', () => {
  expect(() => normalizeStarbucksOrigin('https://example.test/path')).toThrow(/origin/)
})

test('constructs a PKCE authorization request', async () => {
  const client = createStarbucksJpClient(origins)
  const authorization = await client.beginAuthorization('/redirect?pageRedirect=/card/sbcardinfo')
  const url = new URL(authorization.url)
  expect(url.origin).toBe(origins.loginOrigin)
  expect(url.pathname).toBe('/oauth/authorize')
  expect(url.searchParams.get('client_id')).toBe('light-web-app')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorization.codeVerifier.length).toBeGreaterThan(40)
})

test('calls the API proxy with the session cookie', async () => {
  const calls: Request[] = []
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(
      input instanceof Request
        ? new Request(input, init)
        : new Request(input instanceof URL ? input.href : input, init),
    )
    return Response.json({ sbcards: [{ card_number: '1234567890123456' }] })
  }) as typeof fetch
  const client = createStarbucksJpClient({
    ...origins,
    fetch: mockFetch,
  })
  const cards = await client.importSession({ sessionId: 'session-value' }).listCards()
  expect(cards[0]?.card_number).toBe('1234567890123456')
  expect(calls[0]?.headers.get('cookie')).toBe('session_id=session-value')
  expect(calls[0]?.headers.get('x-sbj-proxy-http-path')).toBe('/api/v4/sbcards')
})

test('validates state before exchanging an authorization code', async () => {
  const client = createStarbucksJpClient(origins)
  const authorization = await client.beginAuthorization('/redirect')
  await expect(
    client.completeAuthorization(
      authorization,
      `${origins.appOrigin}/redirect?code=code&state=wrong`,
    ),
  ).rejects.toThrow(/state/)
})
