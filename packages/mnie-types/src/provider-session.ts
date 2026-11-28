import type { CommonMethods, FinancialProvider } from './financial'

interface OpenSession {
  provider: FinancialProvider<CommonMethods>
  persist(): Promise<void>
}

/** Serialize updates to one stored provider session, including its read and write. */
export const createProviderSessionManager = (providerId: string) => {
  const tails = new Map<string, Promise<void>>()

  const run = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key)
    const started = performance.now()
    const requestId = previous ? crypto.randomUUID() : undefined
    const log = (stage: 'waiting' | 'acquired') => {
      if (!requestId) return
      console.info(
        JSON.stringify({
          event: 'provider_session_lock',
          provider: providerId,
          requestId,
          stage,
          elapsedMs: Math.round(performance.now() - started),
        }),
      )
    }
    log('waiting')
    const result = (previous ?? Promise.resolve()).then(() => {
      log('acquired')
      return operation()
    })
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    tails.set(key, tail)
    try {
      return await result
    } finally {
      if (tails.get(key) === tail) tails.delete(key)
    }
  }

  const bind = (
    key: string,
    provider: OpenSession['provider'],
    load: () => Promise<OpenSession>,
  ): OpenSession['provider'] => {
    const use = <T>(operation: (active: OpenSession['provider']) => Promise<T> | T) =>
      run(key, async () => {
        const { provider: active, persist } = await load()
        const result = await operation(active)
        await persist()
        return result
      })

    return {
      ...provider,
      checkAvailability: () => use((active) => active.checkAvailability()),
      invoke: (name, request) =>
        // The account list in these bank providers comes from local profile metadata.
        name === 'accounts.list'
          ? provider.invoke(name, request)
          : use((active) => active.invoke(name, request)),
      close: () => use((active) => active.close()),
    }
  }

  return { run, bind }
}
