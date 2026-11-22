import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

const jsonResponse = (payload: unknown, init?: { ok?: boolean; statusText?: string }) => ({
  ok: init?.ok ?? true,
  statusText: init?.statusText ?? 'OK',
  json: () => Promise.resolve(payload),
})

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rpc requests over http', () => {
  test('listApiKeys posts a JSON-RPC request to the rpc endpoint and resolves the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: { apiKeys: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const { listApiKeys } = await import('./api')
    await expect(listApiKeys()).resolves.toEqual({ apiKeys: [] })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rpc/admin.apiKeys.list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'admin.apiKeys.list',
          params: {},
        }),
      }),
    )
  })
  test('an rpc error envelope rejects with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: -32000, message: 'だめです' } })),
    )
    const { listApiKeys } = await import('./api')
    await expect(listApiKeys()).rejects.toThrow('だめです')
  })
  test('a non-2xx response rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: -32001, message: 'unauthenticated' } },
            { ok: false, statusText: 'Unauthorized' },
          ),
        ),
    )
    const { listApiKeys } = await import('./api')
    await expect(listApiKeys()).rejects.toThrow('unauthenticated')
  })
  test('a malformed payload rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
    const { listApiKeys } = await import('./api')
    await expect(listApiKeys()).rejects.toThrow('応答が不正')
  })
  test('a fetch failure rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const { listApiKeys } = await import('./api')
    await expect(listApiKeys()).rejects.toThrow('network error')
  })
})
