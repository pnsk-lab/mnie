import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('account execution boundaries', () => {
  test('normal RPC, MCP, and UI cannot invoke a raw provider', async () => {
    for (const name of ['rpc/handler.ts', 'rpc/portfolio.ts', 'routes/mcp.ts']) {
      const source = readFileSync(resolve(import.meta.dir, name), 'utf8')
      expect(source, name).not.toMatch(/\bproviders\.(open|use|connect|completeConnection)\(/)
      expect(source, name).not.toMatch(/\bprovider\.invoke\(/)
      expect(source, name).not.toMatch(/import\s*{[^}]*FinancialProvider[^}]*}\s*from/)
    }
    const uiRoot = resolve(import.meta.dir, '../../mnie-ui/src')
    for await (const path of new Bun.Glob('**/*.{ts,vue}').scan(uiRoot)) {
      const source = readFileSync(resolve(uiRoot, path), 'utf8')
      expect(source, path).not.toMatch(/['"]profile\.invoke['"]|\.profile\([^)]*\)\.invoke/)
    }
  })
  test('physical gateway exposes separate read and order commands', () => {
    const source = readFileSync(resolve(import.meta.dir, 'physical-account-gateway.ts'), 'utf8')
    expect(source).not.toMatch(/^\s+(?:async )?invoke\(/m)
    for (const method of ['previewOrder', 'placeOrder', 'replaceOrder', 'cancelOrder'])
      expect(source).toContain(`async ${method}(`)
  })
})
