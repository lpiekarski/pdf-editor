import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'npm run build && npm run preview -- --port 4173', port: 4173, reuseExistingServer: true, timeout: 180000 },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 14'] } },
  ],
});
