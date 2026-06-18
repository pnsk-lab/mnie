import { sha256, safeEqual } from './crypto'

export const verifySetupPassword = (password: string) => {
  const hash = process.env.CSBIE_SETUP_PASSWORD_HASH
  if (hash) return safeEqual(sha256(password), hash)

  const plaintext = process.env.CSBIE_SETUP_PASSWORD
  if (plaintext) return safeEqual(password, plaintext)

  return false
}
