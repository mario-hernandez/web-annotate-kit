import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5197,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3007',
      '/screenshots': 'http://localhost:3007',
    },
  },
});
