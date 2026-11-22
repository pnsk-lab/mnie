import type { HistoryItem, HistoryListRequest } from '@mnie/provider-mnie-server'
import { formatBeancount } from './beancount'

type CliOptions = Record<string, string | true>

interface ResolvedProfile {
  profile: { origin: string }
  apiKey: string
}

interface ExportClient {
  call(method: string, params?: any): Promise<any>
  close(): void | Promise<void>
}

interface ExportDependencies {
  resolveProfile(name?: string): Promise<ResolvedProfile>
  connect(options: { baseURL: string; token: string }): Promise<ExportClient>
  write(output: string): void
}

const stringOption = (options: CliOptions, name: string, required = false) => {
  const value = options[name]
  if (value === true) throw new Error(`--${name} requires a value`)
  if (required && value === undefined) throw new Error(`--${name} is required`)
  return value
}

const isoDate = (value: string, name: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`--${name} must be YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`--${name} must be a valid calendar date`)
  }
  return value
}

export const exportBeancount = async (options: CliOptions, dependencies: ExportDependencies) => {
  const from = isoDate(stringOption(options, 'from', true)!, 'from')
  const to = isoDate(stringOption(options, 'to', true)!, 'to')
  if (from > to) throw new Error('--from must not be after --to')
  const profileId = stringOption(options, 'account') ?? stringOption(options, 'profile-id')
  if (profileId !== undefined && !profileId.trim()) {
    throw new Error('--profile-id must not be empty')
  }
  const normalizedProfileId = profileId?.trim()
  const resolved = await dependencies.resolveProfile(stringOption(options, 'profile'))
  const client = await dependencies.connect({
    baseURL: resolved.profile.origin,
    token: resolved.apiKey,
  })
  try {
    const items: HistoryItem[] = []
    let cursor: string | undefined
    do {
      const page = await client.call('portfolio.history.list', {
        kinds: ['transaction'],
        from,
        to,
        ...(normalizedProfileId ? { profiles: [normalizedProfileId] } : {}),
        ...(cursor ? { cursor } : {}),
      } as HistoryListRequest & { profiles?: string[] })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    dependencies.write(formatBeancount(items))
  } finally {
    client.close()
  }
}
