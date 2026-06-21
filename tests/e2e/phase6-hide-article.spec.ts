/**
 * Phase 6 — Hide / restore article flow e2e spec.
 *
 * Covers test 13 from the Phase 6+7 coverage assignment:
 *  13. Full hide flow:
 *      - Claim founding admin.
 *      - Insert an article via direct SQL.
 *      - Settings → Hidden articles shows empty state.
 *      - Visit /a/<slug> (admin session) and click "Hide article".
 *      - Redirected to /.
 *      - /a/<slug> now 404s.
 *      - Settings → Hidden articles lists the hidden article.
 *      - Click Restore → article reappears at /a/<slug>.
 *
 * Requires a real DB (Postgres container via startStack). The hide
 * action does a real `UPDATE articles SET hidden = true` — no mock
 * shortcut because we need to test the server-action + loader round
 * trip.
 *
 * Port strategy: reuses the shared `startStack` which defaults to
 * PG port 5440 and web port 3401. The container name is
 * `lucidindex-e2e-postgres` — same as all other real-DB specs.
 * Playwright's `workers: 1` ensures specs run sequentially.
 */

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { foundAdmin } from './support/found-admin'

// ── SQL helpers ───────────────────────────────────────────────────────────────

/**
 * Run SQL against the e2e Postgres container (lucidindex-e2e-postgres).
 * Returns captured stdout (data rows only — command tags filtered out).
 */
function psql(sql: string): string {
  const out = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'lucidindex-e2e-postgres',
      'psql',
      '-U',
      'lucidindex',
      '-d',
      'lucidindex',
      '-At',
      '-q',
      '-c',
      sql,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const COMMAND_TAG_RX = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|SELECT \d+)$/
  return out
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !COMMAND_TAG_RX.test(line))
    .join('\n')
    .trim()
}

// ── Test data ─────────────────────────────────────────────────────────────────

// Stable fixture values for the article we'll insert + hide.
const ARTICLE_SLUG = 'p6-hide-test-article-2026-04-26'
const ARTICLE_TITLE = 'Phase6 Hide Test Article'
const ARTICLE_SOURCE_URL = 'https://example.com/phase6-hide-test'

