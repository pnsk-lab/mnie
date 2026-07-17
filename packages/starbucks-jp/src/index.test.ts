import { expect, test } from 'vite-plus/test'
import { createMiniWindow, MiniEvent } from './browser-shim'
import {
  createStarbucksCurrentPureKxzVm,
  createStarbucksCurrentPureLoginVm,
} from './current-kxz-vm'
import {
  createStarbucksIoBlackboxRuntime,
  createStarbucksIoBlackboxRuntimeFromLogin,
  createStarbucksKxzRuntime,
  createStarbucksJpClient,
  decodeStarbucksIoBlackbox,
  decodeStarbucksIoBlackboxes,
  fetchStarbucksIoBlackboxScript,
  fetchStarbucksIoDynamicScript,
  fetchStarbucksIoLogoScript,
  fetchStarbucksIoRemoteWdpScript,
  fetchStarbucksKxzScripts,
  getdeviceFingerprint,
  getFingerPrintHeaders,
  getIoBlackbox,
  collectStarbucksIoBrowserSignals,
  createStarbucksIoInteractionCollector,
  normalizeStarbucksOrigin,
  parseStarbucksKxzSeedURL,
  parseStarbucksKxzBootstrapInit,
  parseStarbucksLoginBootstrapEvent,
  parseStarbucksIoDynamicScript,
  parseStarbucksIoLogoScript,
  readStarbucksKxzHeaders,
  matchesStarbucksKxzRequest,
  splitStarbucksKxzHeaderValue,
  chunkStarbucksKxzHeader,
  createStarbucksKxzInstrumented,
  createStarbucksPureLoginVm,
  createStarbucksQuickJsBrowserRuntime,
} from './index'

const origins = {
  apiOrigin: 'https://api.example.test',
  loginOrigin: 'https://login.example.test',
  appOrigin: 'https://app.example.test',
}

test('creates the strict QuickJS browser realm and exposes form controls', async () => {
  const runtime = await createStarbucksQuickJsBrowserRuntime({
    pageURL: 'https://login.example.test/login',
    userAgent: 'test-agent',
  })
  expect(
    runtime.evaluate('[navigator.userAgent, location.origin, typeof document.querySelector]'),
  ).toEqual(['test-agent', 'https://login.example.test', 'function'])
  expect(runtime.evaluate('document.querySelector("form").action')).toBe(
    'https://login.example.test/login',
  )
  expect(runtime.readFormFields()).toMatchObject({ username: '', password: '' })
  expect(() => runtime.evaluate('fetch("https://example.test/")')).toThrow(/fetch is not available/)
  runtime.close()
  expect(() => runtime.evaluate('1 + 1')).toThrow(/runtime is closed/)
})

test('requires an iOvation runtime for browser fingerprint helpers', async () => {
  await expect(getIoBlackbox({ url: 'https://example.test/' })).rejects.toThrow(/iOvation runtime/)
  await expect(getdeviceFingerprint({ url: 'https://example.test/' })).rejects.toThrow(
    /iOvation runtime/,
  )
  await expect(getFingerPrintHeaders({ url: 'https://example.test/' })).rejects.toThrow(
    /iOvation runtime/,
  )
})

test('uses a supplied iOvation runtime for fingerprint headers', async () => {
  const ioBlackboxRuntime = {
    async getBlackbox() {
      return '0400captured-blackbox'
    },
    close() {},
  }
  expect(await getIoBlackbox({ ioBlackboxRuntime })).toBe('0400captured-blackbox')
  expect((await getFingerPrintHeaders({ ioBlackboxRuntime }))['X-SAPIG-DeviceFingerPrint']).toBe(
    '0400captured-blackbox',
  )
})

test('requires runtime-extracted data for the optional pure login VM', () => {
  const globalObject = createMiniWindow('https://example.test/') as any
  expect(() => createStarbucksPureLoginVm(globalObject, { throwOnHandlerError: true })).toThrow(
    /login VM data is required/,
  )
})

