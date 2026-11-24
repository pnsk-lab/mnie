import type { ProviderRegistry } from '../providers/registry'
import type { Db } from '../db'
import { FinancialAccountService } from '../financial-account-service'
import { ProfileRpcService } from '../profile-service'
import type { JsonRpcRequest } from './protocol'
import { objectParams, rpcError, rpcResult } from './protocol'
import { assertPortfolioScope, invokePortfolio, PORTFOLIO_METHODS } from './portfolio'
import type { AdminRpcService } from './admin'
import { STATIC_METHODS } from './methods'
import { apiKeys } from '../db/schema'
import { eq } from 'drizzle-orm'
import { assertAdminAccountScope } from '../security/admin-account-scope'

export interface RpcSocketState {
  service?: FinancialAccountService
  profileService?: ProfileRpcService
  apiKeyId?: string
  scopes?: string[]
  owner: boolean
}

export { STATIC_METHODS }
export const RPC_METHODS = STATIC_METHODS

export const callerMethods = (state: RpcSocketState, db?: Db): readonly string[] => {
  if (state.owner) return STATIC_METHODS
  const methods = (STATIC_METHODS as readonly string[]).filter(
    (method) => !method.startsWith('admin.'),
  )
  if (!db || !state.apiKeyId) return methods
  const key = db.select().from(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).get()
  if (key && !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date()) && key.allowedMethods)
    methods.push(
      ...STATIC_METHODS.filter(
        (method) => method.startsWith('admin.') && key.allowedMethods!.includes(method),
      ),
    )
  return methods
}

const SESSION_METHODS = new Set([
  'admin.profiles.connect',
  'admin.profiles.connection.complete',
  'admin.profiles.sync',
])
export const usesSessionState = (method: string) =>
  method.startsWith('account.') || method.startsWith('profile.') || SESSION_METHODS.has(method)

const assertReadScope = (state: RpcSocketState) => {
  if (state.apiKeyId && !(state.scopes ?? []).includes('read')) {
    throw new Error('missing OAuth scope: read')
  }
}

export const tradeLimitParams = (
  input: unknown,
  transactionAmount?: { currency: string; value: string },
) => {
  const params = objectParams(input)
  return transactionAmount ? { ...params, amount: transactionAmount } : params
}

export const closeOpenProvider = async (state: RpcSocketState) => {
  await state.service?.close()
  state.service = undefined
  await state.profileService?.close()
  state.profileService = undefined
}

export const handleRpc = async (
  db: Db,
  providers: ProviderRegistry,
  admin: AdminRpcService,
  state: RpcSocketState,
  request: JsonRpcRequest,
) => {
  if (request.method === 'rpc.methods') return rpcResult(request.id, callerMethods(state, db))

  if (typeof request.method === 'string' && request.method.startsWith('admin.')) {
    if (!state.owner) {
      const key =
        state.apiKeyId && db.select().from(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).get()
      if (
        !key ||
        key.revokedAt ||
        (key.expiresAt && key.expiresAt <= new Date()) ||
        !key.allowedMethods?.includes(request.method)
      )
        throw new Error('owner session is required')
      assertAdminAccountScope(db, key.id, request.method, objectParams(request.params))
    }
    const operation = request.method.slice('admin.'.length)
    if (
      operation === 'profiles.connect' ||
      operation === 'profiles.connection.complete' ||
      operation === 'profiles.sync'
    ) {
      state.service ??= new FinancialAccountService(db, providers)
      return rpcResult(
        request.id,
        await state.service.dispatch(request.method, objectParams(request.params), {
          ...state,
          adminAuthorized: true,
        }),
      )
    }
    try {
      return rpcResult(request.id, await admin.invoke(operation, objectParams(request.params)))
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('admin operation not found')) {
        return rpcError(request.id, -32601, cause.message)
      }
      throw cause
    }
  }

  if (typeof request.method === 'string' && request.method.startsWith('portfolio.')) {
    assertPortfolioScope(state, request.method)
    if (!(PORTFOLIO_METHODS as readonly string[]).includes(request.method)) {
      return rpcError(request.id, -32601, 'method not found')
    }
    try {
      return rpcResult(
        request.id,
        await invokePortfolio(db, providers, request.method, objectParams(request.params), {
          owner: state.owner,
          apiKeyId: state.apiKeyId,
        }),
      )
    } catch (cause) {
      if (cause instanceof Error && cause.message.endsWith('method not found')) {
        return rpcError(request.id, -32601, cause.message)
      }
      throw cause
    }
  }

  if (typeof request.method === 'string' && request.method.startsWith('account.')) {
    assertReadScope(state)
    state.service ??= new FinancialAccountService(db, providers)
    try {
      return rpcResult(
        request.id,
        await state.service.dispatch(request.method, objectParams(request.params), state),
      )
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'account method not found') {
        return rpcError(request.id, -32601, cause.message)
      }
      throw cause
    }
  }

  if (typeof request.method === 'string' && request.method.startsWith('profile.')) {
    assertReadScope(state)
    state.profileService ??= new ProfileRpcService(db, providers)
    try {
      return rpcResult(
        request.id,
        await state.profileService.dispatch(request.method, objectParams(request.params), state),
      )
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'profile method not found') {
        return rpcError(request.id, -32601, cause.message)
      }
      throw cause
    }
  }

  return rpcError(request.id, -32601, 'method not found')
}
