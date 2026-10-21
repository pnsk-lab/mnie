import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

class TestSocket {
  static OPEN = 1
  static instances: TestSocket[] = []
  readyState = 0
  listeners = new Map<string, Array<(event: { data?: string }) => void>>()
  send = vi.fn((_data: string) => {})
  constructor() {
    TestSocket.instances.push(this)
  }
  addEventListener(name: string, callback: (event: { data?: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback])
  }
  emit(name: string, data?: string) {
    if (name === 'open') this.readyState = 1
    for (const listener of this.listeners.get(name) ?? []) listener({ data })
  }
  close() {
    this.readyState = 3
    this.emit('close')
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  TestSocket.instances = []
  vi.stubGlobal('WebSocket', TestSocket)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('admin RPC failures settle and allow recovery', () => {
  test('close before open rejects the waiting action and a retry connects', async () => {
    const { listApiKeys } = await import('./api')
    const first = listApiKeys()
    const failure = expect(first).rejects.toThrow('接続が切れました')
    TestSocket.instances[0]!.close()
    await failure
    const second = listApiKeys()
    const socket = TestSocket.instances[1]!
    socket.emit('open')
    await flush()
    const request = JSON.parse(socket.send.mock.calls[0]![0] as string)
    socket.emit('message', JSON.stringify({ id: request.id, result: { apiKeys: [] } }))
    await expect(second).resolves.toEqual({ apiKeys: [] })
  })
  test('handshake timeout rejects instead of leaving the button pending', async () => {
    const { listApiKeys } = await import('./api')
    const failure = expect(listApiKeys()).rejects.toThrow('接続がタイムアウト')
    await vi.advanceTimersByTimeAsync(30_000)
    await failure
    expect(vi.getTimerCount()).toBe(0)
  })
  test('request timeout ignores a late response and the next action can complete', async () => {
    const { listApiKeys } = await import('./api')
    const first = listApiKeys()
    const socket = TestSocket.instances[0]!
    socket.emit('open')
    await flush()
    const failure = expect(first).rejects.toThrow('操作が反映されているか確認')
    await vi.advanceTimersByTimeAsync(60_000)
    await failure
    const old = JSON.parse(socket.send.mock.calls[0]![0] as string)
    socket.emit('message', JSON.stringify({ id: old.id, result: { apiKeys: [] } }))
    const next = listApiKeys()
    await flush()
    const request = JSON.parse(socket.send.mock.calls[1]![0] as string)
    socket.emit('message', JSON.stringify({ id: request.id, result: { apiKeys: [] } }))
    await expect(next).resolves.toEqual({ apiKeys: [] })
    expect(vi.getTimerCount()).toBe(0)
  })
  test('malformed response is an error and clears its timeout', async () => {
    const { listApiKeys } = await import('./api')
    const pending = listApiKeys()
    const socket = TestSocket.instances[0]!
    socket.emit('open')
    await flush()
    const request = JSON.parse(socket.send.mock.calls[0]![0] as string)
    const failure = expect(pending).rejects.toThrow('応答が不正')
    socket.emit('message', JSON.stringify({ id: request.id }))
    await failure
    expect(vi.getTimerCount()).toBe(0)
  })
  test('a send failure rejects and clears its timeout', async () => {
    const { listApiKeys } = await import('./api')
    const pending = listApiKeys()
    const failure = expect(pending).rejects.toThrow('send failed')
    const socket = TestSocket.instances[0]!
    socket.send.mockImplementation(() => {
      throw new Error('send failed')
    })
    socket.emit('open')
    await failure
    expect(vi.getTimerCount()).toBe(0)
  })
})
