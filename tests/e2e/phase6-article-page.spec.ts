/**
 * Phase 6 — Standalone article page (/a/<slug>) e2e spec.
 *
 * Covers tests 1–9 from the Phase 6+7 coverage assignment:
 *   1. Full anatomy renders correctly for a known mock slug.
 *   2. Truncation footer appears on the WebGPU article (>2000 words).
 *   3. "Additional Resources" section absent when no citations/cross-source.
 *   4. Cross-source coverage folds into "Additional Resources" when present.
 *   5. Reasonableness rating hidden when null.
 *   6. Friendly 404 page for an unknown slug.
 *   7. Public (unauthenticated) visitor can view an article (200).
 *   8. OG meta tags present in page HTML.
 *   9. "Copy share link" button present.
 *
 * Uses mock-mode (`LUCIDINDEX_MOCK=1`) — no DB required.
 * The mock slug constants are derived from `generateSlug` over the
 * `_mock/articles.ts` seeds; they are stable as long as the seeds
 * don't change.
 *
 * Port strategy: mock mode does not need Postgres, but it still boots a
 * Next.js dev server on port 3401 (the dev-server default). All specs
 * that use `startStack` share that single server (Playwright workers=1
 * ensures sequential execution). We set `LUCIDINDEX_MOCK=1` via the
 * stack env.
 */

import { type APIRequestContext, expect, request, test } from '@playwright/test'
import { type StackHandle, startMockStack } from './support/mock-server'

// ── Known mock slugs (derived from _mock/articles.ts seeds) ─────────────────
// m-001: WebGPU comes of age — VERY_LONG_BODY (>2000 words), crossSource x2,
//        reasonablenessRating: 8, insertedAtOffsetHours: 2 (NEW badge demo)
const SLUG_WEBGPU = '2026-04-24-webgpu-comes-of-age'

// m-003: The quiet revival of baroque counterpoint — crossSource: [],
//        reasonablenessRating: null, insertedAtOffsetHours: 8 (NEW badge demo)
const SLUG_BAROQUE = '2026-04-22-the-quiet-revival-of-baroque-counterpoint'

// m-002: Inside the Event Horizon collaboration — crossSource x1,
//        reasonablenessRating: 7
const SLUG_EVENT_HORIZON = '2026-04-23-inside-the-event-horizon-collaboration'

// m-007: Permacomputing, two years on — crossSource: [], reasonablenessRating: null
const SLUG_PERMACOMPUTING = '2026-04-18-permacomputing-two-years-on'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startMockStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

// ── Test 1: anatomy renders ───────────────────────────────────────────────────
test('1. article anatomy renders — date pill, badge, hero, title, summary, byline, deep-dive', async ({
  page,
}) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/a/${SLUG_EVENT_HORIZON}`)

  // Date pill — time element
  await expect(page.locator('time').first()).toBeVisible()

  // At least one badge pill (topic badge)
  const badgePill = page.locator('span').filter({
    hasText: /^[A-Z]+$/,
  })
  await expect(badgePill.first()).toBeVisible()

  // Hero image with a src attribute
  const heroImg = page.locator('figure img')
  await expect(heroImg).toBeVisible()
  const src = await heroImg.getAttribute('src')
  expect(src).toBeTruthy()
  expect(src?.length).toBeGreaterThan(0)

  // Title (h1) — scoped to <article> to avoid strict-mode collision with the Wordmark h1
  await expect(page.locator('article h1')).toBeVisible()
  await expect(page.locator('article h1')).toContainText('Event Horizon')

  // Italic standfirst summary — rendered as <p class="... italic ...">
  // (the summary is italicized via CSS class, not an <em> element)
  const italicP = page.locator('p.italic')
  await expect(italicP).toBeVisible()

  // Byline: "Analysis by" label + agent label
  await expect(page.getByText(/Analysis by/i)).toBeVisible()

  // Read-time estimate ("N Min")
  await expect(page.getByText(/\d+ Min/)).toBeVisible()

  // Deep-dive body text present
  await expect(page.locator('article p.whitespace-pre-wrap')).toBeVisible()
})

// ── Test 2: truncation footer on long article ─────────────────────────────────
test('2. truncation footer appears on the WebGPU article (>2000 words)', async ({ page }) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/a/${SLUG_WEBGPU}`)

  // The page renders "Truncated for fair-use" when the word cap fires.
  await expect(page.getByText(/Truncated/i)).toBeVisible()
})