test('requires runtime-extracted data for the current TypeScript VMs', () => {
  for (const createVm of [createStarbucksCurrentPureKxzVm, createStarbucksCurrentPureLoginVm]) {
    const browser = createMiniWindow('https://example.test/login') as any
    expect(() => createVm(browser)).toThrow(/VM data is required/)
  }
})

test('parses the login CustomEvent bridge without evaluating the inline script', () => {
  const source =
    '(function(e,d){var isk=["evt-1"];for(var i=0;i<isk.length;++i){e.initCustomEvent(isk[i],false,false,d);dispatchEvent(e)}}(document.createEvent("CustomEvent"),["token",[1,2],[],document.currentScript&&document.currentScript.nonce||"nonce",typeof arguments==="undefined"?void 0:arguments,(document.currentScript||{})&&(document.currentScript||{}).src||null]))'
  expect(parseStarbucksLoginBootstrapEvent(source)).toEqual({
    type: 'evt-1',
    detail: ['token', [1, 2], [], 'nonce', undefined, null],
  })
})

test('serializes explicit browser iOvation signals in TypeScript', async () => {
  const runtime = await createStarbucksIoBlackboxRuntime('staticVer="5.12.0"', {
    pageURL: 'https://login.example.test/login',
    signals: {
      CTOKEN: 'ctoken',
      LSTOKEN: 'lstoken',
      SVRTIME: '2026/07/17 00:00:00',
      JSTOKEN: 'jstoken',
      JSSRC: 'https://example.test/wdp.js',
      GLUV: 'vendor',
      GLUR: 'renderer',
      CVGRAD: 'gradient',
      CVFM: 'font',
      AUD: 'audio',
      PTYP: 'touch',
      TOUCH: 'touch-data',
      TDOWN: 'touchdown-data',
      MMOV: 'move-data',
      CLICK: 'click-data',
      MDOWN: 'mousedown-data',
      KEY: 'key-data',
      KDOWN: 'keydown-data',
      KBTWN: 'key-between',
      TBTWN: 'touch-between',
      MBTWN: 'mouse-between',
      JINT: 'form',
    },
  })
  const blackbox = await runtime.getBlackbox()
  expect(blackbox).toMatch(/^0400[A-Za-z0-9+/=]+$/)
  expect(decodeStarbucksIoBlackbox(blackbox)).toContain('CTOKEN')
  runtime.close()
})

test('collects pure-TypeScript canvas and WebGL signals from a browser surface', () => {
  const signals = collectStarbucksIoBrowserSignals({
    document: {
      createElement() {
        return {
          width: 1,
          height: 1,
          getContext(kind: string) {
            if (kind === '2d')
              return {
                font: '',
                measureText() {
                  return {
                    actualBoundingBoxLeft: 0,
                    actualBoundingBoxRight: 1,
                    actualBoundingBoxAscent: 1,
                    actualBoundingBoxDescent: 0,
                  }
                },
              }
            if (kind === 'webgl')
              return {
                getExtension() {
                  return { UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 }
                },
                getParameter(parameter: number) {
                  return parameter === 1 ? 'vendor' : parameter === 2 ? 'renderer' : 0
                },
                getSupportedExtensions() {
                  return []
                },
                ALIASED_POINT_SIZE_RANGE: 1,
                MAX_VIEWPORT_DIMS: 2,
                MAX_VARYING_VECTORS: 3,
                MAX_COMBINED_TEXTURE_IMAGE_UNITS: 4,
                SHADING_LANGUAGE_VERSION: 5,
                MAX_TEXTURE_IMAGE_UNITS: 6,
                SAMPLE_BUFFERS: 7,
              }
            return null
          },
          toDataURL() {
            return 'data:image/png;base64,AA=='
          },
        }
      },
    },
  })
  expect(signals.CVFM).toMatch(/^[0-9a-f]{40}$/)
  expect(signals.GLUV).toBe('vendor')
  expect(signals.GLUR).toBe('renderer')
  expect(signals.GLEL).toMatch(/^[0-9a-f]{23}$/)
  expect(signals.CVGRAD).toMatch(/^[0-9a-f]{33}$/)
})

