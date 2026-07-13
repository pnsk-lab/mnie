import type {
  FinancialProvider,
  OperationAvailability,
  OperationAvailabilityRequest,
  OperationMap,
} from '@mnie/types'

export class ProviderOperationUnavailableError extends Error {
  constructor(
    readonly operation: string,
    readonly availability: Extract<OperationAvailability, { available: false }>,
  ) {
    super(
      typeof availability.message === 'string'
        ? availability.message
        : `provider operation is unavailable: ${availability.reason}`,
    )
    this.name = 'ProviderOperationUnavailableError'
  }
}

export const operationAvailability = async (
  provider: FinancialProvider<OperationMap>,
  request: OperationAvailabilityRequest,
): Promise<OperationAvailability> => {
  if (!provider.operations().includes(request.operation)) {
    return {
      available: false,
      reason: 'OPERATION_UNSUPPORTED',
      message: `provider does not advertise ${request.operation}`,
    }
  }
  if (!provider.checkOperationAvailability) return { available: true }
  const availability = await provider.checkOperationAvailability(request)
  if (availability.available || typeof availability.message === 'string') return availability
  return {
    ...availability,
    message:
      availability.message instanceof Error
        ? availability.message.message
        : String(availability.message),
  }
}

export const invokeAvailableOperation = async (
  provider: FinancialProvider<OperationMap>,
  operation: string,
  input: unknown,
) => {
  const availability = await operationAvailability(provider, { operation, input })
  if (!availability.available) {
    throw new ProviderOperationUnavailableError(operation, availability)
  }
  return provider.invoke(operation, input ?? {})
}
