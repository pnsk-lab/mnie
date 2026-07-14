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

export const authManagers = sqliteTable('auth_managers', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['bitwarden'] }).notNull(),
  label: text('label').notNull(),
  keyringAccount: text('keyring_account').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const accountProfiles = sqliteTable('account_profiles', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  color: text('color'),
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

export const historyTransactions = sqliteTable(
  'history_transactions',
  {
    profileId: text('profile_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    transaction: text('transaction_json', { mode: 'json' }).$type<unknown>().notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.transactionId] })],
)

export const historySyncs = sqliteTable('history_syncs', {
  profileId: text('profile_id').primaryKey(),
  coveredFrom: integer('covered_from', { mode: 'timestamp_ms' }).notNull(),
  coveredTo: integer('covered_to', { mode: 'timestamp_ms' }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
})

export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    connectorTypeId: text('connector_type_id').notNull(),
    institutionId: text('institution_id').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    kind: text('kind').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('financial_accounts_profile_provider_account_unique').on(
      table.profileId,
      table.providerAccountId,
    ),
  ],
)

/** A fetched, normalized history page. Raw provider payloads are added separately. */
export const transactionObservationSnapshots = sqliteTable('transaction_observation_snapshots', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull(),
  connectorTypeId: text('connector_type_id').notNull(),
  payload: text('payload_json', { mode: 'json' }).$type<unknown>().notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
})

export const transactionObservations = sqliteTable(
  'transaction_observations',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    accountId: text('account_id').notNull(),
    connectorTypeId: text('connector_type_id').notNull(),
    institutionId: text('institution_id').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    providerTransactionId: text('provider_transaction_id'),
    fingerprint: text('fingerprint').notNull(),
    currentRevision: integer('current_revision').notNull(),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('transaction_observations_profile_upstream_unique').on(
      table.profileId,
      table.providerTransactionId,
    ),
  ],
)

export const transactionObservationRevisions = sqliteTable(
  'transaction_observation_revisions',
  {
    observationId: text('observation_id').notNull(),
    revision: integer('revision').notNull(),
    snapshotId: text('snapshot_id').notNull(),
    normalized: text('normalized_json', { mode: 'json' }).$type<unknown>().notNull(),
    parserVersion: text('parser_version').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.observationId, table.revision] })],
)

export const ledgerAccounts = sqliteTable('ledger_accounts', {
  id: text('id').primaryKey(),
  class: text('class').notNull(),
  financialAccountId: text('financial_account_id'),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const economicEvents = sqliteTable('economic_events', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  completeness: text('completeness').notNull(),
  occurredFrom: integer('occurred_from', { mode: 'timestamp_ms' }).notNull(),
  occurredTo: integer('occurred_to', { mode: 'timestamp_ms' }).notNull(),
  metadata: text('metadata_json', { mode: 'json' }).$type<unknown>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const eventPostings = sqliteTable('event_postings', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  ledgerAccountId: text('ledger_account_id').notNull(),
  side: text('side').notNull(),
  amount: text('amount_json', { mode: 'json' }).$type<unknown>().notNull(),
  role: text('role'),
})

export const observationBindings = sqliteTable('observation_bindings', {
  id: text('id').primaryKey(),
  observationId: text('observation_id').notNull(),
  eventId: text('event_id').notNull(),
  postingIds: text('posting_ids_json', { mode: 'json' }).$type<string[] | null>(),
  state: text('state').notNull(),
  provenance: text('provenance').notNull(),
  confidence: text('confidence'),
  matcherVersion: text('matcher_version'),
  evidence: text('evidence_json', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const eventRelations = sqliteTable('event_relations', {
  id: text('id').primaryKey(),
  fromEventId: text('from_event_id').notNull(),
  toEventId: text('to_event_id').notNull(),
  type: text('type').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const accountLinks = sqliteTable('account_links', {
  id: text('id').primaryKey(),
  sourceAccountId: text('source_account_id').notNull(),
  targetAccountId: text('target_account_id').notNull(),
  type: text('type').notNull(),
  instrument: text('instrument_json', { mode: 'json' }).$type<unknown>(),
  validFrom: integer('valid_from', { mode: 'timestamp_ms' }),
  validTo: integer('valid_to', { mode: 'timestamp_ms' }),
  source: text('source').notNull(),
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull(),
})

export const reconciliationProposals = sqliteTable('reconciliation_proposals', {
  id: text('id').primaryKey(),
  candidateKey: text('candidate_key').notNull(),
  eventId: text('event_id').notNull(),
  score: text('score').notNull(),
  state: text('state').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const reconciliationDecisions = sqliteTable('reconciliation_decisions', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull(),
  candidateKey: text('candidate_key').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason'),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }).notNull(),
})

export const reconciliationJobs = sqliteTable('reconciliation_jobs', {
  id: text('id').primaryKey(),
  from: integer('from_at', { mode: 'timestamp_ms' }).notNull(),
  to: integer('to_at', { mode: 'timestamp_ms' }).notNull(),
  state: text('state').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  error: text('error'),
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
    window: text('window', { enum: ['1h', '6h', '1d'] }).notNull(),
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
