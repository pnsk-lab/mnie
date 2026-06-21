import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomId = (prefix: string) => `${prefix}_${randomBytes(18).toString('base64url')}`

export const randomToken = () => randomBytes(32).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
