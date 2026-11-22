import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    deps: {
      alwaysBundle: [/^@repo\//],
      onlyBundle: false,
    },
    dts: process.env.MNIE_BUILD_DTS === 'false' ? false : { eager: true },
    format: ['esm'],
    platform: 'node',
  },
})
