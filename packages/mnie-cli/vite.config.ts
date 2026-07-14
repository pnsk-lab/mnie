import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    deps: {
      alwaysBundle: [/^@repo\//],
      onlyBundle: false,
    },
    dts: process.env.MNIE_BUILD_DTS !== 'false',
    format: ['esm'],
    platform: 'node',
  },
})
