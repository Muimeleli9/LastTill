import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://lasttill-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' }
  }
});
