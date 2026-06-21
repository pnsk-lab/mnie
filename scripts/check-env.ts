const requiredForSetup = ['MNIE_SETUP_PASSWORD', 'MNIE_SETUP_PASSWORD_HASH'] as const

const runtimeDefaults = {
  PORT: '8787',
  MNIE_DATABASE_PATH: './data/mnie-app.sqlite',
  MNIE_KEYRING_BACKEND: 'platform',
  MNIE_ORIGIN: 'http://127.0.0.1:5173',
  MNIE_RP_ID: '127.0.0.1',
}

const optionalUrls = [
  'SBI_AUTH_BASE_URL',
  'SBI_MTS_BASE_URL',
  'SBI_IZANAGI_BASE_URL',
  'MNIE_ORIGIN',
  'MNIE_CORS_ORIGIN',
]

const present = (key: string) => Boolean(process.env[key]?.trim())

const validateUrl = (key: string) => {
  const value = process.env[key]
  if (!value) return undefined
  try {
    new URL(value)
    return undefined
  } catch {
    return `${key} must be a valid URL`
  }
}

const messages: string[] = []

for (const [key, fallback] of Object.entries(runtimeDefaults)) {
  if (!present(key)) messages.push(`${key} is not set; runtime default is ${fallback}`)
}

for (const key of optionalUrls) {
  const message = validateUrl(key)
  if (message) messages.push(message)
}

if (!requiredForSetup.some(present)) {
  messages.push(
    'Set MNIE_SETUP_PASSWORD or MNIE_SETUP_PASSWORD_HASH before first owner passkey setup',
  )
}

if (process.env.MNIE_KEYRING_BACKEND === 'sqlite' && !present('MNIE_KEYRING_SECRET')) {
  messages.push('Set MNIE_KEYRING_SECRET when MNIE_KEYRING_BACKEND=sqlite')
}

if (
  !present('SBI_AUTH_BASE_URL') ||
  !present('SBI_MTS_BASE_URL') ||
  !present('SBI_IZANAGI_BASE_URL')
) {
  messages.push(
    'Set SBI_AUTH_BASE_URL, SBI_MTS_BASE_URL, and SBI_IZANAGI_BASE_URL before connecting an SBI session with domestic issue search',
  )
}

if (messages.length === 0) {
  console.log('env:check ok')
} else {
  console.log('env:check notices:')
  for (const message of messages) console.log(`- ${message}`)
}
