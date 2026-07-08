import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build'
  },
  server: {
    host: '::',
    port: 8080,
    proxy: {
      '/api/koios': {
        target: 'https://api.koios.rest/api/v1',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/koios/, '')
      }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
