/**
 * Phase 6 — Creator pages (/c/<slug>) e2e spec.
 *
 * Covers tests 10–12 from the Phase 6+7 coverage assignment:
 *  10. Creator page renders with subheader + at least one article tile.
 *  11. Clicking the "From <creator>" link on a dashboard tile navigates
 *      to /c/<slug>.
 *  12. Bogus creator slug → 404.
 *
 * Uses mock-mode (`LUCIDINDEX_MOCK=1`) — no DB required.
 *
 * Known mock creator slugs (from CREATORS in _mock/articles.ts):
 *   - 'web-graphics-lab'  — articles: m-001 (WebGPU comes of age)
 *   - 'sound-lab'         — articles: m-003, m-012
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startMockStack } from './support/mock-server'

// Mock creator slug with at least one article
const CREATOR_SLUG = 'web-graphics-lab'
const CREATOR_LABEL = 'Web Graphics Lab'

// Creator with multiple articles
const CREATOR_SLUG_MULTI = 'sound-lab'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startMockStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

// ── Test 10: creator page renders ────────────────────────────────────────────
test('10. creator page renders subheader + article tiles', async ({ page }) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/c/${CREATOR_SLUG}`)

  // Creator label appears in the subheader (h2 — display display font)
  await expect(page.locator('h2').filter({ hasText: CREATOR_LABEL })).toBeVisible()

  // Article count pill (e.g. "1 article" or "N articles")
  await expect(page.getByText(/\d+ article/i)).toBeVisible()

  // At least one article tile rendered (link to /a/)
  const articleLinks = page.locator('a[href^="/a/"]')
  expect(await articleLinks.count()).toBeGreaterThanOrEqual(1)
})

// ── Test 11: creator link on dashboard tile navigates to /c/<slug> ───────────
test('11. "From <creator>" link on dashboard tile navigates to /c/<slug>', async ({ page }) => {
  const { baseURL } = stack

  // The dashboard in mock mode shows all visible articles.
  // mock article m-003 / m-012 are from 'Sound Lab' (sound-lab slug)
  // — multiple articles so the creator is likely to appear near the top.
  await page.goto(`${baseURL}/`)

  // Find a "From" + creator button in any article tile. We look for
  // TileCreatorLink, which is a <button> containing the creator label.
  // Sound Lab has two articles so it will definitely appear.
  const creatorBtn = page.locator('button').filter({ hasText: 'Sound Lab' }).first()

  await expect(creatorBtn).toBeVisible()
  await creatorBtn.click()

  // Should navigate to the creator page
  await page.waitForURL(`**/c/${CREATOR_SLUG_MULTI}`, { timeout: 10_000 })
  await expect(page.locator('h2').filter({ hasText: 'Sound Lab' })).toBeVisible()
})

// ── Test 12: bogus creator slug → 404 ────────────────────────────────────────
test('12. bogus creator slug returns 404', async ({ page }) => {
  const { baseURL } = stack
  const res = await page.goto(`${baseURL}/c/does-not-exist-xyz-bogus-creator`)
  expect(res?.status()).toBe(404)
})
