export function methodGroups(methods: string[], prefix = '') {
  const next = new Map<string, string[]>()
  for (const method of methods) {
    if (prefix && !method.startsWith(`${prefix}.`)) continue
    const rest = prefix ? method.slice(prefix.length + 1) : method
    if (!rest) continue
    const segment = rest.split('.')[0]!
    const path = prefix ? `${prefix}.${segment}` : segment
    next.set(path, [...(next.get(path) ?? []), method])
  }
  return [...next]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, values]) => ({ path, methods: values }))
}
export function toggleMethods(selected: string[], methods: string[], enabled: boolean) {
  const result = new Set(selected)
  for (const method of methods) {
    if (enabled) result.add(method)
    else result.delete(method)
  }
  return [...result].sort()
}
