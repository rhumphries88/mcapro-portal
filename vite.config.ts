import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/webhook': {
        target: 'https://primary-production-c8d0.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
