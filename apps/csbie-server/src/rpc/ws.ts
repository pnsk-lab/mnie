import type { SbiClientMethods } from '@repo/sbi-client'
import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import { randomUUID } from 'node:crypto'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import {
  assertAndConsumeApiKeyTradeLimits,
  assertApiKeyMethodAllowed,
} from '../security/trade-limits'
import { invokeSbiMethod, isRpcMethod, isTradingMethod, RPC_METHODS } from './methods'
import { connectSbi } from './sbi-session'

type JsonRpcRequest = {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
}

type RpcSocketState = {
  client?: SbiClientMethods
  sbiPasskeyId?: string
  apiKeyId?: string
  boardPollingSubscriptions: Map<string, AbortController>
}

type BoardPollingParams = {
  issueCode: string
  market?: string
  intervalSeconds?: number
}

const BOARD_POLLING_METHODS = [
  'market.issue.pollBoard.subscribe',
  'market.issue.pollBoard.unsubscribe',
] as const

const send = (ws: WSContext, payload: unknown) => {
  ws.send(JSON.stringify(payload))
}

const result = (id: JsonRpcRequest['id'], value: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result: value,
})

const error = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})

const notification = (method: string, params: unknown) => ({
  jsonrpc: '2.0',
  method,
  params,
})

const parseBoardPollingParams = (params: unknown): BoardPollingParams => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('pollBoard params are required')
  }

  const value = params as Record<string, unknown>
  if (typeof value.issueCode !== 'string' || !value.issueCode) {
    throw new Error('issueCode is required')
  }
  if (value.market != null && typeof value.market !== 'string') {
    throw new Error('market must be a string')
  }
  if (
    value.intervalSeconds != null &&
    (typeof value.intervalSeconds !== 'number' ||
      !Number.isFinite(value.intervalSeconds) ||
      value.intervalSeconds <= 0)
  ) {
    throw new Error('intervalSeconds must be a positive finite number')
  }

  return {
    issueCode: value.issueCode,
    market: typeof value.market === 'string' ? value.market : undefined,
    intervalSeconds: typeof value.intervalSeconds === 'number' ? value.intervalSeconds : undefined,
  }
}

const stopBoardPollingSubscription = (state: RpcSocketState, subscriptionId: string) => {
  const controller = state.boardPollingSubscriptions.get(subscriptionId)
  if (!controller) return false
  state.boardPollingSubscriptions.delete(subscriptionId)
  controller.abort(new Error('market issue board polling unsubscribed'))
  return true
}

const stopBoardPollingSubscriptions = (state: RpcSocketState) => {
  for (const subscriptionId of state.boardPollingSubscriptions.keys()) {
    stopBoardPollingSubscription(state, subscriptionId)
  }
}

const subscribeBoardPolling = async (
  db: Db,
  state: RpcSocketState,
  ws: WSContext,
  request: JsonRpcRequest,
) => {
  if (!state.client) return error(request.id, 4001, 'SBI session is not connected')

  if (state.apiKeyId) {
    await assertApiKeyMethodAllowed(db, state.apiKeyId, 'market.issue.board')
  }

  const params = parseBoardPollingParams(request.params)
  const subscriptionId = randomUUID()
  const controller = new AbortController()
  state.boardPollingSubscriptions.set(subscriptionId, controller)

  void (async () => {
    try {
      for await (const board of state.client!.market.issue.pollBoard({
        ...params,
        signal: controller.signal,
      })) {
        if (!state.boardPollingSubscriptions.has(subscriptionId)) return
        send(ws, notification('market.issue.pollBoard.update', { subscriptionId, board }))
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        send(
          ws,
          notification('market.issue.pollBoard.error', {
            subscriptionId,
            message: cause instanceof Error ? cause.message : 'pollBoard failed',
          }),
        )
      }
    } finally {
      state.boardPollingSubscriptions.delete(subscriptionId)
    }
  })()

  return result(request.id, { subscriptionId })
}

const handleRpc = async (
  db: Db,
  config: ServerConfig,
  state: RpcSocketState,
  ws: WSContext,
  request: JsonRpcRequest,
) => {
  if (request.method === 'rpc.methods') {
    return result(request.id, [...RPC_METHODS, ...BOARD_POLLING_METHODS])
  }

  if (request.method === 'sbi.connect') {
    const passkeyId =
      request.params && typeof request.params === 'object'
        ? (request.params as { passkeyId?: string }).passkeyId
        : undefined
    if (!passkeyId) throw new Error('passkeyId is required')
    stopBoardPollingSubscriptions(state)
    state.client = await connectSbi(db, config, passkeyId)
    state.sbiPasskeyId = passkeyId
    return result(request.id, { connected: true, passkeyId })
  }

  if (request.method === 'market.issue.pollBoard.subscribe') {
    return subscribeBoardPolling(db, state, ws, request)
  }

  if (request.method === 'market.issue.pollBoard.unsubscribe') {
    const subscriptionId =
      request.params && typeof request.params === 'object'
        ? (request.params as { subscriptionId?: string }).subscriptionId
        : undefined
    if (!subscriptionId) throw new Error('subscriptionId is required')
    return result(request.id, {
      unsubscribed: stopBoardPollingSubscription(state, subscriptionId),
    })
  }

  if (!request.method || !isRpcMethod(request.method)) {
    return error(request.id, -32601, 'method not found')
  }

  if (!state.client) return error(request.id, 4001, 'SBI session is not connected')

  if (state.apiKeyId) {
    await assertApiKeyMethodAllowed(db, state.apiKeyId, request.method)
  }

  if (isTradingMethod(request.method)) {
    const params = request.params as { allowTrading?: boolean } | undefined
    if (!params?.allowTrading)
      return error(request.id, 4002, 'trading methods require allowTrading')
    if (state.apiKeyId) {
      await assertAndConsumeApiKeyTradeLimits({
        db,
        apiKeyId: state.apiKeyId,
        params: request.params,
      })
    }
  }

  return result(request.id, await invokeSbiMethod(state.client, request.method, request.params))
}

export const createRpcWebSocket = (db: Db, config: ServerConfig) => {
  const { upgradeWebSocket, websocket } = createBunWebSocket()

  return {
    websocket,
    upgradeWebSocket: upgradeWebSocket(async (c) => {
      if (!c.get('authenticated')) {
        return {
          onOpen(_event, ws) {
            ws.close(1008, 'unauthorized')
          },
        }
      }

      const auth = c.get('auth')
      const state: RpcSocketState = {
        apiKeyId: auth.type === 'apiKey' ? auth.apiKeyId : undefined,
        boardPollingSubscriptions: new Map(),
      }

      return {
        onOpen(_event, ws) {
          send(ws, result(null, { connected: true, methods: ['rpc.methods', 'sbi.connect'] }))
        },
        async onMessage(event, ws) {
          let request: JsonRpcRequest | undefined
          try {
            request = JSON.parse(String(event.data)) as JsonRpcRequest
            send(ws, await handleRpc(db, config, state, ws, request))
          } catch (cause) {
            send(
              ws,
              error(request?.id, -32603, cause instanceof Error ? cause.message : 'internal error'),
            )
          }
        },
        onClose() {
          stopBoardPollingSubscriptions(state)
        },
      }
    }),
  }
}
