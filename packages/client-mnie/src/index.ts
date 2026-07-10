import type { SbiClientMethods } from '@repo/mnie-types'

export interface ConnectMnieOptions {
  /** Mnie server origin. A path is intentionally not accepted. */
  baseURL: string | URL
  /** API key or OAuth access token. */
  token: string
  /** Provider registered on the Mnie server. */
  provider?: 'sbisec' | 'smbc-direct'
  /** Provider-neutral profile ID registered on the Mnie server. */
  profileId?: string
  /** WebSocket implementation for non-browser runtimes. */
  WebSocket?: typeof WebSocket
  /** Maximum time to wait for the WebSocket handshake. Defaults to 10 seconds. */
  connectionTimeoutMs?: number
}

export interface MnieRpcError extends Error {
  code: number
}

export interface MnieProviderConnection {
  connected: boolean
  provider: 'sbisec' | 'smbc-direct'
  profileId?: string
  requires2fa?: boolean
  qrurl?: string
  url?: string
}

export interface MnieProfile extends SbiClientMethods {
  /** Calls an RPC method that is not yet represented by the typed SDK. */
  call(method: string, params?: unknown): Promise<unknown>
  /** Returns the RPC methods supported by the connected server. */
  methods(): Promise<string[]>
  /** Selects a provider profile. SMBC Direct returns a QR challenge before connection. */
  connectProvider(
    provider: 'sbisec' | 'smbc-direct',
    profileId: string,
  ): Promise<MnieProviderConnection>
  /** Completes a pending SMBC Direct QR approval. */
  finish2fa(): Promise<MnieProviderConnection>
  /** Closes the WebSocket and rejects any in-flight calls. */
  close(): void
}

interface JsonRpcResponse {
  jsonrpc?: '2.0'
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000

const asOrigin = (baseURL: string | URL) => {
  const url = new URL(baseURL)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseURL must be an origin without a path, query, or fragment')
  }
  return url.origin
}

const websocketUrl = (baseURL: string | URL, token: string) => {
  const url = new URL('/api/ws', asOrigin(baseURL))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('key', token)
  return url.toString()
}

const rpcError = (code: number, message: string): MnieRpcError => {
  const error = new Error(message) as MnieRpcError
  error.name = 'MnieRpcError'
  error.code = code
  return error
}

class JsonRpcConnection {
  readonly #socket: WebSocket
  readonly #pending = new Map<string, PendingCall>()
  readonly #opened: Promise<void>
  #nextId = 1
  #closed = false

  constructor(options: ConnectMnieOptions) {
    if (!options.token.trim()) throw new Error('token is required')
    const timeout = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new Error('connectionTimeoutMs must be a positive finite number')
    }

    const WebSocketCtor = options.WebSocket ?? globalThis.WebSocket
    if (!WebSocketCtor) throw new Error('WebSocket is required outside browser runtimes')
    this.#socket = new WebSocketCtor(websocketUrl(options.baseURL, options.token))
    this.#opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#socket.close()
        reject(new Error(`Mnie RPC connection timed out after ${timeout}ms`))
      }, timeout)
      const rejectOpen = (message: string) => {
        clearTimeout(timer)
        reject(new Error(message))
      }
      this.#socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      this.#socket.addEventListener('error', () => rejectOpen('failed to connect to Mnie RPC'), {
        once: true,
      })
      this.#socket.addEventListener('close', () => rejectOpen('Mnie RPC socket closed'), {
        once: true,
      })
    })
    this.#socket.addEventListener('message', (event) => this.#handleMessage(event))
    this.#socket.addEventListener('close', () => {
      this.#closed = true
      this.#rejectPending(new Error('Mnie RPC socket closed'))
    })
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#socket.close()
    this.#rejectPending(new Error('Mnie RPC socket closed'))
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!method) throw new Error('RPC method is required')
    if (this.#closed) throw new Error('Mnie RPC socket is closed')
    await this.#opened
    if (this.#closed) throw new Error('Mnie RPC socket is closed')

    const id = String(this.#nextId++)
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
    })
    try {
      this.#socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    } catch (cause) {
      this.#pending.delete(id)
      throw cause
    }
    return response
  }

  #handleMessage(event: MessageEvent) {
    let message: JsonRpcResponse
    try {
      message = JSON.parse(String(event.data)) as JsonRpcResponse
    } catch {
      this.close()
      return
    }
    if (message.id == null) return
    const pending = this.#pending.get(String(message.id))
    if (!pending) return
    this.#pending.delete(String(message.id))
    if (message.error) pending.reject(rpcError(message.error.code, message.error.message))
    else pending.resolve(message.result)
  }

  #rejectPending(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

const methodProxy = (rpc: JsonRpcConnection, path: string[] = []): unknown =>
  new Proxy(() => undefined, {
    get(_target, property) {
      if (property === 'then') return undefined
      if (property === 'call') return rpc.call.bind(rpc)
      if (property === 'methods') return () => rpc.call('rpc.methods') as Promise<string[]>
      if (property === 'connectProvider') {
        return (provider: 'sbisec' | 'smbc-direct', profileId: string) =>
          rpc.call('provider.connect', { provider, profileId }) as Promise<MnieProviderConnection>
      }
      if (property === 'finish2fa') {
        return () => rpc.call('provider.finish2fa') as Promise<MnieProviderConnection>
      }
      if (property === 'close') return rpc.close.bind(rpc)
      if (typeof property !== 'string') return undefined
      return methodProxy(rpc, [...path, property])
    },
    apply(_target, _thisArg, args) {
      return rpc.call(path.join('.'), args.length > 1 ? args : args[0])
    },
  })

/** Opens a Mnie RPC connection and returns the selected provider profile. */
export const connectMnie = async (options: ConnectMnieOptions): Promise<MnieProfile> => {
  const rpc = new JsonRpcConnection(options)
  const profile = methodProxy(rpc) as MnieProfile
  try {
    await profile.call('rpc.methods')
    if (options.provider || options.profileId) {
      if (!options.provider || !options.profileId)
        throw new Error('provider and profileId must be provided together')
      const connection = await profile.connectProvider(options.provider, options.profileId)
      if (connection.requires2fa) {
        throw new Error('SMBC Direct requires QR approval; call connectProvider() and finish2fa()')
      }
    }
    return profile
  } catch (cause) {
    profile.close()
    throw cause
  }
}

export type * from '@repo/mnie-types'
