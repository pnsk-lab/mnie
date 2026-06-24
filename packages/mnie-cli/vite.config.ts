import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    deps: {
      alwaysBundle: [/^@repo\//, /^@napi-rs\/keyring/],
      onlyBundle: false,
    },
    dts: true,
    format: ['esm'],
    platform: 'node',
  },
})
