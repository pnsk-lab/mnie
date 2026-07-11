import { createProvider as createSbiSecProvider } from '@mnie/provider-sbi-sec'
import type { MarketCode, SbiClientMethods } from '@mnie/provider-sbi-sec'
import {
  createProvider as createSmbcDirectProvider,
  loginWithPasskey as loginSmbcDirect,
  exportSession as exportSmbcDirectSession,
  type SmbcDirectLoginChallenge,
  type SmbcDirectProfile,
} from '@mnie/provider-smbc-direct'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import {
  assertAndConsumeApiKeyTradeLimits,
  assertApiKeyMethodAllowed,
} from '../security/trade-limits'
import { invokeSbiMethod, isRpcMethod, isTradingMethod } from './methods'
import { connectSbi } from './sbi-session'
import { accountProfiles } from '../db/schema'
import type { StoredSmbcDirectSecret } from '../routes/admin'
import { readSecret, saveSecret } from '../security/keyring'

interface JsonRpcRequest {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
}

interface RpcSocketState {
  client?: SbiClientMethods
  providerClient?: FinancialProvider<OperationMap>
  smbcProfile?: SmbcDirectProfile
  smbcChallenge?: SmbcDirectLoginChallenge
  provider?: 'sbisec' | 'smbc-direct'
  profileId?: string
  apiKeyId?: string
  scopes?: string[]
  boardPollingSubscriptions: Map<string, AbortController>
}

