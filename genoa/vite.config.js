import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Genoa UI is built into src/ui/dist/ and served by src/api/server.js
// as static.  The dev server proxies /api to the Express API on :8080.
export default defineConfig({
  root:    path.resolve('src/ui'),
  publicDir: path.resolve('src/ui/public-static'),
  plugins: [react()],
  resolve: {
    alias: {
      '@components': path.resolve('src/components'),
      '@styles':     path.resolve('src/styles')
    }
  },
  build: {
    outDir:        path.resolve('src/ui/dist'),
    emptyOutDir:   true,
    sourcemap:     false,
    assetsDir:     'assets'
  },
  server: {
    port: 5173,
    proxy: {
      '/api':     'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
      '/readyz':  'http://localhost:8080'
    }
  }
});
