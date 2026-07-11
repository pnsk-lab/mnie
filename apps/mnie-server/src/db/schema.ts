import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const userPasskeys = sqliteTable('user_passkeys', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports', { mode: 'json' }).$type<string[] | undefined>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const passkeyChallenges = sqliteTable('passkey_challenges', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['registration', 'authentication'] }).notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const sbiPasskeys = sqliteTable('sbi_passkeys', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  keyringAccount: text('keyring_account').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const accountProfiles = sqliteTable('account_profiles', {
  id: text('id').primaryKey(),
  provider: text('provider', {
    enum: ['sbisec', 'smbc-direct', 'mobilesuica', 'paypay-bank'],
  }).notNull(),
  label: text('label').notNull(),
  keyringAccount: text('keyring_account').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const assetValuations = sqliteTable('asset_valuations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: text('profile_id').notNull(),
  provider: text('provider').notNull(),
  value: integer('value').notNull(),
  holdingsValue: integer('holdings_value'),
  cashValue: integer('cash_value'),
  currency: text('currency').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
})

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    maxTradesPerHour: integer('max_trades_per_hour'),
    maxTradesPer6Hours: integer('max_trades_per_6_hours'),
    maxTradesPerDay: integer('max_trades_per_day'),
    maxOrderPriceJpy: integer('max_order_price_jpy'),
    maxOrderAmountJpy: integer('max_order_amount_jpy'),
    allowedMethods: text('allowed_methods', { mode: 'json' }).$type<string[] | null>(),
    scopes: text('scopes', { mode: 'json' }).$type<string[] | null>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('api_keys_token_hash_unique').on(table.tokenHash)],
)

export const apiKeyTradeUsage = sqliteTable(
  'api_key_trade_usage',
  {
    apiKeyId: text('api_key_id').notNull(),
    window: text('window', { enum: ['1h', '3h', '1d'] }).notNull(),
    hourBucket: text('hour_bucket').notNull(),
    tradeCount: integer('trade_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.apiKeyId, table.window, table.hourBucket] })],
)

export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  client: text('client', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const oauthAuthorizationCodes = sqliteTable('oauth_authorization_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  resource: text('resource'),
  apiKeySettings: text('api_key_settings', { mode: 'json' }).$type<Record<
    string,
    unknown
  > | null>(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const oauthRefreshTokens = sqliteTable('oauth_refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  apiKeyId: text('api_key_id').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  resource: text('resource'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})
