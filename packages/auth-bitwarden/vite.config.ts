import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    dts: { eager: true },
    format: ['esm'],
    platform: 'node',
  },
})
