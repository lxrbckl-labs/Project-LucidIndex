/**
 * Playwright config for the LucidIndex e2e suite.
 *
 * Scope: integration smoke tests that exercise a real Next.js dev server
 * against a real Postgres container. The stack is started/stopped manually
 * by `support/dev-server.ts` from the test's `beforeAll` hook (Postgres has
 * to be up + migrated before Next.js can boot, which is awkward to express
 * via Playwright's `webServer` option), so we deliberately don't set one
 * here.
 *
 * Single browser: chromium. The founding-admin smoke uses the WebAuthn CDP
 * domain to register a virtual authenticator, which is chromium-only.
 *
 * Single worker: the Postgres + dev-server stack is shared, mutable state.
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // The first test boots the dev server (~30s on a cold cache) and runs
  // through a multi-step WebAuthn ceremony; give it room.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    headless: process.env.PLAYWRIGHT_HEADED !== '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  outputDir: './test-results',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
