import type {
  AvailabilityCheckResult,
  OperationAvailability,
  ProviderAvailability,
} from '@mnie/types'
import type { AccountProfile, ProviderRegistry } from './providers/registry'

export interface CachedAvailability {
  result: AvailabilityCheckResult
  operations: Record<string, OperationAvailability>
  checkedAt: Date
}

export const checkProfileAvailability = (
  providers: ProviderRegistry,
  profile: AccountProfile,
): Promise<ProviderAvailability> => providers.availability(profile)

export const listProfiles = (providers: ProviderRegistry) => providers.profiles()