// ── Test 3: "Additional Resources" absent when no citations or cross-source ───
// Cross-source links now fold into the collapsible "Additional Resources"
// section (the standalone "Also covered by" card was removed). In mock mode
// citations are always empty, so an article with crossSource: [] has no
// resources of either kind and the section is omitted entirely.
test('3. "Additional Resources" section absent when there are no resources', async ({ page }) => {
  const { baseURL } = stack
  // SLUG_PERMACOMPUTING has crossSource: [] (and no citations in mock mode)
  await page.goto(`${baseURL}/a/${SLUG_PERMACOMPUTING}`)
  await expect(page.locator('[data-testid="article-sources"]')).toHaveCount(0)
  await expect(page.getByText('Additional Resources')).toHaveCount(0)
})

// ── Test 4: cross-source coverage folds into "Additional Resources" ──────────
test('4. cross-source coverage appears inside "Additional Resources" when present', async ({
  page,
}) => {
  const { baseURL } = stack
  // SLUG_EVENT_HORIZON has 1 cross-source entry ("Atomic-clock synchronization in VLBI")
  await page.goto(`${baseURL}/a/${SLUG_EVENT_HORIZON}`)
  const section = page.locator('[data-testid="article-sources"]')
  await expect(section).toBeVisible()
  // The section is collapsed by default — expand it to reveal the entries.
  await page.getByRole('button', { name: /Additional Resources/i }).click()
  // The cross-source entry now renders as a link inside the unified list.
  await expect(section.getByText('Atomic-clock synchronization in VLBI')).toBeVisible()
  expect(await section.locator('a').count()).toBeGreaterThanOrEqual(1)
})

// ── Test 5: reasonableness rating hidden when null ────────────────────────────
test('5. reasonableness rating hidden when null', async ({ page }) => {
  const { baseURL } = stack
  // SLUG_BAROQUE has reasonablenessRating: null
  await page.goto(`${baseURL}/a/${SLUG_BAROQUE}`)
  await expect(page.locator('[data-testid="article-rating"]')).toHaveCount(0)
  await expect(page.getByText(/Reasonableness/i)).toHaveCount(0)
  await expect(page.getByText(/\/10/)).toHaveCount(0)
})

// ── Test 6: 404 on bogus slug ────────────────────────────────────────────────
test('6. friendly 404 page on bogus slug', async ({ page }) => {
  const { baseURL } = stack
  const res = await page.goto(`${baseURL}/a/does-not-exist-xyz-bogus-slug`)
  // Next.js sets HTTP 404 for notFound() pages
  expect(res?.status()).toBe(404)
  // The editorial 404 copy from not-found.tsx
  await expect(page.getByText(/isn't available/i)).toBeVisible()
})

// ── Test 7: public visitor can view article (200) ────────────────────────────
test('7. unauthenticated visitor gets 200 on a valid article', async ({ browser }) => {
  const { baseURL } = stack
  // Fresh context with no session cookie
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  const res = await page.goto(`/a/${SLUG_BAROQUE}`)
  expect(res?.status()).toBe(200)
  // Title renders — page didn't redirect to login
  await expect(page.locator('article h1')).toBeVisible()
  await ctx.close()
})

// ── Test 8: OG meta tags present ─────────────────────────────────────────────
test('8. OG meta tags present in page HTML', async () => {
  const { baseURL } = stack
  const apiCtx: APIRequestContext = await request.newContext({ baseURL })
  const res = await apiCtx.get(`/a/${SLUG_EVENT_HORIZON}`)
  expect(res.status()).toBe(200)
  const html = await res.text()
  // og:title
  expect(html).toMatch(/property="og:title"/)
  // og:image with an absolute URL (http)
  expect(html).toMatch(/property="og:image"/)
  expect(html).toMatch(/content="http/)
  await apiCtx.dispose()
})

// ── Test 9: "Copy share link" button present ──────────────────────────────────
test('9. "Copy share link" button present on article page', async ({ page }) => {
  const { baseURL } = stack
  await page.goto(`${baseURL}/a/${SLUG_BAROQUE}`)
  // ShareLinkButton renders with data-testid="article-share"
  await expect(page.locator('[data-testid="article-share"]')).toBeVisible()
})
