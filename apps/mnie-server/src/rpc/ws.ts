import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import { eq } from 'drizzle-orm'
import {
  createProvider as createSmbcDirectProvider,
  loginWithPasskey as loginSmbcDirect,
  type SmbcDirectLoginChallenge,
} from '@mnie/provider-smbc-direct'
import type { FinancialProvider, OperationMap } from '@mnie/types'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { accountProfiles } from '../db/schema'
import type { StoredSmbcDirectSecret } from '../routes/admin'
import { readSecret, saveSecret } from '../security/keyring'
import { assertApiKeyMethodAllowed } from '../security/trade-limits'
import { connectSbi } from './sbi-session'
import { fetchAssetValuation } from '../assets'

interface JsonRpcRequest {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
}

interface RpcSocketState {
  providerClient?: FinancialProvider<OperationMap>
  smbcChallenge?: SmbcDirectLoginChallenge
  provider?: string
  profileId?: string
  apiKeyId?: string
  scopes?: string[]
}

const CONTROL_METHODS = [
  'rpc.methods',
  'provider.capabilities',
  'provider.connect',
  'provider.finish2fa',
] as const

const send = (ws: WSContext, payload: unknown) => ws.send(JSON.stringify(payload))

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

const assertReadScope = (state: RpcSocketState) => {
  if (!state.apiKeyId) return
  const scopes = state.scopes ?? []
  if (!scopes.includes('read')) throw new Error('missing OAuth scope: read')
}

const isTransactionOperation = (operation: string) =>
  operation.endsWith('.create') || operation.endsWith('.send')

const assertOperationScope = (state: RpcSocketState, operation: string) => {
  if (!state.apiKeyId) return
  const scopes = state.scopes ?? []
  const required = isTransactionOperation(operation) ? 'trade' : 'read'
  if (!scopes.includes(required)) throw new Error(`missing OAuth scope: ${required}`)
}

const connectProvider = async (
  db: Db,
  config: ServerConfig,
  state: RpcSocketState,
  params: { provider?: string; profileId?: string },
) => {
  if (!params.profileId) throw new Error('profileId is required')
  if (!params.provider) throw new Error('provider is required')
  const [profile] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, params.profileId))
    .limit(1)
  if (!profile || profile.provider !== params.provider) throw new Error('profile not found')

  state.providerClient = undefined
  state.smbcChallenge = undefined
  state.provider = profile.provider
  state.profileId = profile.id

  if (profile.provider === 'sbisec') {
    state.providerClient = await connectSbi(db, config, profile.id)
    return { connected: true, provider: profile.provider, profileId: profile.id }
  }
  if (profile.provider === 'smbc-direct') {
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
    return {
      connected: false,
      provider: profile.provider,
      profileId: profile.id,
      requires2fa: true,
      qrurl: state.smbcChallenge.qrurl,
      url: state.smbcChallenge.url,
    }
  }
  throw new Error(`provider is not connected by this server: ${profile.provider}`)
}

const finishSmbc2fa = async (db: Db, state: RpcSocketState) => {
  if (state.provider !== 'smbc-direct' || !state.smbcChallenge || !state.profileId) {
    throw new Error('SMBC Direct two-factor authentication is not pending')
  }
  const profile = await state.smbcChallenge.finished2fa()
  state.providerClient = createSmbcDirectProvider(profile) as FinancialProvider<OperationMap>
  state.smbcChallenge = undefined
  const [row] = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, state.profileId))
    .limit(1)
  if (!row) throw new Error('profile not found')
  const secret = await readSecret<StoredSmbcDirectSecret>(row.keyringAccount)
  await saveSecret(row.keyringAccount, {
    ...secret,
    session: await state.providerClient.exportSession(),
  })
  return { connected: true, provider: 'smbc-direct', profileId: state.profileId }
}

