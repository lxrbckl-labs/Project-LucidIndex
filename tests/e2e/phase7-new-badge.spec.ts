/**
 * Phase 7 — "NEW" badge e2e spec.
 *
 * Covers tests 18–19 from the Phase 6+7 coverage assignment:
 *  18. NEW badge visible on recent mocks — visit /. Assert at least one
 *      "NEW" pill in the page HTML (seeds m-001 and m-003 have
 *      insertedAtOffsetHours of 2h and 8h respectively, both well
 *      within the 24h default window).
 *  19. NEW badge absent on older mocks — visit a dashboard tile for a
 *      mock with no insertedAtOffsetHours (defaults to 30 days, far
 *      outside the 24h window).
 *
 * Uses mock-mode (`LUCIDINDEX_MOCK=1`) — no DB required.
 *
 * Mock data notes:
 *   m-001 — insertedAtOffsetHours: 2   (WebGPU comes of age)
 *   m-003 — insertedAtOffsetHours: 8   (Quiet revival of baroque counterpoint)
 *   All others — no insertedAtOffsetHours (defaults to DEFAULT_INSERTED_OFFSET_HOURS = 24*30 = 720h)
 *
 * The dashboard uses getNewBadgeHours() which returns DEFAULT_NEW_BADGE_HOURS=24
 * when LUCIDINDEX_MOCK=1. So articles with insertedAtOffsetHours < 24 will
 * get the badge; all others won't.
 *
 * NewBadge renders with data-testid="new-badge".
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startMockStack } from './support/mock-server'

// Known mock article slugs
const SLUG_WEBGPU = '2026-04-24-webgpu-comes-of-age' // insertedAtOffsetHours: 2 → NEW
const SLUG_BAROQUE = '2026-04-22-the-quiet-revival-of-baroque-counterpoint' // 8h → NEW
const SLUG_OLD = '2026-04-15-cargo-cult-bayes' // no insertedAtOffsetHours → old (720h)

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startMockStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

// ── Test 18: NEW badge visible on recent mocks ────────────────────────────────
test('18. NEW badge visible on dashboard for recent mock articles', async ({ page }) => {
  const { baseURL } = stack

  // Mock mode bypasses the session check on the dashboard (LUCIDINDEX_MOCK=1
  // is treated as an authenticated bypass in page.tsx). The NEW badge is
  // rendered when isNew(createdAt, 24h) is true.
  //
  // We assert at the dashboard level (at least one [data-testid="new-badge"])
  // then confirm the specific tiles for m-001 and m-003 carry the badge on
  // their article pages.

  await page.goto(`${baseURL}/`)
  const newBadges = page.locator('[data-testid="new-badge"]')
  expect(await newBadges.count()).toBeGreaterThanOrEqual(1)

  // Article page also shows NEW badge for a recent article.
  await page.goto(`${baseURL}/a/${SLUG_WEBGPU}`)
  await expect(page.locator('[data-testid="new-badge"]')).toBeVisible()

  await page.goto(`${baseURL}/a/${SLUG_BAROQUE}`)
  await expect(page.locator('[data-testid="new-badge"]')).toBeVisible()
})

// ── Test 19: NEW badge absent on older mocks ──────────────────────────────────
test('19. NEW badge absent for mock articles outside the 24h window', async ({ page }) => {
  const { baseURL } = stack

  // SLUG_OLD has no insertedAtOffsetHours → defaults to 720h (30 days),
  // which is way outside the 24h badge window.
  await page.goto(`${baseURL}/a/${SLUG_OLD}`)
  await expect(page.locator('[data-testid="new-badge"]')).toHaveCount(0)
})
