import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from '../db'
import { apiKeyVirtualAccounts, apiKeys } from '../db/schema'

test('legacy global account restrictions migrate without widening access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnie-permissions-'))
  const path = join(dir, 'legacy.sqlite')
  try {
    const initial = createDb(path)
    const sqlite = initial.$client
    sqlite.run(
      "INSERT INTO api_keys (id,label,token_hash,allowed_methods,created_at) VALUES ('k','legacy','hash',?,0)",
      [
        JSON.stringify([
          'account.balances.list',
          'account.investments.orders.create',
          'admin.apiKeys.create',
        ]),
      ],
    )
    sqlite.run(
      "INSERT INTO virtual_accounts (id,physical_account_id,label,kind,status,policy_json,created_at,updated_at) VALUES ('a','p','a','agent','active','{}',0,0)",
    )
    sqlite.run(
      "INSERT INTO api_key_virtual_accounts (api_key_id,virtual_account_id,role,created_at) VALUES ('k','a','trade',0)",
    )
    sqlite.close()
    const legacy = new Database(path)
    legacy.run('ALTER TABLE api_key_virtual_accounts DROP COLUMN allowed_methods')
    legacy.close()
    const migrated = createDb(path)
    const binding = migrated.select().from(apiKeyVirtualAccounts).get()
    // The former trade policy also required an unprefixed name, so the old
    // permission did not actually permit this order and must not gain it.
    expect(binding?.allowedMethods).toEqual([
      'account.balances.list',
      'account.operations',
      'account.capabilities',
      'account.availability',
    ])
    expect(migrated.select().from(apiKeys).get()?.allowedMethods).not.toContain(
      'admin.apiKeys.create',
    )
    migrated.$client.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
