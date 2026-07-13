export class PayPaySecError extends Error {
  readonly code: string

  constructor(message: string, code = 'PAYPAY_SEC_ERROR', options?: ErrorOptions) {
    super(message, options)
    this.name = 'PayPaySecError'
    this.code = code
  }
}

export class SessionLockedError extends PayPaySecError {
  constructor() {
    super('PayPay Securities session is locked and cannot be reused', 'SESSION_LOCKED')
    this.name = 'SessionLockedError'
  }
}

export class OrderOutcomeUnknownError extends PayPaySecError {
  readonly confirmationId: string

  constructor(confirmationId: string, options?: ErrorOptions) {
    super(
      'PayPay Securities order outcome is unknown; do not retry and check trade history',
      'ORDER_OUTCOME_UNKNOWN',
      options,
    )
    this.name = 'OrderOutcomeUnknownError'
    this.confirmationId = confirmationId
  }
}

export class UnsupportedPayPaySecOperationError extends PayPaySecError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_OPERATION')
    this.name = 'UnsupportedPayPaySecOperationError'
  }
}