test('records iOvation interaction telemetry before blackbox serialization', async () => {
  const browser = createMiniWindow('https://login.example.test/login')
  const collector = createStarbucksIoInteractionCollector(browser)
  browser.dispatchEvent(
    new MiniEvent('mousedown', { isTrusted: true, button: 0, screenX: 10, screenY: 20 }),
  )
  browser.dispatchEvent(
    new MiniEvent('mouseup', { isTrusted: true, button: 0, screenX: 11, screenY: 21 }),
  )
  expect(collector.signals().CLICK).toMatch(/^\d+;true;1;/)
  expect(collector.signals().MDOWN).toMatch(/^\d+;\d+;/)
  collector.close()
  await Promise.resolve()
})

test('rejects an incomplete KXZ capture and parses the rotating seed', () => {
  expect(() => readStarbucksKxzHeaders({ 'KXZ2x4Fzkp-a': 'a' })).toThrow(/missing header/)
  expect(
    parseStarbucksKxzSeedURL('https://example.test/guard.js?seed=seed&KXZ2x4Fzkp--z=q'),
  ).toEqual({
    url: 'https://example.test/guard.js?seed=seed&KXZ2x4Fzkp--z=q',
    seed: 'seed',
    z: 'q',
  })
})

test('extracts KXZ bootstrap init literals without evaluating JavaScript', () => {
  const source = `(function(a){addEventListener('LWytacIbx',function(e){e.detail.init("token\\x2dvalue",[1,2,3],[],document.currentScript&&document.currentScript.nonce||"fallback",a,(s||{}).src||null)},!0)})(void 0)`
  expect(parseStarbucksKxzBootstrapInit(source)).toEqual([
    'token-value',
    [1, 2, 3],
    [],
    'fallback',
    undefined,
    null,
  ])
  expect(() => parseStarbucksKxzBootstrapInit('addEventListener("x", () => {})')).toThrow(
    /detail\.init/,
  )
})

test('keeps the KXZ matcher and header chunking parameterised', () => {
  const matcher = {
    origins: ['https://api.example.test'],
    paths: ['/guard'],
    methods: ['POST'],
  }
  expect(
    matchesStarbucksKxzRequest({ url: 'https://api.example.test/guard', method: 'post' }, matcher),
  ).toBe(true)
  expect(
    matchesStarbucksKxzRequest({ url: 'https://api.example.test/other', method: 'POST' }, matcher),
  ).toBe(false)
  expect(splitStarbucksKxzHeaderValue('abcdef', 2)).toEqual(['ab', 'cd', 'ef'])
  expect(
    chunkStarbucksKxzHeader('X-Test', 'abcdef', { headerNamePrefix: 'X-', headerChunkSize: 2 }),
  ).toEqual({
    'X-Test': 'ab',
    'X-Test0': 'cd',
    'X-Test1': 'ef',
  })
  expect(
    readStarbucksKxzHeaders({
      'KXZ2x4Fzkp-a': 'ab',
      'KXZ2x4Fzkp-a0': 'cd',
      'KXZ2x4Fzkp-b': 'b',
      'KXZ2x4Fzkp-c': 'c',
      'KXZ2x4Fzkp-d': 'd',
      'KXZ2x4Fzkp-f': 'f',
      'KXZ2x4Fzkp-z': 'z',
    }).a,
  ).toBe('abcd')
})

test('creates the static KXZ instrumentation contract from browser descriptors', () => {
  const browser = createMiniWindow('https://example.test/') as any
  browser.fetch = () => Promise.resolve(new Response(null, { status: 204 }))
  const instrumented = createStarbucksKxzInstrumented(browser)
  expect(instrumented.CustomEvent?.originals.value).toBe(browser.CustomEvent)
  expect(instrumented.fetch?.originals.value).toBe(browser.fetch)
  expect(instrumented.formSubmit?.originals.value).toBe(browser.HTMLFormElement.prototype.submit)
  expect(instrumented.cancelBubble).toBeNull()
  expect(instrumented.timeout).toBeNull()
  const calls: unknown[] = []
  instrumented.fetch?.onBeforeInvoke.register((value) => {
    calls.push(value.args)
    return null
  })
  instrumented.fetch?.onBeforeInvoke.notify({ args: ['url'], thisObj: browser })
  expect(calls).toEqual([['url']])
})

