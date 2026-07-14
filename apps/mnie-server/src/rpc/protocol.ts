export interface JsonRpcRequest {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
}

export const rpcResult = (id: JsonRpcRequest['id'], value: unknown) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  result: value,
})

export const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code, message },
})

export const objectParams = (params: unknown): Record<string, unknown> => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {}
  return params as Record<string, unknown>
}
