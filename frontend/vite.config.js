import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // V1.33：图片附件 dev 代理（prod 由后端 /uploads 静态服务直接出）
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
