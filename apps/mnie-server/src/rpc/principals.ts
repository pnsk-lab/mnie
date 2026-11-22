import type { AuthContext } from '../context'
import { closeOpenProvider, type RpcSocketState } from './handler'

const IDLE_TIMEOUT = 5 * 60_000

export interface RpcPrincipal {
  key: string
  state: RpcSocketState
  queue: Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
}

export const createRpcPrincipalStore = () => {
  const principals = new Map<string, RpcPrincipal>()

  const touch = (principal: RpcPrincipal) => {
    clearTimeout(principal.timer)
    principal.timer = setTimeout(() => {
      if (principals.get(principal.key) === principal) principals.delete(principal.key)
      void principal.queue
        .then(() => closeOpenProvider(principal.state))
        .catch(() => console.error('RPC principal cleanup failed'))
    }, IDLE_TIMEOUT)
    principal.timer.unref()
  }

  const entry = (auth: AuthContext) => {
    const state: RpcSocketState = {
      owner: auth.type === 'session',
      apiKeyId: auth.type === 'apiKey' ? auth.apiKeyId : undefined,
      scopes: auth.type === 'apiKey' ? auth.scopes : undefined,
    }
    const key = auth.type === 'session' ? `session:${auth.sessionId}` : `key:${state.apiKeyId}`
    let principal = principals.get(key)
    if (!principal) {
      principal = { key, state, queue: Promise.resolve() }
      principals.set(key, principal)
    }
    principal.state.scopes = state.scopes
    clearTimeout(principal.timer)
    return principal
  }

  const runQueued = <T>(principal: RpcPrincipal, task: () => Promise<T>) => {
    const run = principal.queue.then(async () => {
      try {
        return await task()
      } finally {
        touch(principal)
      }
    })
    principal.queue = run.catch(() => {})
    return run
  }

  const close = async () => {
    const entries = [...principals.values()]
    principals.clear()
    for (const principal of entries) {
      clearTimeout(principal.timer)
      await principal.queue
      await closeOpenProvider(principal.state)
    }
  }

  return { entry, runQueued, touch, close }
}
