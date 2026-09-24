import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4337',
    channel: 'chrome',
    viewport: { width: 1512, height: 982 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/start-server.mjs',
    url: 'http://127.0.0.1:4337/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: 'list',
});
