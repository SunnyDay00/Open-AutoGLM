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
      '/devices_data': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            if (err.message.indexOf('ECONNRESET') !== -1 || err.message.indexOf('ECONNABORTED') !== -1) {
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