test('parses iOvation dynamic registrations without evaluating JavaScript', () => {
  expect(
    parseStarbucksIoDynamicScript(
      'a("jssrc",d("ZXV3MXB3MTAxYg=="));a("suagt",c("curl%2F8.20.0").slice(0,400));a("svrtime","2026/07/17 00:00:00")',
    ),
  ).toEqual({
    JSSRC: 'euw1pw101b',
    SUAGT: 'curl/8.20.0',
    SVRTIME: '2026/07/17 00:00:00',
  })
})

test('preserves FP-prefixed iOvation dynamic fields', () => {
  expect(
    parseStarbucksIoDynamicScript(
      'a("fphcctrl","no-cache");a("fphxfwdfr","cipher");a("fphvia","via")',
    ),
  ).toEqual({ FPHCCTRL: 'no-cache', FPHXFWDFR: 'cipher', FPHVIA: 'via' })
})

test('parses iOvation logo token registrations without evaluating JavaScript', () => {
  expect(
    parseStarbucksIoLogoScript(
      'b._CTOKEN="ctoken";try{a.api.io_bb.add("LID","lid-value")}catch(e){}',
    ),
  ).toEqual({ CTOKEN: 'ctoken', LID: 'lid-value' })
  expect(() => parseStarbucksIoLogoScript('window.logoMain=true')).toThrow(/_CTOKEN/)
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

test('completes browserless OAuth with a pre-authenticated cookie', async () => {
  const calls: Request[] = []
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input instanceof URL ? input.href : input, init)
    calls.push(request)
    const url = new URL(request.url)
    if (url.pathname === '/oauth/authorize') {
      const state = url.searchParams.get('state')
      return new Response(null, {
        status: 302,
        headers: {
          location: `${origins.appOrigin}/redirect?code=one-time-code&state=${state}`,
          'set-cookie': 'opbs=authorization-cookie; Path=/',
        },
      })
    }
    if (url.pathname === '/auth/redirect') {
      expect(request.headers.get('cookie')).toContain('BARISTA_REMEMBER_ME=remember-token')
      return new Response(null, {
        status: 200,
        headers: { 'set-cookie': 'session_id=created-session; Path=/' },
      })
    }
    throw new Error(`unexpected request: ${request.url}`)
  }) as typeof fetch
  const client = createStarbucksJpClient({ ...origins, fetch: mockFetch })

  const session = await client.loginWithCookies({
    cookies: { BARISTA_REMEMBER_ME: 'remember-token' },
  })
  expect(session.session.export().sessionId).toBe('created-session')
  expect(calls).toHaveLength(2)
})

test('requires a browser fingerprint for credential login', async () => {
  const client = createStarbucksJpClient(origins)
  await expect(
    client.loginWithCredentials({ username: 'user@example.test', password: 'password' }),
  ).rejects.toThrow(/deviceFingerprint|ioBlackboxRuntime/)
})

test('loads the KXZ chain dynamically from the app HTML', async () => {
  const responses: Record<string, string> = {
    'https://app.example.test/': '<script src="https://api.example.test/guard.js?single"></script>',
    'https://api.example.test/guard.js?single': '"https://api.example.test/guard.js?async"',
    'https://api.example.test/guard.js?async':
      'u="https://api.example.test/guard.js?async&seed=seed-value&KXZ2x4Fzkp--z=q"',
    'https://api.example.test/guard.js?async&seed=seed-value&KXZ2x4Fzkp--z=q': 'main',
  }
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = responses[url]
    if (!body) return new Response('not found', { status: 404 })
    return new Response(body, { status: 200 })
  }) as typeof fetch
  const scripts = await fetchStarbucksKxzScripts('https://app.example.test', {
    fetch: mockFetch,
  })
  expect(scripts.instrumentation).toContain('async')
  expect(scripts.bootstrap).toContain('seed-value')
  expect(scripts.main).toBe('main')
})

