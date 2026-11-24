import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import type { ProviderRegistry } from '../providers/registry'
import type { Db } from '../db'
import type { JsonRpcRequest } from './protocol'
import { rpcError, rpcResult } from './protocol'
import type { AdminRpcService } from './admin'
import {
  callerMethods,
  closeOpenProvider,
  handleRpc,
  usesSessionState,
  type RpcSocketState,
} from './handler'

const send = (ws: WSContext, payload: unknown) => ws.send(JSON.stringify(payload))

export const createRpcWebSocket = (db: Db, providers: ProviderRegistry, admin: AdminRpcService) => {
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
        scopes: auth.type === 'apiKey' ? auth.scopes : undefined,
        owner: auth.type === 'session',
      }
      let queue = Promise.resolve()
      return {
        onOpen(_event, ws) {
          send(ws, rpcResult(null, { connected: true, methods: callerMethods(state, db) }))
        },
        onMessage(event, ws) {
          const data = String(event.data)
          let request: JsonRpcRequest | undefined
          try {
            request = JSON.parse(data) as JsonRpcRequest
          } catch {}
          const task = async () => {
            try {
              send(ws, await handleRpc(db, providers, admin, state, request!))
            } catch (cause) {
              send(
                ws,
                rpcError(
                  request?.id,
                  -32603,
                  cause instanceof Error ? cause.message : 'internal error',
                ),
              )
            }
          }
          if (request && usesSessionState(String(request.method))) {
            queue = queue.then(task)
            return queue
          }
          return task()
        },
        async onClose() {
          await queue
          await closeOpenProvider(state)
        },
      }
    }),
  }
}
