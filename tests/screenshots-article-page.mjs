/**
 * Phase 6 #64/#65/#66 — article page visual screenshot.
 *
 * One-off script (not part of the e2e suite). Hits a running mock-mode
 * dev server on `http://localhost:3402` and captures the rendered
 * article page for the visual gate.
 *
 * Usage:
 *   1) Boot the dev server with `LUCIDINDEX_MOCK=1` on port 3402.
 *   2) Run: node tests/screenshots-article-page.mjs
 *   3) Output: tests/screenshots/phase6-article-page.png
 *
 * Why a custom script and not a Playwright spec: the e2e suite runs
 * against a real Postgres + WebAuthn ceremony stack. The article page
 * doesn't need either — mock-mode renders against the in-process
 * `_mock/articles.ts` array, no DB, no auth ceremony. A bare
 * screenshot script is the simplest fit.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOT_DIR = resolve(REPO_ROOT, 'tests/screenshots')

const ARTICLE_SLUG = process.argv[2] ?? '2026-04-24-webgpu-comes-of-age'
const BASE_URL = process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3402'
const OUT_FILE = resolve(SCREENSHOT_DIR, 'phase6-article-page.png')

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

console.log(`[screenshots] article=${ARTICLE_SLUG}`)
console.log(`[screenshots] target=${BASE_URL}/a/${ARTICLE_SLUG}`)
console.log(`[screenshots] output=${OUT_FILE}`)

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
const page = await context.newPage()
await page.goto(`${BASE_URL}/a/${ARTICLE_SLUG}`, { waitUntil: 'networkidle' })

// Hero image is picsum.photos — let it fully load before snap so the
// editorial layout reads correctly in the screenshot.
await page.waitForLoadState('networkidle')

await page.screenshot({ path: OUT_FILE, fullPage: true })
await browser.close()

console.log(`[screenshots] done: ${OUT_FILE}`)
