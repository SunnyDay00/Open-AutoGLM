import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            if (err.message.includes('ECONNRESET') || err.message.includes('ECONNABORTED')) {
              // Ignore harmless socket errors
              return; 
            }
            console.log('proxy error', err);
          });
        }
      }
    }
  }
})
