import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  // The e2e/ specs are Playwright, not vitest; run them with `just e2e`.
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // jsdom so component tests can mount, click and assert on the real DOM.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
