import type { OpenProvider, ProviderRegistry } from '../providers/registry'
import type { Db } from '../db'
import {
  assertAndConsumeApiKeyTradeLimits,
  assertApiKeyMethodAllowed,
  isTransactionOperation,
} from '../security/trade-limits'
import type { JsonRpcRequest } from './protocol'
import { objectParams, rpcError, rpcResult } from './protocol'
import { invokeWorkspace, WORKSPACE_OPERATIONS } from './workspace'
import type { AdminRpcService } from './admin'
import { ADMIN_OPERATIONS } from './admin-operations'
import { operationAvailability, ProviderOperationUnavailableError } from '../providers/operations'

export interface RpcSocketState {
  open?: OpenProvider
  apiKeyId?: string
  scopes?: string[]
  owner: boolean
}

export const RPC_METHODS = [
  'rpc.methods',
  'admin.operations',
  'admin.invoke',
  'profile.operations',
  'profile.capabilities',
  'profile.availability',
  'profile.connect',
  'profile.connection.complete',
  'profile.invoke',
  'workspace.operations',
  'workspace.invoke',
] as const

const assertReadScope = (state: RpcSocketState) => {
  if (state.apiKeyId && !(state.scopes ?? []).includes('read')) {
    throw new Error('missing OAuth scope: read')
  }
}

const assertOperationScope = (state: RpcSocketState, operation: string, input?: unknown) => {
  if (!state.apiKeyId) return
  const required = isTransactionOperation(operation, input) ? 'trade' : 'read'
  if (!(state.scopes ?? []).includes(required)) throw new Error(`missing OAuth scope: ${required}`)
}

export const tradeLimitParams = (
  input: unknown,
  transactionAmount?: { currency: string; value: string },
) => {
  const params = objectParams(input)
  return transactionAmount ? { ...params, amount: transactionAmount } : params
}

export const closeOpenProvider = async (state: RpcSocketState) => {
  const open = state.open
  state.open = undefined
  if (!open) return
  try {
    await open.persist()
  } finally {
    await open.release()
  }
}

const profileProvider = async (
  providers: ProviderRegistry,
  state: RpcSocketState,
  profileId: string,
) => {
  if (state.open?.profile.id === profileId) return state.open.provider
  await closeOpenProvider(state)
  state.open = await providers.open(profileId)
  return state.open.provider
}

export const handleRpc = async (
  db: Db,
  providers: ProviderRegistry,
  admin: AdminRpcService,
  state: RpcSocketState,
  request: JsonRpcRequest,
) => {
  if (request.method === 'rpc.methods') return rpcResult(request.id, RPC_METHODS)

  if (request.method === 'admin.operations') {
    if (!state.owner) throw new Error('owner session is required')
    return rpcResult(request.id, ADMIN_OPERATIONS)
  }

  if (request.method === 'admin.invoke') {
    if (!state.owner) throw new Error('owner session is required')
    const params = objectParams(request.params)
    const operation = String(params.operation ?? '')
    if (!ADMIN_OPERATIONS.includes(operation as (typeof ADMIN_OPERATIONS)[number])) {
      return rpcError(request.id, -32601, 'admin operation not found')
    }
    return rpcResult(request.id, await admin.invoke(operation, objectParams(params.input)))
  }

  if (request.method === 'workspace.operations') {
    assertReadScope(state)
    return rpcResult(request.id, WORKSPACE_OPERATIONS)
  }

  if (request.method === 'workspace.invoke') {
    assertReadScope(state)
    const params = objectParams(request.params)
    const operation = String(params.operation ?? '')
    if (!WORKSPACE_OPERATIONS.includes(operation as (typeof WORKSPACE_OPERATIONS)[number])) {
      return rpcError(request.id, -32601, 'workspace operation not found')
    }
    return rpcResult(
      request.id,
      await invokeWorkspace(db, providers, operation, objectParams(params.input)),
    )
  }

  if (request.method === 'profile.connect') {
    assertReadScope(state)
    const profileId = String(objectParams(request.params).profileId ?? '')
    if (!profileId) throw new Error('profileId is required')
    await closeOpenProvider(state)
    const connected = await providers.connect(profileId)
    state.open = connected.open
    return rpcResult(request.id, connected.connection)
  }

  if (request.method === 'profile.connection.complete') {
    assertReadScope(state)
    const params = objectParams(request.params)
    const profileId = String(params.profileId ?? '')
    const interactionId = String(params.interactionId ?? '')
    if (!profileId || !interactionId) throw new Error('profileId and interactionId are required')
    await closeOpenProvider(state)
    const connected = await providers.completeConnection(profileId, interactionId)
    state.open = connected.open
    return rpcResult(request.id, connected.connection)
  }

  if (
    request.method === 'profile.operations' ||
    request.method === 'profile.capabilities' ||
    request.method === 'profile.availability' ||
    request.method === 'profile.invoke'
  ) {
    const params = objectParams(request.params)
    const profileId = String(params.profileId ?? '')
    if (!profileId) throw new Error('profileId is required')
    assertReadScope(state)

    if (request.method === 'profile.availability') {
      const availabilityRequest =
        typeof params.operation === 'string'
          ? { operation: params.operation, input: params.input }
          : undefined
      if (state.open?.profile.id === profileId) {
        return rpcResult(
          request.id,
          await providers.availabilityForProvider(state.open.provider, availabilityRequest),
        )
      }
      return rpcResult(request.id, await providers.availability(profileId, availabilityRequest))
    }

    const provider = await profileProvider(providers, state, profileId)
    if (request.method === 'profile.operations') return rpcResult(request.id, provider.operations())
    if (request.method === 'profile.capabilities') {
      return rpcResult(request.id, provider.capabilities())
    }

    const operation = String(params.operation ?? '')
    if (!operation || !provider.operations().includes(operation)) {
      return rpcError(request.id, -32601, 'profile operation not found')
    }
    assertOperationScope(state, operation, params.input)
    if (state.apiKeyId) {
      await assertApiKeyMethodAllowed(db, state.apiKeyId, operation)
    }
    const availability = await operationAvailability(provider, {
      operation,
      input: params.input,
    })
    if (!availability.available) {
      throw new ProviderOperationUnavailableError(operation, availability)
    }
    if (state.apiKeyId) {
      if (isTransactionOperation(operation, params.input)) {
        await assertAndConsumeApiKeyTradeLimits({
          db,
          apiKeyId: state.apiKeyId,
          params: tradeLimitParams(params.input, availability.transactionAmount),
        })
      }
    }
    return rpcResult(request.id, await provider.invoke(operation, params.input ?? {}))
  }

  return rpcError(request.id, -32601, 'method not found')
}
