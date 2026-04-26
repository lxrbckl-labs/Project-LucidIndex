/**
 * Phase 8 #81/#82/#83/#84/#85 — mobile + a11y visual screenshots.
 *
 * One-off script (not part of the e2e suite). Hits a running mock-mode
 * dev server and captures dashboard / article / search at three
 * viewports for the visual gate:
 *
 *   - 375 × 667 (iPhone SE) — single-column masonry, horizontal pill row.
 *   - 768 × 1024 (iPad)     — 2-column masonry, pill row may still wrap-fit.
 *   - 1440 × 900 (desktop)  — full 6-pattern masonry.
 *
 * Usage:
 *   1) Boot the dev server with `LUCIDINDEX_MOCK=1` on port 3402.
 *   2) Run: node tests/screenshots-phase8-mobile.mjs
 *   3) Output: tests/screenshots/phase8-{dashboard,article,search}-{375,768,1440}.png
 *
 * Why a custom script and not a Playwright spec: same reason as the
 * other screenshots-*.mjs files — the e2e suite runs against a real
 * Postgres + WebAuthn ceremony stack, while mock-mode gives us the
 * dashboard / article / search surfaces without a DB. A bare puppet
 * script is simpler.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOT_DIR = resolve(REPO_ROOT, 'tests/screenshots')

const ARTICLE_SLUG = process.argv[2] ?? '2026-04-24-webgpu-comes-of-age'
const SEARCH_QUERY = process.argv[3] ?? 'webgpu'
const BASE_URL = process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3402'

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

const VIEWPORTS = [
  { label: '375', width: 375, height: 667 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 900 },
]

const ROUTES = [
  { name: 'dashboard', path: '/' },
  { name: 'article', path: `/a/${ARTICLE_SLUG}` },
  { name: 'search', path: `/search?q=${encodeURIComponent(SEARCH_QUERY)}` },
]

console.log(`[screenshots] base=${BASE_URL}`)
console.log(`[screenshots] article=${ARTICLE_SLUG}`)
console.log(`[screenshots] search=${SEARCH_QUERY}`)
console.log(`[screenshots] output=${SCREENSHOT_DIR}`)

const browser = await chromium.launch()

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()

  for (const route of ROUTES) {
    const out = resolve(SCREENSHOT_DIR, `phase8-${route.name}-${viewport.label}.png`)
    const url = `${BASE_URL}${route.path}`
    console.log(`[screenshots] ${viewport.label}px → ${url}`)
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    } catch (err) {
      console.warn(`[screenshots]   navigation timeout: ${err?.message ?? err}`)
    }
    // Hero images are picsum.photos — let them fully load.
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 })
    } catch {
      // ignore: networkidle rarely never settles with SSE in flight
    }
    await page.screenshot({ path: out, fullPage: true })
  }

  await context.close()
}

await browser.close()
console.log('[screenshots] done')
