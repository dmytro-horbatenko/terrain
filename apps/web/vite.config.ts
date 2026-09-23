import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Single-user dev app. The NestJS API runs on :3000 with no global prefix and
// no CORS; we namespace all calls under /api and strip the prefix in the proxy.
export default defineConfig({
  plugins: [react()],
  // Follow workspace source in the browser so edits cannot leave a stale CJS
  // prebundle behind. Node/API consumers still use the packages' CommonJS builds.
  resolve: {
    alias: {
      '@terrain/types': fileURLToPath(
        new URL('../../packages/types/src/index.ts', import.meta.url),
      ),
      '@terrain/sr-engine': fileURLToPath(
        new URL('../../packages/sr-engine/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    // Dedicated port, distinct from Vite's default 5173/5174 range.
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
