const tails = new Map<string, Promise<void>>()

export const withProfileLock = async <T>(profileId: string, operation: () => Promise<T>) => {
  const previous = tails.get(profileId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  tails.set(profileId, tail)
  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
    if (tails.get(profileId) === tail) tails.delete(profileId)
  }
}
