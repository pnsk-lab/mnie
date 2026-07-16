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
      color TEXT,
      keyring_account TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  const sbiPasskeyColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(sbi_passkeys)')
    .all()
    .map((column) => column.name)
  if (!sbiPasskeyColumns.includes('color'))
    sqlite.run('ALTER TABLE sbi_passkeys ADD COLUMN color TEXT')
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS auth_managers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      keyring_account TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS account_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT,
      keyring_account TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  const accountProfileColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(account_profiles)')
    .all()
    .map((column) => column.name)
  if (!accountProfileColumns.includes('color'))
    sqlite.run('ALTER TABLE account_profiles ADD COLUMN color TEXT')
  sqlite.run(`UPDATE account_profiles SET provider = 'mobile-suica' WHERE provider = 'mobilesuica'`)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS asset_valuations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      value INTEGER NOT NULL,
      holdings_value INTEGER,
      cash_value INTEGER,
      currency TEXT NOT NULL,
      captured_at INTEGER NOT NULL
    )
  `)
  const assetValuationColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(asset_valuations)')
    .all()
    .map((column) => column.name)
  if (!assetValuationColumns.includes('holdings_value'))
    sqlite.run('ALTER TABLE asset_valuations ADD COLUMN holdings_value INTEGER')
  if (!assetValuationColumns.includes('cash_value'))
    sqlite.run('ALTER TABLE asset_valuations ADD COLUMN cash_value INTEGER')
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS asset_valuations_profile_captured_idx
    ON asset_valuations (profile_id, captured_at DESC)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS history_transactions (
      profile_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      transaction_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, transaction_id)
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS history_transactions_profile_occurred_idx
    ON history_transactions (profile_id, occurred_at DESC)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS history_syncs (
      profile_id TEXT PRIMARY KEY,
      covered_from INTEGER NOT NULL,
      covered_to INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      connector_type_id TEXT NOT NULL,
      institution_id TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (profile_id, provider_account_id)
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS transaction_observation_snapshots (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      connector_type_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS transaction_observation_snapshots_profile_fetched_idx
    ON transaction_observation_snapshots (profile_id, fetched_at DESC)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS transaction_observations (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      connector_type_id TEXT NOT NULL,
      institution_id TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      provider_transaction_id TEXT,
      fingerprint TEXT NOT NULL,
      time_precision TEXT NOT NULL DEFAULT 'instant',
      current_revision INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )
  `)
  const observationColumns = sqlite
    .query<{ name: string }, []>('PRAGMA table_info(transaction_observations)')
    .all()
    .map((column) => column.name)
  if (!observationColumns.includes('time_precision')) {
    sqlite.run(
      "ALTER TABLE transaction_observations ADD COLUMN time_precision TEXT NOT NULL DEFAULT 'instant'",
    )
    sqlite.run(
      "UPDATE transaction_observations SET time_precision = 'day' WHERE connector_type_id = 'mobile-suica'",
    )
  }
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS transaction_observations_profile_upstream_unique
    ON transaction_observations (profile_id, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS transaction_observations_profile_fingerprint_idx
    ON transaction_observations (profile_id, account_id, fingerprint)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS transaction_observation_revisions (
      observation_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot_id TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (observation_id, revision)
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS transaction_observation_revisions_snapshot_idx
    ON transaction_observation_revisions (snapshot_id)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id TEXT PRIMARY KEY,
      class TEXT NOT NULL,
      financial_account_id TEXT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_financial_account_unique
    ON ledger_accounts (financial_account_id) WHERE financial_account_id IS NOT NULL
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS economic_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      completeness TEXT NOT NULL,
      occurred_from INTEGER NOT NULL,
      occurred_to INTEGER NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS economic_events_occurred_idx
    ON economic_events (occurred_from, occurred_to)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS event_postings (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      ledger_account_id TEXT NOT NULL,
      side TEXT NOT NULL,
      amount_json TEXT NOT NULL,
      role TEXT
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS observation_bindings (
      id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      posting_ids_json TEXT,
      state TEXT NOT NULL,
      provenance TEXT NOT NULL,
      confidence TEXT,
      matcher_version TEXT,
      evidence_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS observation_bindings_confirmed_observation_unique
    ON observation_bindings (observation_id) WHERE state = 'confirmed'
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS event_relations (
      id TEXT PRIMARY KEY,
      from_event_id TEXT NOT NULL,
      to_event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS account_links (
      id TEXT PRIMARY KEY,
      source_account_id TEXT NOT NULL,
      target_account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      instrument_json TEXT,
      valid_from INTEGER,
      valid_to INTEGER,
      source TEXT NOT NULL,
      confirmed INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS reconciliation_proposals (
      id TEXT PRIMARY KEY,
      candidate_key TEXT NOT NULL,
      event_id TEXT NOT NULL,
      score TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_proposals_candidate_unique
    ON reconciliation_proposals (candidate_key) WHERE state = 'proposed'
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS reconciliation_decisions (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      candidate_key TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      decided_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS reconciliation_decisions_candidate_idx
    ON reconciliation_decisions (candidate_key, decided_at DESC)
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS reconciliation_jobs (
      id TEXT PRIMARY KEY,
      from_at INTEGER NOT NULL,
      to_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS reconciliation_jobs_state_created_idx
    ON reconciliation_jobs (state, created_at)
  `)
  sqlite.run(`
    INSERT OR IGNORE INTO account_profiles (id, provider, label, keyring_account, created_at, updated_at)
    SELECT id, 'sbisec', label, keyring_account, created_at, updated_at FROM sbi_passkeys
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
    ['scopes', 'TEXT'],
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
