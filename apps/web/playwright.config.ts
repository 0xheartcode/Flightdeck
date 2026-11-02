import { defineConfig } from '@playwright/test';

// End-to-end smoke harness. Kept out of the default `just check` gate (it builds
// both apps and downloads a browser); run it with `just e2e`. The webServer boots
// the control plane, a fake agent, and the web bundle (see e2e/serve.mjs).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'off',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://127.0.0.1:4310',
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
