import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
})
