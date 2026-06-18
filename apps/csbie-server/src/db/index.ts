import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

export const createDb = (path: string) => {
  const sqlite = new Database(path, { create: true, strict: true })
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run('PRAGMA foreign_keys = ON')
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS user_passkeys (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sbi_passkeys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      keyring_account TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      max_trades_per_hour INTEGER,
      max_trades_per_6_hours INTEGER,
      max_trades_per_day INTEGER,
      max_order_price_jpy INTEGER,
      max_order_amount_jpy INTEGER,
      allowed_methods TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )
  `)
  const apiKeyColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(api_keys)')
    .all()
    .map((column) => column.name)
  for (const [name, type] of [
    ['max_trades_per_hour', 'INTEGER'],
    ['max_trades_per_6_hours', 'INTEGER'],
    ['max_trades_per_day', 'INTEGER'],
    ['max_order_price_jpy', 'INTEGER'],
    ['max_order_amount_jpy', 'INTEGER'],
    ['allowed_methods', 'TEXT'],
  ] as const) {
    if (!apiKeyColumns.includes(name)) sqlite.run(`ALTER TABLE api_keys ADD COLUMN ${name} ${type}`)
  }
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS api_key_trade_usage (
      api_key_id TEXT NOT NULL,
      window TEXT NOT NULL,
      hour_bucket TEXT NOT NULL,
      trade_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (api_key_id, window, hour_bucket)
    )
  `)
  const tradeUsageColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(api_key_trade_usage)')
    .all()
    .map((column) => column.name)
  if (!tradeUsageColumns.includes('window')) {
    sqlite.run('DROP TABLE api_key_trade_usage')
    sqlite.run(`
      CREATE TABLE api_key_trade_usage (
        api_key_id TEXT NOT NULL,
        window TEXT NOT NULL,
        hour_bucket TEXT NOT NULL,
        trade_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (api_key_id, window, hour_bucket)
      )
    `)
  }
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      client TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT,
      api_key_settings TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  const oauthCodeColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(oauth_authorization_codes)')
    .all()
    .map((column) => column.name)
  if (!oauthCodeColumns.includes('api_key_settings')) {
    sqlite.run('ALTER TABLE oauth_authorization_codes ADD COLUMN api_key_settings TEXT')
  }
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      api_key_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `)

  return drizzle(sqlite, { schema })
}
