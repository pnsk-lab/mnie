import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      'apps/mnie-server/src/rpc/ws.integration.test.ts',
      'apps/mnie-server/src/security/trade-limits.test.ts',
      'apps/mnie-server/src/providers/registry-lock.test.ts',
    ],
  },
})