test('rejects an unknown KXZ bundle when its runtime contract cannot be extracted', async () => {
  await expect(
    createStarbucksKxzRuntime(
      { instrumentation: 'unknown', bootstrap: 'unknown', main: 'unknown' },
      { pageURL: 'https://app.example.test/' },
    ),
  ).rejects.toThrow(/KXZ (?:bootstrap|bundle) /)
})

test('loads the current iOvation WDP version from login HTML', async () => {
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://login.example.test/login')
      return new Response('<script>"loader":{"version":"general5"}</script>', { status: 200 })
    if (url === 'https://login.example.test/iojs/general5/static_wdp.js')
      return new Response('wdp', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  expect(
    await fetchStarbucksIoBlackboxScript('https://login.example.test/login', {
      fetch: mockFetch,
    }),
  ).toBe('wdp')
})

test('loads the dynamic iOvation registration source without evaluating it', async () => {
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://login.example.test/iojs/5.12.0/dyn_wdp.js')
      return new Response('a("jstoken","token")', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  await expect(
    fetchStarbucksIoDynamicScript('https://login.example.test/login', 'staticVer="5.12.0"', {
      fetch: mockFetch,
    }),
  ).resolves.toContain('jstoken')
})

test('loads the iOvation logo registration from dynamic config', async () => {
  const encodedHost = Buffer.from('https://collector.example.test/').toString('base64')
  const encodedPath = Buffer.from('iojs/latest/logo.js').toString('base64')
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://collector.example.test/iojs/latest/logo.js')
      return new Response('b._CTOKEN="ctoken"', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  await expect(
    fetchStarbucksIoLogoScript(
      `b.contentServerHost=d("${encodedHost}");b.ctokenScriptPath=d("${encodedPath}")`,
      { fetch: mockFetch },
    ),
  ).resolves.toContain('_CTOKEN')
})

test('resolves a same-origin iOvation logo path when contentServerHost is empty', async () => {
  const encodedPath = Buffer.from('iojs/latest/logo.js').toString('base64')
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://login.example.test/iojs/latest/logo.js')
      return new Response('b._CTOKEN="ctoken"', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  await expect(
    fetchStarbucksIoLogoScript(
      `b.contentServerHost=d("");b.ctokenScriptPath=d("${encodedPath}")`,
      { fetch: mockFetch },
      'https://login.example.test/login',
    ),
  ).resolves.toContain('_CTOKEN')
})

test('loads the remote iOvation WDP origin from static source literals', async () => {
  const encodedOrigin = Buffer.from('https://collector.example.test').toString('base64')
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    expect(url).toBe('https://collector.example.test/general5/wdp.js?loaderVer=5.2.2')
    return new Response('remote-wdp', { status: 200 })
  }) as typeof fetch
  await expect(
    fetchStarbucksIoRemoteWdpScript(`L.decode("${encodedOrigin}");staticVer="5.12.0"`, 'general5', {
      fetch: mockFetch,
      loaderVersion: '5.2.2',
    }),
  ).resolves.toBe('remote-wdp')
})

test('combines the remote IO and local FP iOvation collectors', async () => {
  const encode = (value: string) => Buffer.from(value).toString('base64')
  const localStatic = `staticVer="5.12.0";L.decode("${encode('https://collector.example.test')}")`
  const localDynamic = `b.contentServerHost=d("");b.ctokenScriptPath=d("${encode('iojs/latest/logo.js')}");a("jstoken","fp-token")`
  const remoteDynamic = `staticVer="5.12.0";b.contentServerHost=d("${encode('https://collector.example.test/')}");b.ctokenScriptPath=d("${encode('latest/logo.js')}");a("jstoken","io-token")`
  const responses: Record<string, string> = {
    'https://login.example.test/login':
      '<script>"loader":{"version":"general5"}</script> loaderVer="5.2.2"',
    'https://login.example.test/iojs/general5/static_wdp.js': localStatic,
    'https://login.example.test/iojs/5.12.0/dyn_wdp.js': localDynamic,
    'https://login.example.test/iojs/latest/logo.js': 'b._CTOKEN="fp-ctoken"',
    'https://collector.example.test/general5/wdp.js?loaderVer=5.2.2': remoteDynamic,
    'https://collector.example.test/latest/logo.js': 'b._CTOKEN="io-ctoken"',
  }
  const mockFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = responses[url]
    return body ? new Response(body, { status: 200 }) : new Response('not found', { status: 404 })
  }) as typeof fetch
  const runtime = await createStarbucksIoBlackboxRuntimeFromLogin(
    'https://login.example.test/login',
    {
      fetch: mockFetch,
      width: 412,
      height: 915,
      colorDepth: 24,
      userAgent: 'test-browser/1.0',
    },
  )
  const parts = (await runtime.getBlackbox()).split(';')
  expect(parts).toHaveLength(2)
  expect(parts.every((part) => /^0400[A-Za-z0-9+/=]+$/.test(part))).toBe(true)
  const plaintexts = decodeStarbucksIoBlackboxes(parts.join(';'))
  expect(plaintexts).toHaveLength(2)
  expect(plaintexts[0]).toContain('0004JRES0007915x412')
  expect(() => decodeStarbucksIoBlackbox(parts.join(';'))).toThrow(/multiple envelopes/)
  runtime.close()
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

test('reads balances from authenticated card data and exposes history alias', async () => {
  const calls: Request[] = []
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input instanceof URL ? input.href : input, init)
    calls.push(request)
    const path = request.headers.get('x-sbj-proxy-http-path')
    if (path === '/api/v4/sbcards')
      return Response.json({
        sbcards: [
          {
            card_number: '1234567890123456',
            latest_amount: { amount: 925, updated_date: '2026-07-17T20:36:40' },
          },
        ],
      })
    if (path === '/api/v4/sbcards/histories')
      return Response.json({
        histories: [
          { store_name: 'テスト店', created_date: '2026-07-17T12:00:00', used_amount: -500 },
        ],
      })
    return Response.json({})
  }) as typeof fetch
  const session = createStarbucksJpClient({ ...origins, fetch: mockFetch }).importSession({
    sessionId: 'session-value',
  })

  await expect(session.getBalance()).resolves.toEqual([
    { card_number: '1234567890123456', amount: 925, updated_date: '2026-07-17T20:36:40' },
  ])
  await expect(session.history('1234567890123456')).resolves.toEqual([
    { store_name: 'テスト店', created_date: '2026-07-17T12:00:00', used_amount: -500 },
  ])
  expect(calls.map((request) => request.headers.get('x-sbj-proxy-http-path'))).toEqual([
    '/api/v4/sbcards',
    '/api/v4/sbcards/histories',
  ])
})

