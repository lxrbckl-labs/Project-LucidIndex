/**
 * Phase 2 acceptance test — Settings → Targets CRUD.
 *
 * Walks the full target lifecycle through the UI:
 *
 *   1. Boot a fresh stack, claim founding admin (so the rest of /settings/*
 *      is authenticated). Founding flow already has its own dedicated smoke
 *      (`founding-admin.spec.ts`); this test re-uses it as a fixture rather
 *      than re-asserting every step.
 *   2. Seed exactly one prompt template directly in Postgres — the Templates
 *      panel (#34) hasn't shipped, so seeding via SQL mirrors the manual
 *      verification path called out in the ticket.
 *   3. /settings/targets renders the empty-state CTA.
 *   4. Click "Add your first target" → form renders with the seeded prompt
 *      template selectable.
 *   5. Submit → redirects to the list, the new row is visible.
 *   6. Pause the row → status flips to "Paused" without a navigation.
 *   7. Click Edit → form pre-populates → change the label → save → row
 *      reflects the new label.
 *
 * The 401 paths and the no-prompt-templates friendly notice are smaller
 * checks asserted directly via `request` calls, since they don't need a
 * full browser context.
 */

import { execFileSync } from 'node:child_process'
import { type APIRequestContext, expect, request, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { foundAdmin } from './support/found-admin'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('settings/targets CRUD: empty -> create -> pause -> edit, plus 401s and empty-template notice', async ({
  browser,
}) => {
  const baseURL = stack.baseURL

  // -----------------------------------------------------------------------
  // 0. Pre-asserts: unauthed API access returns 401.
  // -----------------------------------------------------------------------
  const anonReq: APIRequestContext = await request.newContext({ baseURL })
  for (const url of [
    '/api/settings/targets',
    '/api/settings/targets/00000000-0000-0000-0000-000000000000',
    '/api/settings/targets/00000000-0000-0000-0000-000000000000/active',
  ]) {
    const res = await anonReq.fetch(url, { method: url.endsWith('/active') ? 'POST' : 'GET' })
    expect(res.status(), `${url} should require auth`).toBe(401)
  }
  await anonReq.dispose()

  // -----------------------------------------------------------------------
  // 1. Claim founding admin — re-uses the founding-admin smoke fixture.
  // -----------------------------------------------------------------------
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  const auth = await foundAdmin(page)
  // foundAdmin lands on /settings signed in, but wait until /api/auth/session
  // reports ok so subsequent navigations don't race the cookie write.
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/auth/session')
        return r.status()
      },
      { timeout: 15_000 },
    )
    .toBe(200)

  // -----------------------------------------------------------------------
  // 2a. With ZERO prompt templates, /settings/targets/new shows the friendly
  //     notice and the form is disabled — no crash.
  // -----------------------------------------------------------------------
  await page.goto('/settings/targets/new')
  await expect(page.getByText(/Create a prompt template first/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create target' })).toBeDisabled()

  // -----------------------------------------------------------------------
  // 2b. Seed one prompt template directly in Postgres — the Templates panel
  //     hasn't shipped, so this is the explicit "seed via SQL" path the
  //     ticket calls out.
  // -----------------------------------------------------------------------
  execFileSync(
    'docker',
    [
      'exec',
      'lucidindex-e2e-postgres',
      'psql',
      '-U',
      'lucidindex',
      '-d',
      'lucidindex',
      '-c',
      "INSERT INTO prompt_templates (slug, body) VALUES ('news_brief', 'Summarize this article.');",
    ],
    { stdio: 'pipe' },
  )

  // -----------------------------------------------------------------------
  // 3. Empty-state on the list page.
  // -----------------------------------------------------------------------
  await page.goto('/settings/targets')
  await expect(page.getByRole('heading', { name: /^Targets$/ })).toBeVisible()
  await expect(page.getByText('No targets yet.')).toBeVisible()

  // -----------------------------------------------------------------------
  // 4. Create a target.
  // -----------------------------------------------------------------------
  await page.getByRole('link', { name: 'Add your first target' }).click()
  await expect(page).toHaveURL(/\/settings\/targets\/new/)
  await expect(page.locator('#label')).toBeVisible()
  await page.locator('#label').fill('Hacker News front page')
  await page.locator('#urlOrHandle').fill('https://news.ycombinator.com/rss')
  await page.locator('#cadence').selectOption('hourly')
  // promptTemplateId defaults to the only available option (news_brief).
  await page.getByRole('button', { name: 'Create target' }).click()

  // Land back on the list with the new row visible.
  await page.waitForURL(/\/settings\/targets$/, { timeout: 15_000 })
  await expect(page.getByText('Hacker News front page')).toBeVisible()
  await expect(page.getByText('https://news.ycombinator.com/rss')).toBeVisible()
  await expect(page.getByText('hourly').first()).toBeVisible()

  const row = page.locator('tr', { hasText: 'Hacker News front page' })
  await expect(row.getByText('Active')).toBeVisible()

  // -----------------------------------------------------------------------
  // 5. Pause the row.
  // -----------------------------------------------------------------------
  await row.getByRole('button', { name: 'Pause' }).click()
  await expect(row.getByText('Paused')).toBeVisible({ timeout: 10_000 })

  // -----------------------------------------------------------------------
  // 6. Edit the row — change the label, save, list reflects new label.
  // -----------------------------------------------------------------------
  await row.getByRole('link', { name: 'Edit' }).click()
  await expect(page).toHaveURL(/\/settings\/targets\/[0-9a-f-]{36}$/)
  await expect(page.locator('#label')).toHaveValue('Hacker News front page')
  await page.locator('#label').fill('HN front page (renamed)')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL(/\/settings\/targets$/, { timeout: 15_000 })
  await expect(page.getByText('HN front page (renamed)')).toBeVisible()

  await auth.cleanup()
  await ctx.close()
})
