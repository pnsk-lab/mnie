import type {
  FinancialProvider,
  MethodAvailability,
  MethodAvailabilityRequest,
  MethodMap,
} from '@mnie/types'

export class ProviderMethodUnavailableError extends Error {
  constructor(
    readonly method: string,
    readonly availability: Extract<MethodAvailability, { available: false }>,
  ) {
    super(
      typeof availability.message === 'string'
        ? availability.message
        : `provider method is unavailable: ${availability.reason}`,
    )
    this.name = 'ProviderMethodUnavailableError'
  }
}

export const methodAvailability = async (
  provider: FinancialProvider<MethodMap>,
  request: MethodAvailabilityRequest,
): Promise<MethodAvailability> => {
  if (!provider.methods().includes(request.method)) {
    return {
      available: false,
      reason: 'OPERATION_UNSUPPORTED',
      message: `provider does not advertise ${request.method}`,
    }
  }
  if (!provider.checkMethodAvailability) return { available: true }
  const availability = await provider.checkMethodAvailability(request)
  if (availability.available || typeof availability.message === 'string') return availability
  return {
    ...availability,
    message:
      availability.message instanceof Error
        ? availability.message.message
        : String(availability.message),
  }
}

export const invokeAvailableMethod = async (
  provider: FinancialProvider<MethodMap>,
  method: string,
  input: unknown,
) => {
  const availability = await methodAvailability(provider, { method, params: input })
  if (!availability.available) {
    throw new ProviderMethodUnavailableError(method, availability)
  }
  return provider.invoke(method, input ?? {})
}
