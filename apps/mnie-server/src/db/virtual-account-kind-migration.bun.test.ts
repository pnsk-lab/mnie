import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from './index'
import { apiKeyVirtualAccounts, virtualAccountAssets, virtualAccounts } from './schema'

test('merges legacy account kinds while preserving IDs, assets, and API key grants', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnie-account-kinds-'))
  const path = join(dir, 'legacy.sqlite')
  try {
    const { $client: sqlite } = createDb(path)
    const definition = sqlite
      .query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name = 'virtual_accounts'")
      .get()!.sql
    sqlite.run('PRAGMA foreign_keys = OFF')
    sqlite.run('DROP TABLE virtual_accounts')
    sqlite.run(definition.replace("'standard'", "'personal', 'agent'"))
    sqlite.run('PRAGMA foreign_keys = ON')
    sqlite.run(`
      INSERT INTO virtual_accounts
        (id, physical_account_id, label, kind, system_role, status, policy_json, version, created_at, updated_at)
      VALUES
        ('p', 'physical', 'Custom personal label', 'personal', NULL, 'active', '{"tradingEnabled":false}', 3, 0, 0),
        ('a', 'physical', 'Custom agent label', 'agent', NULL, 'frozen', '{}', 5, 0, 0),
        ('u', 'physical', 'Unallocated', 'system', 'unallocated', 'active', '{}', 7, 0, 0)
    `)
    sqlite.run(`
      INSERT INTO virtual_account_assets
        (virtual_account_id, asset_key, asset_kind, available, reserved, pending, updated_at)
      VALUES ('a', 'cash:JPY', 'cash', '10', '2', '0', 0)
    `)
    sqlite.run(`
      INSERT INTO api_keys (id, label, token_hash, created_at)
      VALUES ('k', 'legacy', 'hash', 0)
    `)
    sqlite.run(`
      INSERT INTO api_key_virtual_accounts
        (api_key_id, virtual_account_id, role, allowed_methods, created_at)
      VALUES ('k', 'p', 'read', '["account.balances.list"]', 0)
    `)
    sqlite.close()

    for (let startup = 0; startup < 2; startup++) {
      const db = createDb(path)
      try {
        expect(db.select().from(virtualAccounts).all()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'p',
              kind: 'standard',
              label: 'Custom personal label',
              policy: { tradingEnabled: false },
              version: 3,
            }),
            expect.objectContaining({ id: 'a', kind: 'standard', status: 'frozen', version: 5 }),
            expect.objectContaining({
              id: 'u',
              kind: 'system',
              systemRole: 'unallocated',
              version: 7,
            }),
          ]),
        )
        expect(db.select().from(virtualAccountAssets).get()).toMatchObject({
          virtualAccountId: 'a',
          available: '10',
          reserved: '2',
        })
        expect(db.select().from(apiKeyVirtualAccounts).all()).toEqual([
          expect.objectContaining({
            apiKeyId: 'k',
            virtualAccountId: 'p',
            role: 'read',
            allowedMethods: ['account.balances.list'],
          }),
        ])
        expect(db.$client.query('PRAGMA foreign_key_check').all()).toEqual([])
        expect(db.$client.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
        expect(() =>
          db.$client.run("UPDATE virtual_accounts SET kind = 'personal' WHERE id = 'p'"),
        ).toThrow('CHECK constraint failed')
      } finally {
        db.$client.close()
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
