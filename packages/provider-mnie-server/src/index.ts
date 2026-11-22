import type {
  AvailabilityCheckResult,
  Capability,
  FinancialProvider,
  MethodAvailability,
  MethodAvailabilityRequest,
  MethodMap,
  MethodName,
  MethodRequest,
  MethodResponse,
  MnieClient,
  MnieMethods,
  ProfileConnection,
  ProfileSyncResult,
  ProviderAvailability,
  ProviderDescriptor,
  PublicFinancialAccount,
} from '@mnie/types'

export type { MnieClient }
export type MnieProfileConnection = ProfileConnection

export interface ConnectMnieOptions {
  /** Mnie server origin. A path is intentionally not accepted. */
  baseURL: string | URL
  /** API key or OAuth access token. */
  token: string
  /** Transport used to reach the Mnie RPC endpoint. Defaults to 'websocket'. */
  transport?: 'websocket' | 'rest'
  /** WebSocket implementation for non-browser runtimes. Only used with the 'websocket' transport. */
  WebSocket?: typeof WebSocket
  /**
   * Maximum time to wait for the WebSocket handshake. Defaults to 10 seconds.
   * Only used with the 'websocket' transport.
   */
  connectionTimeoutMs?: number
}

export interface MnieRpcError extends Error {
  code: number
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

interface RpcTransport {
  call(method: string, params?: unknown): Promise<unknown>
  close(): void
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

class JsonRpcConnection implements RpcTransport {
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

class RestRpcConnection implements RpcTransport {
  readonly #origin: string
  readonly #token: string
  #nextId = 1

  constructor(options: ConnectMnieOptions) {
    if (!options.token.trim()) throw new Error('token is required')
    this.#origin = asOrigin(options.baseURL)
    this.#token = options.token
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!method) throw new Error('RPC method is required')
    const response = await fetch(new URL(`/api/rpc/${method}`, this.#origin), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(this.#nextId++),
        method,
        params: params ?? {},
      }),
    })
    const payload = (await response.json().catch(() => undefined)) as
      | { result?: unknown; error?: string | { code?: unknown; message?: unknown } }
      | undefined
    if (
      !payload ||
      typeof payload !== 'object' ||
      (!('result' in payload) && !('error' in payload))
    ) {
      throw new Error('invalid Mnie RPC response')
    }
    if (payload.error) {
      if (typeof payload.error === 'string') {
        throw rpcError(-32000, payload.error)
      }
      const { code, message } = payload.error
      throw rpcError(
        typeof code === 'number' ? code : -32000,
        typeof message === 'string' && message ? message : 'RPC request failed',
      )
    }
    if (!response.ok) {
      throw rpcError(-32000, `Mnie RPC request failed with HTTP ${response.status}`)
    }
    return payload.result
  }

  close() {}
}

const scopedProxy = (
  rpc: RpcTransport,
  selector: { account: string } | { profile: string },
  namespace: 'account' | 'profile',
  descriptor: ProviderDescriptor = { id: 'remote', name: 'Remote provider' },
): FinancialProvider<MethodMap> => {
  const selectorKey = namespace === 'account' ? 'account' : 'profile'
  const selectorValue =
    selectorKey === 'account'
      ? (selector as { account: string }).account
      : (selector as { profile: string }).profile
  return new Proxy({} as FinancialProvider<MethodMap>, {
    get(_target, property) {
      if (property === 'descriptor') return descriptor
      if (property === 'accountId') return selectorValue
      if (property === 'capabilities') {
        return () => rpc.call(`${namespace}.capabilities`, selector) as Promise<Capability[]>
      }
      if (property === 'methods') {
        return async () =>
          ((await rpc.call(`${namespace}.operations`, selector)) as string[]).map((name) =>
            name.startsWith(`${namespace}.`) ? name.slice(namespace.length + 1) : name,
          )
      }
      if (property === 'invoke')
        return (name: string, request: unknown) =>
          rpc.call(`${namespace}.${name}`, {
            ...(typeof request === 'object' && request !== null
              ? (request as Record<string, unknown>)
              : {}),
            [selectorKey]: selectorValue,
          })
      if (property === 'checkAvailability')
        return async () =>
          ((await rpc.call(`${namespace}.availability`, selector)) as ProviderAvailability)
            .connection as AvailabilityCheckResult
      if (property === 'checkMethodAvailability')
        return async (request: MethodAvailabilityRequest) => {
          const wireMethod = request.method.startsWith(`${namespace}.`)
            ? request.method
            : `${namespace}.${request.method}`
          const availability = (await rpc.call(`${namespace}.availability`, {
            ...selector,
            method: wireMethod,
            params: request.params ?? {},
          })) as ProviderAvailability
          const method = availability.methods[wireMethod]
          if (!method) throw new Error('method availability was not returned')
          return method as MethodAvailability
        }
      if (property === 'exportSession')
        return () => {
          throw new Error('remote sessions cannot be exported')
        }
      if (property === 'close') return () => {}
      return undefined
    },
  })
}

/** Opens a Mnie RPC connection and returns the remote client. */
export const connectMnie = async (options: ConnectMnieOptions): Promise<MnieClient> => {
  const rpc: RpcTransport =
    options.transport === 'rest' ? new RestRpcConnection(options) : new JsonRpcConnection(options)
  const call = (<Name extends MethodName<MnieMethods>>(
    method: Name,
    params?: MethodRequest<MnieMethods, Name>,
  ): Promise<MethodResponse<MnieMethods, Name>> =>
    rpc.call(method, params ?? {}) as Promise<
      MethodResponse<MnieMethods, Name>
    >) as MnieClient['call']
  const client: MnieClient = {
    methods: () => rpc.call('rpc.methods') as Promise<readonly string[]>,
    call,
    accounts: async () =>
      (
        (await rpc.call('portfolio.accounts.list', {})) as {
          accounts: PublicFinancialAccount[]
        }
      ).accounts,
    account: (accountId) => scopedProxy(rpc, { account: accountId }, 'account'),
    profile: (profileId) => scopedProxy(rpc, { profile: profileId }, 'profile'),
    connectProfile: (profileId) =>
      rpc.call('admin.profiles.connect', { profileId }) as Promise<ProfileConnection>,
    completeProfileConnection: (profileId, interactionId) =>
      rpc.call('admin.profiles.connection.complete', {
        profileId,
        interactionId,
      }) as Promise<ProfileConnection>,
    syncProfile: (profileId) =>
      rpc.call('admin.profiles.sync', { profileId }) as Promise<ProfileSyncResult>,
    close: () => rpc.close(),
  }
  try {
    await client.methods()
    return client
  } catch (cause) {
    client.close()
    throw cause
  }
}

export type * from '@mnie/types'
