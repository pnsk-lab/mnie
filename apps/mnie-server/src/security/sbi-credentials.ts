import type { StoredSbiPasskeySecret } from '../routes/admin'

const nonEmpty = (value: string | undefined) => value?.trim() || undefined

export const effectiveSbiDeviceId = (secret: StoredSbiPasskeySecret) =>
  nonEmpty(secret.deviceId) ?? nonEmpty(process.env.SBI_DEVICE_ID)

export const effectiveSbiTradePassword = (secret: StoredSbiPasskeySecret) =>
  nonEmpty(secret.tradePassword) ?? nonEmpty(process.env.SBI_TRADE_PASSWORD)

export const hasNonEmptySecretValue = (value: string | undefined) => Boolean(nonEmpty(value))
