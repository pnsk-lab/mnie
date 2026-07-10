import type { SbiClientMethods } from '@repo/mnie-types'

export interface MnieSdkOptions {
  origin: string
  apiKey: string
  WebSocket?: typeof WebSocket
}

export interface JsonRpcError {
  code: number
  message: string
}

export type MnieClient = SbiClientMethods & {
  connect(options: { passkeyId: string }): Promise<{ connected: true; passkeyId: string }>
  methods(): Promise<string[]>
  close(): void
}

interface JsonRpcResponse {
  jsonrpc?: '2.0'
  id?: string | number | null
  result?: unknown
  error?: JsonRpcError
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const websocketUrl = (origin: string, apiKey: string) => {
  const url = new URL('/api/ws', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('key', apiKey)
  return url.toString()
}

class MnieJsonRpcClient {
  readonly #socket: WebSocket
  readonly #pending = new Map<string, PendingCall>()
  #nextId = 1
  #opened: Promise<void>

  constructor(options: MnieSdkOptions) {
    const WebSocketCtor = options.WebSocket ?? WebSocket
    this.#socket = new WebSocketCtor(websocketUrl(options.origin, options.apiKey))
    this.#opened = new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', () => resolve(), { once: true })
      this.#socket.addEventListener(
        'error',
        () => reject(new Error('failed to connect to Mnie RPC')),
        { once: true },
      )
    })
    this.#socket.addEventListener('message', (event) => this.#handleMessage(event))
    this.#socket.addEventListener('close', () => this.#rejectPending('Mnie RPC socket closed'))
  }

  close() {
    this.#socket.close()
  }

  async call(method: string, params?: unknown) {
    await this.#opened
    const id = String(this.#nextId++)
    const response = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
    })
    this.#socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return response
  }

  #handleMessage(event: MessageEvent) {
    const message = JSON.parse(String(event.data)) as JsonRpcResponse
    if (message.id == null) return
    const pending = this.#pending.get(String(message.id))
    if (!pending) return
    this.#pending.delete(String(message.id))
    if (message.error) {
      pending.reject(new Error(message.error.message))
      return
    }
    pending.resolve(message.result)
  }

  #rejectPending(message: string) {
    for (const pending of this.#pending.values()) pending.reject(new Error(message))
    this.#pending.clear()
  }
}

const methodProxy = (rpc: MnieJsonRpcClient, path: string[] = []): unknown =>
  new Proxy(() => undefined, {
    get(_target, property) {
      if (property === 'then') return undefined
      if (property === 'connect') {
        return (params: { passkeyId: string }) => rpc.call('sbi.connect', params)
      }
      if (property === 'methods') return () => rpc.call('rpc.methods')
      if (property === 'close') return () => rpc.close()
      if (typeof property !== 'string') return undefined
      return methodProxy(rpc, [...path, property])
    },
    apply(_target, _thisArg, args) {
      return rpc.call(path.join('.'), args.length > 1 ? args : args[0])
    },
  })

export const createMnieClient = (options: MnieSdkOptions) =>
  methodProxy(new MnieJsonRpcClient(options)) as MnieClient

export type * from '@repo/mnie-types'
