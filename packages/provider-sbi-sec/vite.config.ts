import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    deps: {
      alwaysBundle: [/^@repo\//, 'iconv-lite', 'safer-buffer'],
      onlyBundle: false,
    },
    dts: { eager: true },
    format: ['esm'],
    platform: 'node',
  },
})