test('merges runtime-generated KXZ headers into the proxy request', async () => {
  const calls: Request[] = []
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(
      input instanceof Request
        ? new Request(input, init)
        : new Request(input instanceof URL ? input.href : input, init),
    )
    return Response.json({ sbcards: [] })
  }) as typeof fetch
  const client = createStarbucksJpClient({
    ...origins,
    fetch: mockFetch,
    kxzRuntime: {
      async getHeaders(request) {
        expect(new URL(request.url).pathname).toBe('/resources/_execute-api')
        return { 'KXZ2x4Fzkp-a': 'generated-for-test' }
      },
      close() {},
    },
  })

  await client.importSession({ sessionId: 'session-value' }).listCards()
  expect(calls[0]?.headers.get('kxz2x4fzkp-a')).toBe('generated-for-test')
})

test('includes the iOvation blackbox in the proxy envelope', async () => {
  let request: Request | undefined
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input instanceof URL ? input.href : input, init)
    return Response.json({ sbcards: [] })
  }) as typeof fetch
  const client = createStarbucksJpClient({
    ...origins,
    fetch: mockFetch,
    ioBlackboxRuntime: {
      async getBlackbox() {
        return '0400captured-blackbox'
      },
      close() {},
    },
  })

  await client.importSession({ sessionId: 'session-value' }).listCards()
  const proxyHeaders = JSON.parse(request?.headers.get('x-sbj-proxy-headers') ?? '{}') as Record<
    string,
    string
  >
  expect(proxyHeaders['X-SAPIG-DeviceFingerPrint']).toBe('0400captured-blackbox')
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
