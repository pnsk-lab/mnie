import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createDb } from '../db'
import { createApiKey } from '../security/api-keys'

test('the bundled app routes both MCP paths to authenticated tool discovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mnie-bundled-mcp-'))
  const databasePath = join(directory, 'test.sqlite')
  const db = createDb(databasePath)
  const { token } = await createApiKey(db, 'bundled MCP test', { scopes: ['read'] })
  db.$client.close()
  const process = Bun.spawn(
    [Bun.which('bun')!, resolve(import.meta.dir, '../../../mnie-app/src/index.ts')],
    {
      env: {
        ...Bun.env,
        PORT: '0',
        MNIE_DATABASE_PATH: databasePath,
        MNIE_ORIGIN: 'http://localhost',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  try {
    const reader = process.stdout.getReader()
    const decoder = new TextDecoder()
    let output = ''
    let baseURL: string | undefined
    const timeout = setTimeout(() => process.kill(), 10_000)
    try {
      while (!baseURL) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`Bundled app exited before listening: ${output}`)
        output += decoder.decode(chunk.value, { stream: true })
        baseURL = /mnie listening on (http:\/\/localhost:\d+)/.exec(output)?.[1]
      }
    } finally {
      clearTimeout(timeout)
      reader.releaseLock()
    }
    for (const path of ['/api/mcp', '/mcp']) {
      const unauthorized = await fetch(new URL(path, baseURL))
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.headers.get('content-type')).toContain('application/json')
      const client = new Client({ name: 'bundled-discovery', version: '1.0.0' })
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(path, baseURL), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        )
        const { tools } = await client.listTools()
        expect(tools.map((tool) => tool.name)).toContain('mnie-workspace-invoke')
        const result = await client.callTool({ name: 'mnie-workspace-operations', arguments: {} })
        expect(result.isError).not.toBe(true)
      } finally {
        await client.close()
      }
    }
  } finally {
    process.kill()
    await process.exited
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)
