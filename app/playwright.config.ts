import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Nomi e2e tests.
 *
 * These tests run against the built web frontend (Vite preview server) while
 * requiring the Go backend (nomid) to be running on :8080.
 *
 * Start the backend before running tests:
 *   cd .. && go run ./cmd/nomid
 *
 * Then run tests:
 *   npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
