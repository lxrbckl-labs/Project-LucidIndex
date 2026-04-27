/**
 * Phase 7 — Search UI (/search) e2e spec.
 *
 * Covers tests 14–17 from the Phase 6+7 coverage assignment:
 *  14. Search returns matching mocks (q=AI).
 *  15. Empty query state — visiting /search with no q shows hint copy.
 *  16. No results — /search?q=xyzzz_nonsense shows empty state copy.
 *  17. Include archived toggle — /search?q=...&include_archived=1 expands results.
 *
 * Uses mock-mode (`LUCIDINDEX_MOCK=1`) — no DB required.
 *
 * Mock data notes:
 *   - Multiple articles have 'AI' in their topicBadges or title/summary.
 *   - m-012 (Modular synthesis goes quiet) has `dashboardVisible: false`
 *     — so it is "archived" in mock mode. Its title/summary contains
 *     "Modular synthesis" and "modular" which are distinct search terms.
 *     We use q=modular to trigger the archived toggle test since m-012
 *     is the only article with that word that is also archived.
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startMockStack } from './support/mock-server'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startMockStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

// ── Test 14: search returns matching mocks ────────────────────────────────────
test('14. search returns matching mocks for q=AI', async ({ page }) => {
  const { baseURL } = stack

  // Several mock articles have 'AI' in topicBadges or title/summary.
  // m-001 has topicBadges: ['AI', 'GRAPHICS']; m-005 has ['AI'].
  await page.goto(`${baseURL}/search?q=AI`)

  await expect(page.locator('[data-testid="search-results"]')).toBeVisible()

  // At least one result card
  const resultLinks = page.locator('[data-testid="search-results"] a[href^="/a/"]')
  expect(await resultLinks.count()).toBeGreaterThanOrEqual(1)

  // No hidden articles in results — none of the mocks have hidden: true by default
  // (the mock data only has dashboardVisible: false for m-012, not hidden: true)
})

// ── Test 15: empty query state ─────────────────────────────────────────��──────
test('15. empty query shows "Type a query to begin" hint', async ({ page }) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/search`)

  // ResultsHint renders when there's no query
  await expect(page.getByText(/Type a query to begin/i)).toBeVisible()
  // No results container
  await expect(page.locator('[data-testid="search-results"]')).toHaveCount(0)
})

// ── Test 16: no results state ──────────────────────────��──────────────────────
test('16. nonsense query shows empty state copy', async ({ page }) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/search?q=xyzzz_nonsense_query_nobody_wrote`)

  await expect(page.locator('[data-testid="search-empty"]')).toBeVisible()
  await expect(page.getByText(/Nothing matched/i)).toBeVisible()
})

// ── Test 17: include_archived expands results ──────────────���──────────────────
test('17. include_archived=1 includes archived articles in results', async ({ page }) => {
  const { baseURL } = stack

  // m-012 "Modular synthesis goes quiet" has dashboardVisible: false (archived).
  // Without archived flag it should NOT appear; with it it should.

  // Without include_archived: search for "Modular" — m-012 should be absent
  await page.goto(`${baseURL}/search?q=Modular`)

  // Without the archived toggle, m-012 is filtered out.
  // The result set may be empty or contain other articles but NOT m-012.
  const withoutArchived = page.locator('[data-testid="search-results"]')
  // If no results: empty state appears. If results present: m-012 not in them.
  const withoutResultCount = await withoutArchived.count()
  if (withoutResultCount > 0) {
    const modularArchivedLabel = page
      .locator('[data-testid="search-results"]')
      .getByText('Modular synthesis goes quiet')
    await expect(modularArchivedLabel).toHaveCount(0)
  }

  // With include_archived=1: m-012 should appear, marked as "Archived"
  await page.goto(`${baseURL}/search?q=Modular&include_archived=1`)

  await expect(page.locator('[data-testid="search-results"]')).toBeVisible()
  // The archived article title should now be present
  await expect(
    page.locator('[data-testid="search-results"]').getByText('Modular synthesis goes quiet'),
  ).toBeVisible()
  // The "Archived" pill should be visible for this result
  await expect(
    page.locator('[data-testid="search-results"]').getByText('Archived').first(),
  ).toBeVisible()
})
