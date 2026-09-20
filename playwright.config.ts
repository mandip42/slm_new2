import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real production build so that the service
 * worker, static prerendering and the compiled AudioWorklet are all exercised.
 *
 * Microphone access is granted via a fake device so that CI can run headless.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    permissions: ['microphone'],
  },
  projects: [
    {
      name: 'android-chromium',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run start -- --port 3100 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3100',
    // Never reuse an already running server: it would serve whatever build was
    // last made, and a stale build silently invalidates every assertion.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
