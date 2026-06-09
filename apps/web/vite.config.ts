import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-user dev app. The NestJS API runs on :3000 with no global prefix and
// no CORS; we namespace all calls under /api and strip the prefix in the proxy.
export default defineConfig({
  plugins: [react()],
  // @terrain/sr-engine is a symlinked workspace package shipping CommonJS. Vite's
  // dev server serves linked deps as raw source, and native ESM cannot pull a
  // named export (sm2) out of a CJS module — so force-prebundle it with esbuild,
  // which converts CJS -> ESM and exposes the named exports. (Prod is handled by
  // build.commonjsOptions below.)
  optimizeDeps: {
    include: ['@terrain/sr-engine'],
  },
  build: {
    // @terrain/sr-engine is a workspace package emitting CommonJS (it is also
    // consumed by the CommonJS NestJS api). pnpm/yarn symlinks resolve it to its
    // real path under packages/, which is outside the commonjs plugin's default
    // node_modules-only include, so rollup would treat the CJS dist as ESM and
    // fail to find its named exports. Explicitly include it so its named exports
    // (sm2, etc.) are resolvable.
    commonjsOptions: {
      include: [/node_modules/, /packages\/sr-engine/],
    },
  },
  server: {
    // Dedicated port (5173/5174 are taken by the Midas Backoffice dev server).
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
