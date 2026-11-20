import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Follows the backend's PORT (server/dev.mjs passes the same env to both), so
      // `PORT=8797 npm run dev` keeps the pair together when 8787 is taken by something else.
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Splits large, slow-changing vendor code (three.js's WebGL runtime, Clerk's auth SDK)
        // into their own chunks, away from app code. App code changes on nearly every deploy;
        // these don't, so browsers keep serving them from cache across releases instead of
        // re-downloading them whenever App.jsx changes.
        manualChunks: {
          'vendor-three': ['three'],
          'vendor-clerk': ['@clerk/clerk-react'],
        },
      },
    },
  },
});
