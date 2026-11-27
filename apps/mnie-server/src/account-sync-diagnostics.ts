/** Return diagnostic metadata without persisting upstream response bodies or credentials. */
export function summarizeSyncFailure(cause: unknown): {
  reason: 'maintenance' | 'timeout' | 'authentication' | 'unknown'
  code?: string
} {
  const message = cause instanceof Error ? cause.message : String(cause)
  const code = message.match(/\bECOMN\d{4}\b/)?.[0]
  const reason = /ECOMN0004|メンテナンス|maintenance/i.test(message)
    ? 'maintenance'
    : /timed?\s*out|timeout|\bHTTP 504\b|abort/i.test(message)
      ? 'timeout'
      : /unauthori[sz]ed|authentication|login|ログイン|認証|\b(?:401|403)\b/i.test(message)
        ? 'authentication'
        : 'unknown'
  return { reason, ...(code ? { code } : {}) }
}
