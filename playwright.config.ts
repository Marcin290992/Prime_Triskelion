import { defineConfig, devices } from '@playwright/test';

// Smoke tests only — build the site for real (dist/) and serve it exactly
// like production, instead of testing against the dev server (which has
// HMR/Vite-only behavior that production never sees).
// Overridable so a locally-running `npm run dev` on the default 4321 (e.g.
// while testing live on a phone) doesn't collide with — or get mistaken
// for — the production-like build+preview server this suite needs.
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 4321;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    // Pixel (not an iPhone preset) deliberately — Playwright's iOS device
    // presets default to WebKit, which CI doesn't install here (only
    // chromium, see ci.yml) to keep the install fast. isMobile:true +
    // touch is what oxygenMenu.ts actually branches on (matchMedia
    // max-width:1024px + navigator touch), not the specific engine.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