const handleRpc = async (
  db: Db,
  config: ServerConfig,
  state: RpcSocketState,
  request: JsonRpcRequest,
) => {
  if (request.method === 'workspace.operations') {
    return result(request.id, ['profiles.list', 'portfolio.valuation.get'])
  }
  if (request.method === 'workspace.invoke') {
    assertReadScope(state)
    const params = request.params as { operation?: string; input?: Record<string, unknown> }
    if (params.operation === 'profiles.list') {
      const profiles = await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
      return result(
        request.id,
        profiles.map((profile) => ({
          id: profile.id,
          provider: { id: profile.provider, name: profile.provider },
          label: profile.label,
        })),
      )
    }
    if (params.operation === 'portfolio.valuation.get') {
      const baseCurrency = String(params.input?.baseCurrency ?? 'JPY')
      const requested = Array.isArray(params.input?.profileIds)
        ? new Set(params.input.profileIds.map(String))
        : undefined
      const profiles = (
        await db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
      ).filter((profile) => !requested || requested.has(profile.id))
      const settled = await Promise.allSettled(
        profiles.map(async (profile) => ({
          profile,
          valuation: await fetchAssetValuation(db, config, profile),
        })),
      )
      const components = settled.flatMap((item) =>
        item.status === 'fulfilled'
          ? [
              {
                profileId: item.value.profile.id,
                providerId: item.value.profile.provider,
                label: item.value.profile.label,
                originalAmount: {
                  currency: item.value.valuation.currency,
                  value: String(item.value.valuation.value),
                },
                convertedAmount: {
                  currency: item.value.valuation.currency,
                  value: String(item.value.valuation.value),
                },
                asOf: new Date().toISOString(),
              },
            ]
          : [],
      )
      if (components.some((component) => component.originalAmount.currency !== baseCurrency)) {
        throw new Error('portfolio valuation requires an explicit currency conversion provider')
      }
      const errors = settled.flatMap((item, index) =>
        item.status === 'rejected'
          ? [
              {
                profileId: profiles[index]!.id,
                message: item.reason instanceof Error ? item.reason.message : String(item.reason),
              },
            ]
          : [],
      )
      return result(request.id, {
        baseCurrency,
        total: {
          currency: baseCurrency,
          value: String(
            components.reduce((sum, item) => sum + Number(item.convertedAmount.value), 0),
          ),
        },
        asOf: new Date().toISOString(),
        completeness: errors.length ? 'partial' : 'complete',
        components,
        errors,
      })
    }
    return error(request.id, -32601, 'workspace operation not found')
  }
  if (
    request.method === 'profile.operations' ||
    request.method === 'profile.capabilities' ||
    request.method === 'profile.availability' ||
    request.method === 'profile.invoke'
  ) {
    const params = request.params as { profileId?: string; operation?: string; input?: unknown }
    if (!params.profileId) throw new Error('profileId is required')
    if (!state.providerClient || state.profileId !== params.profileId) {
      const [profile] = await db
        .select()
        .from(accountProfiles)
        .where(eq(accountProfiles.id, params.profileId))
        .limit(1)
      if (!profile) throw new Error('profile not found')
      if (profile.provider !== 'sbisec')
        throw new Error(`${profile.provider} requires an authenticated profile session`)
      state.providerClient = await connectSbi(db, config, profile.id)
      state.profileId = profile.id
      state.provider = profile.provider
    }
    if (request.method === 'profile.operations')
      return result(request.id, state.providerClient.operations())
    if (request.method === 'profile.capabilities')
      return result(request.id, state.providerClient.capabilities())
    if (request.method === 'profile.availability')
      return result(request.id, await state.providerClient.checkAvailability())
    if (!params.operation || !state.providerClient.operations().includes(params.operation))
      return error(request.id, -32601, 'profile operation not found')
    assertOperationScope(state, params.operation)
    return result(
      request.id,
      await state.providerClient.invoke(params.operation, params.input ?? {}),
    )
  }
  if (request.method === 'rpc.methods') {
    return result(request.id, state.providerClient?.operations() ?? [])
  }
  if (request.method === 'provider.capabilities') {
    return result(request.id, state.providerClient?.capabilities() ?? [])
  }
  if (request.method === 'provider.connect') {
    assertReadScope(state)
    const params =
      request.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? (request.params as { provider?: string; profileId?: string })
        : {}
    return result(request.id, await connectProvider(db, config, state, params))
  }
  if (request.method === 'provider.finish2fa') {
    assertReadScope(state)
    return result(request.id, await finishSmbc2fa(db, state))
  }
  if (
    !request.method ||
    CONTROL_METHODS.includes(request.method as (typeof CONTROL_METHODS)[number])
  ) {
    return error(request.id, -32601, 'method not found')
  }
  if (!state.providerClient) return error(request.id, 4001, 'provider is not connected')
  if (!state.providerClient.operations().includes(request.method)) {
    return error(request.id, -32601, 'method not found')
  }
  assertOperationScope(state, request.method)
  if (state.apiKeyId) await assertApiKeyMethodAllowed(db, state.apiKeyId, request.method)
  return result(request.id, await state.providerClient.invoke(request.method, request.params ?? {}))
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
      }
      return {
        onOpen(_event, ws) {
          send(ws, result(null, { connected: true, methods: CONTROL_METHODS }))
        },
        async onMessage(event, ws) {
          let request: JsonRpcRequest | undefined
          try {
            request = JSON.parse(String(event.data)) as JsonRpcRequest
            send(ws, await handleRpc(db, config, state, request))
          } catch (cause) {
            send(
              ws,
              error(request?.id, -32603, cause instanceof Error ? cause.message : 'internal error'),
            )
          }
        },
      }
    }),
  }
}
