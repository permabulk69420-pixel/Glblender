import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'], port: 5175, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