interface BoardPollingParams {
  issueCode: string
  market: MarketCode
  intervalSeconds?: number
}

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
  if (typeof value.market !== 'string' || !value.market) {
    throw new Error('market is required')
  }
  if (!['XTKS', 'XNAS', 'XNYS', 'ARCX'].includes(value.market)) {
    throw new Error('market must be XTKS, XNAS, XNYS, or ARCX')
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
    market: value.market as MarketCode,
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

const assertScope = (state: RpcSocketState, scope: 'read' | 'trade') => {
  if (!state.apiKeyId) return
  const scopes = state.scopes ?? ['read', 'write', 'trade', 'mcp']
  if (!scopes.includes(scope)) throw new Error(`missing OAuth scope: ${scope}`)
}

const subscribeBoardPolling = async (
  db: Db,
  state: RpcSocketState,
  ws: WSContext,
  request: JsonRpcRequest,
) => {
  if (!state.client) return error(request.id, 4001, 'SBI session is not connected')
  assertScope(state, 'read')

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
    return result(request.id, state.providerClient?.operations() ?? [])
  }

  if (request.method === 'provider.connect') {
    assertScope(state, 'read')
    const params =
      request.params && typeof request.params === 'object'
        ? (request.params as { provider?: string; profileId?: string })
        : undefined
    if (!params?.profileId) throw new Error('profileId is required')
    if (params.provider !== 'sbisec' && params.provider !== 'smbc-direct') {
      throw new Error('provider must be sbisec or smbc-direct')
    }
    const [profile] = await db
      .select()
      .from(accountProfiles)
      .where(eq(accountProfiles.id, params.profileId))
      .limit(1)
    if (!profile || profile.provider !== params.provider) throw new Error('profile not found')
    stopBoardPollingSubscriptions(state)
    state.client = undefined
    state.providerClient = undefined
    state.smbcProfile = undefined
    state.smbcChallenge = undefined
    state.provider = params.provider
    state.profileId = profile.id
    if (params.provider === 'sbisec') {
      state.client = await connectSbi(db, config, profile.id)
      state.providerClient = createSbiSecProvider(state.client) as FinancialProvider<OperationMap>
      return result(request.id, {
        connected: true,
        provider: params.provider,
        profileId: profile.id,
      })
    }
    if (!config.smbcDirectBaseUrl || !config.smbcDirectLoginBaseUrl) {
      throw new Error('SMBC_DIRECT_BASE_URL and SMBC_DIRECT_LOGIN_BASE_URL are required')
    }
    const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
    state.smbcChallenge = await loginSmbcDirect({
      user: secret.user,
      password: secret.password,
      accountItemCode: secret.accountItemCode,
      baseURL: config.smbcDirectBaseUrl,
      loginURL: config.smbcDirectLoginBaseUrl,
    })
    return result(request.id, {
      connected: false,
      provider: params.provider,
      profileId: profile.id,
      requires2fa: true,
      qrurl: state.smbcChallenge.qrurl,
      url: state.smbcChallenge.url,
    })
  }

  if (request.method === 'provider.finish2fa') {
    if (state.provider !== 'smbc-direct' || !state.smbcChallenge) {
      throw new Error('SMBC Direct two-factor authentication is not pending')
    }
    state.smbcProfile = await state.smbcChallenge.finished2fa()
    state.providerClient = createSmbcDirectProvider(
      state.smbcProfile,
    ) as FinancialProvider<OperationMap>
    state.smbcChallenge = undefined
    if (state.profileId) {
      const [profile] = await db
        .select()
        .from(accountProfiles)
        .where(eq(accountProfiles.id, state.profileId))
        .limit(1)
      if (!profile) throw new Error('profile not found')
      const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
      await saveSecret(profile.keyringAccount, {
        ...secret,
        session: exportSmbcDirectSession(state.smbcProfile),
      })
    }
    return result(request.id, { connected: true, provider: 'smbc-direct' })
  }

  if (
    state.providerClient &&
    typeof request.method === 'string' &&
    state.providerClient.operations().includes(request.method)
  ) {
    assertScope(state, request.method.includes('.create') ? 'trade' : 'read')
    return result(
      request.id,
      await state.providerClient.invoke(request.method, request.params ?? {}),
    )
  }

  if (request.method === 'account.balance') {
    assertScope(state, 'read')
    if (!state.smbcProfile) throw new Error('SMBC Direct session is not connected')
    return result(request.id, await state.smbcProfile.getBalance())
  }

  if (request.method === 'account.transactions') {
    assertScope(state, 'read')
    if (!state.smbcProfile) throw new Error('SMBC Direct session is not connected')
    const params = request.params as { startDate?: string; endDate?: string } | undefined
    if (!params?.startDate || !params.endDate) throw new Error('startDate and endDate are required')
    return result(
      request.id,
      await state.smbcProfile.getTransactions({
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    )
  }

  if (request.method === 'transfer.recipients') {
    assertScope(state, 'read')
    if (!state.smbcProfile) throw new Error('SMBC Direct session is not connected')
    return result(request.id, await state.smbcProfile.getTransferRecipients())
  }

  if (request.method === 'transfer.recipient') {
    assertScope(state, 'read')
    if (!state.smbcProfile) throw new Error('SMBC Direct session is not connected')
    const index =
      request.params && typeof request.params === 'object'
        ? (request.params as { index?: unknown }).index
        : undefined
    if (typeof index !== 'string' || !index) throw new Error('index is required')
    return result(request.id, await state.smbcProfile.getTransferRecipient(index))
  }

  if (request.method === 'transfer.estimateFee') {
    assertScope(state, 'read')
    if (!state.smbcProfile) throw new Error('SMBC Direct session is not connected')
    const params = request.params as { amount?: unknown } | undefined
    if (!params || typeof params.amount !== 'number') throw new Error('amount is required')
    return result(
      request.id,
      await state.smbcProfile.estimateTransferFee({ amount: params.amount }),
    )
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
  assertScope(state, isTradingMethod(request.method) ? 'trade' : 'read')

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
        scopes: auth.type === 'apiKey' ? auth.scopes : undefined,
        boardPollingSubscriptions: new Map(),
      }

      return {
        onOpen(_event, ws) {
          send(
            ws,
            result(null, {
              connected: true,
              methods: [
                'rpc.methods',
                'provider.connect',
                'provider.finish2fa',
                'account.balance',
                'account.transactions',
                'transfer.recipients',
                'transfer.recipient',
                'transfer.estimateFee',
              ],
            }),
          )
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
