import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'

const serverPort = Number(process.env.PORT ?? process.env.MNIE_SERVER_PORT ?? 8787)
const serverOrigin = process.env.MNIE_SERVER_ORIGIN ?? `http://127.0.0.1:${serverPort}`
const proxyToServer = {
  target: serverOrigin,
  changeOrigin: true,
  ws: true,
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: Number(process.env.MNIE_UI_DEV_PORT ?? 5173),
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
      clientPort: Number(process.env.MNIE_UI_DEV_PORT ?? 5173),
    },
    proxy: {
      '/api': {
        ...proxyToServer,
      },
      '/.well-known': proxyToServer,
      '/authorize': proxyToServer,
      '/token': proxyToServer,
      '/register': proxyToServer,
      '/revoke': proxyToServer,
    },
  },
})
