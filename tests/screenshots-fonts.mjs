/**
 * Phase 5 #54 — typography candidate screenshots.
 *
 * One-off script (not part of the e2e suite). Hits the running mock-mode
 * dev server, captures a 1440-px-wide dashboard screenshot, and stitches
 * it side-by-side with `Design/main.jpg` for the visual gate.
 *
 * Usage:
 *   1) Boot the dev server with the candidate font wired into layout.tsx
 *      (LUCIDINDEX_MOCK=1, DATABASE_URL=stub).
 *   2) Run: node tests/screenshots-fonts.mjs <candidate-name>
 *      e.g. `node tests/screenshots-fonts.mjs bebas-inter`
 *   3) Output goes to tests/screenshots/<candidate-name>.png and (when
 *      Design/main.jpg is reachable) <candidate-name>-vs-main.png.
 *
 * Why a custom script instead of a Playwright spec: the e2e suite runs
 * against a real Postgres + WebAuthn ceremony stack and isn't structured
 * to be re-entered per font candidate. A bare puppet script is simpler
 * and keeps the visual gate's artifacts out of the test runner.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOT_DIR = resolve(REPO_ROOT, 'tests/screenshots')
const DESIGN_REF = process.env.LUCIDINDEX_DESIGN_REF // optional path to Design/main.jpg

const candidate = process.argv[2]
if (!candidate) {
  console.error('Usage: node tests/screenshots-fonts.mjs <candidate-name>')
  process.exit(1)
}

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

const dashboardOut = resolve(SCREENSHOT_DIR, `${candidate}.png`)
const sideBySideOut = resolve(SCREENSHOT_DIR, `${candidate}-vs-main.png`)

console.log(`[screenshots] candidate=${candidate}`)
console.log(`[screenshots] dashboard → ${dashboardOut}`)

// 1) Capture the dashboard at 1440px width.
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 2400 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()
// `domcontentloaded` (not `networkidle`) — the page holds an open SSE
// connection to `/api/events`, so the browser never reaches a true idle.
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
// Give next/font + masonry images a beat to hydrate. `display: 'swap'`
// paints the fallback first, then swaps once the woff2 lands.
await page.waitForTimeout(2500)
await page.screenshot({ path: dashboardOut, fullPage: true })
await browser.close()
console.log(`[screenshots] captured ${dashboardOut}`)

// 2) (Optional) stitch with Design/main.jpg via sharp.
if (DESIGN_REF && existsSync(DESIGN_REF)) {
  // sharp lives in the workspace store but is not a direct tests dep.
  // Resolve through the pnpm store path so we can stitch without
  // adding a workspace-level package change just for this script.
  const sharpModule = await import(
    resolve(REPO_ROOT, 'node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/index.js')
  ).catch((err) => {
    console.log('[screenshots] sharp resolve failed:', err.message)
    return null
  })
  if (!sharpModule) {
    console.log('[screenshots] sharp not available; skipping side-by-side')
    process.exit(0)
  }
  const sharp = sharpModule.default

  const dashImg = sharp(dashboardOut)
  const dashMeta = await dashImg.metadata()
  const refImg = sharp(DESIGN_REF)
  const refMeta = await refImg.metadata()

  // Scale both to a common height (1600px) preserving aspect ratio.
  const TARGET_H = 1600
  const dashScaledW = Math.round((dashMeta.width / dashMeta.height) * TARGET_H)
  const refScaledW = Math.round((refMeta.width / refMeta.height) * TARGET_H)
  const dashBuf = await sharp(dashboardOut)
    .resize({ height: TARGET_H, fit: 'contain', background: '#ffffff' })
    .toBuffer()
  const refBuf = await sharp(DESIGN_REF)
    .resize({ height: TARGET_H, fit: 'contain', background: '#ffffff' })
    .toBuffer()

  const totalW = dashScaledW + refScaledW + 40 // 40px gutter
  await sharp({
    create: {
      width: totalW,
      height: TARGET_H,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: dashBuf, left: 0, top: 0 },
      { input: refBuf, left: dashScaledW + 40, top: 0 },
    ])
    .png()
    .toFile(sideBySideOut)
  console.log(`[screenshots] stitched ${sideBySideOut}`)
}
