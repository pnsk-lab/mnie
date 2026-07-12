import { expect, test } from 'vitest'
import { connectMnie } from './index'

class OpeningWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  send() {}
}

test('remote workspace advertises history.list', async () => {
  const workspace = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    WebSocket: OpeningWebSocket as unknown as typeof WebSocket,
  })

  expect(await workspace.operations()).toEqual([
    'profiles.list',
    'portfolio.valuation.get',
    'history.list',
  ])
  workspace.close()
})