// ── Spec ──────────────────────────────────────────────────────────────────────

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('13. hide flow: insert article → hide from article page → 404 → restore', async ({
  browser,
}) => {
  const { baseURL } = stack

  // ── Step 0: seed parent rows + insert the article ─────────────────────────
  //
  // articles has FKs to: prompt_templates → targets, agent_tokens, run_log.
  // We insert the full chain using ON CONFLICT so re-runs are safe.
  psql(`
    INSERT INTO prompt_templates (slug, body)
      VALUES ('p6_hide_fixture', 'fixture body')
      ON CONFLICT (slug) DO NOTHING;
  `)
  psql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
      SELECT 'p6 hide fixture target', '${ARTICLE_SOURCE_URL}', 'hourly',
             (SELECT id FROM prompt_templates WHERE slug = 'p6_hide_fixture'),
             now()
      WHERE NOT EXISTS (SELECT 1 FROM targets WHERE label = 'p6 hide fixture target');
  `)
  psql(`
    INSERT INTO agent_tokens (label, token_hash)
      SELECT 'p6 hide fixture agent',
             'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      WHERE NOT EXISTS (SELECT 1 FROM agent_tokens WHERE label = 'p6 hide fixture agent');
  `)
  // queue row (acked — needed so run_log can reference it)
  psql(`
    INSERT INTO queue (target_id, acked_at)
      SELECT (SELECT id FROM targets WHERE label = 'p6 hide fixture target'), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM queue
        WHERE target_id = (SELECT id FROM targets WHERE label = 'p6 hide fixture target')
      );
  `)
  // run_log row
  psql(`
    INSERT INTO run_log (target_id, queue_item_id, agent_token_id, status,
                         articles_count, started_at, completed_at)
      SELECT
        (SELECT id FROM targets WHERE label = 'p6 hide fixture target'),
        (SELECT id FROM queue WHERE target_id =
           (SELECT id FROM targets WHERE label = 'p6 hide fixture target') LIMIT 1),
        (SELECT id FROM agent_tokens WHERE label = 'p6 hide fixture agent'),
        'succeeded', 1, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM run_log
        WHERE target_id = (SELECT id FROM targets WHERE label = 'p6 hide fixture target')
      );
  `)
  // Finally, insert the article itself (idempotent on slug unique constraint)
  psql(`
    INSERT INTO articles
      (target_id, agent_token_id, run_log_id, source_url, slug, title,
       summary, topic_badges, significance, difficulty)
    SELECT
      (SELECT id FROM targets WHERE label = 'p6 hide fixture target'),
      (SELECT id FROM agent_tokens WHERE label = 'p6 hide fixture agent'),
      (SELECT id FROM run_log
         WHERE target_id = (SELECT id FROM targets WHERE label = 'p6 hide fixture target') LIMIT 1),
      '${ARTICLE_SOURCE_URL}',
      '${ARTICLE_SLUG}',
      '${ARTICLE_TITLE}',
      'A fixture article for the Phase 6 hide/restore e2e test.',
      ARRAY['TEST']::text[],
      'small',
      'easy'
    ON CONFLICT (slug) DO NOTHING;
  `)

  // ── Step 1: claim founding admin ──────────────────────────────────────────
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  const auth = await foundAdmin(page)
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/auth/session')
        return r.status()
      },
      { timeout: 15_000 },
    )
    .toBe(200)

  // ── Step 2: Settings → Hidden articles shows empty state ──────────────────
  await page.goto('/settings/hidden-articles')
  await expect(page.getByTestId('hidden-articles-empty')).toBeVisible()

  // ── Step 3: visit the article page and click "Hide article" ───────────────
  await page.goto(`/a/${ARTICLE_SLUG}`)
  await expect(page.locator('article h1')).toContainText(ARTICLE_TITLE)

  // HideArticleButton renders for authenticated admin. It opens a confirm
  // dialog — we must accept it via Playwright's dialog handler.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /hide article/i }).click()

  // ── Step 4: redirected to / ────────────────────────────────────────────────
  await page.waitForURL('/', { timeout: 15_000 })

  // ── Step 5: /a/<slug> now 404s ────────────────────────────────────────────
  const hiddenRes = await page.goto(`/a/${ARTICLE_SLUG}`)
  expect(hiddenRes?.status()).toBe(404)
  await expect(page.getByText(/isn't available/i)).toBeVisible()

  // ── Step 6: Settings → Hidden articles lists the article ──────────────────
  await page.goto('/settings/hidden-articles')
  await expect(page.getByTestId('hidden-articles-table')).toBeVisible()
  // The table should contain a row with our article title
  await expect(
    page.locator('[data-testid="hidden-article-row"]').filter({
      hasText: ARTICLE_TITLE,
    }),
  ).toBeVisible()

  // ── Step 7: click Restore → article reappears ─────────────────────────────
  // RestoreButton is a form submit or action button inside the row.
  const row = page.locator('[data-testid="hidden-article-row"]').filter({
    hasText: ARTICLE_TITLE,
  })
  await row.getByRole('button', { name: /restore/i }).click()

  // After restore, the row should disappear from the hidden list.
  await expect
    .poll(
      async () => {
        // Either the table is gone (empty) or our row is gone.
        const rowCount = await page
          .locator('[data-testid="hidden-article-row"]')
          .filter({
            hasText: ARTICLE_TITLE,
          })
          .count()
        return rowCount
      },
      { timeout: 15_000 },
    )
    .toBe(0)

  // The article page should be reachable again.
  const restoredRes = await page.goto(`/a/${ARTICLE_SLUG}`)
  expect(restoredRes?.status()).toBe(200)
  await expect(page.locator('article h1')).toContainText(ARTICLE_TITLE)

  await auth.cleanup()
  await ctx.close()
})
