import { expect, test } from 'vite-plus/test'
import { connectMnie } from './index'

class OpeningWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  send(raw: string) {
    const request = JSON.parse(raw) as { id: string; method: string }
    if (request.method !== 'workspace.operations') {
      throw new Error(`unexpected method: ${request.method}`)
    }
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: [
              'profiles.list',
              'portfolio.valuation.get',
              'portfolio.overview.get',
              'history.list',
            ],
          }),
        }),
      ),
    )
  }
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
    'portfolio.overview.get',
    'history.list',
  ])
  workspace.close()
})

class InteractiveWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  send(raw: string) {
    const request = JSON.parse(raw) as {
      id: string
      method: string
      params?: { profileId?: string; interactionId?: string }
    }
    const result =
      request.method === 'workspace.operations'
        ? ['profiles.list']
        : request.method === 'profile.connect'
          ? {
              status: 'interaction-required',
              profileId: request.params?.profileId,
              providerId: 'smbc-direct',
              interaction: { id: 'interaction-1', kind: 'qr', qrUrl: 'https://example.com/qr' },
            }
          : request.method === 'profile.connection.complete'
            ? {
                status: 'connected',
                profileId: request.params?.profileId,
                providerId: 'smbc-direct',
              }
            : undefined
    if (!result) throw new Error(`unexpected method: ${request.method}`)
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        }),
      ),
    )
  }
}

test('remote workspace completes interactive profile authentication over WebSocket', async () => {
  const workspace = await connectMnie({
    baseURL: 'https://example.com',
    token: 'test-token',
    WebSocket: InteractiveWebSocket as unknown as typeof WebSocket,
  })

  const pending = await workspace.connectProfile('profile-1')
  expect(pending.status).toBe('interaction-required')
  expect(pending.interaction?.kind).toBe('qr')
  await expect(
    workspace.completeProfileConnection('profile-1', pending.interaction!.id),
  ).resolves.toMatchObject({ status: 'connected', profileId: 'profile-1' })
  workspace.close()
})
