import { Hono } from 'hono'
import type { AppBindings } from '../context'
import type { Db } from '../db'
import type { ProviderRegistry } from '../providers/registry'
import type { AdminRpcService } from './admin'
import { handleRpc, usesSessionState } from './handler'
import { STATIC_METHODS } from './methods'
import { createRpcPrincipalStore } from './principals'
import type { JsonRpcRequest } from './protocol'
import { rpcError } from './protocol'

const isDynamicMethod = (method: string) =>
  method.startsWith('account.') || method.startsWith('profile.')

export const createRestRpcRoutes = (
  db: Db,
  providers: ProviderRegistry,
  admin: AdminRpcService,
) => {
  const app = new Hono<AppBindings>()
  const store = createRpcPrincipalStore()
  app.post('/:method', async (c) => {
    const site = c.req.header('Sec-Fetch-Site')
    if (site === 'same-site' || site === 'cross-site') {
      return c.json({ error: 'invalid origin' }, 403)
    }
    const config = c.get('config')
    const origin = c.req.header('Origin')
    if (origin && site !== 'same-origin' && site !== 'none') {
      let allowed = origin === config.origin || origin === config.corsOrigin
      if (!allowed) {
        try {
          allowed = new URL(origin).host === new URL(c.req.url).host
        } catch {
          allowed = false
        }
      }
      if (!allowed) return c.json({ error: 'invalid origin' }, 403)
    }
    const auth = c.get('auth')
    if (!auth.authenticated) return c.json({ error: 'unauthorized' }, 401)
    const method = c.req.param('method')
    if (!(STATIC_METHODS as readonly string[]).includes(method) && !isDynamicMethod(method)) {
      return c.json(rpcError(null, -32601, 'method not found'), 404)
    }
    let request: JsonRpcRequest
    try {
      request = JSON.parse(await c.req.text()) as JsonRpcRequest
    } catch {
      return c.json(rpcError(null, -32700, 'parse error'), 400)
    }
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      request.jsonrpc !== '2.0' ||
      request.method !== method
    ) {
      return c.json(rpcError(null, -32600, 'invalid request'), 400)
    }
    const id = request.id ?? null
    if (
      request.params !== undefined &&
      (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))
    ) {
      return c.json(rpcError(id, -32602, 'invalid params'), 400)
    }
    const entry = store.entry(auth)
    store.touch(entry)
    const task = async () => {
      try {
        return await handleRpc(db, providers, admin, entry.state, {
          id,
          method,
          params: request.params ?? {},
        })
      } catch (cause) {
        return rpcError(id, -32603, cause instanceof Error ? cause.message : 'internal error')
      }
    }
    const result = usesSessionState(method) ? await store.runQueued(entry, task) : await task()
    return c.json(result, 200)
  })
  return Object.assign(app, { closeRest: store.close })
}
