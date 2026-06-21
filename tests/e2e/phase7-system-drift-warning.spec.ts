/**
 * Phase 7 — Settings → System drift warning e2e spec.
 *
 * Covers tests 20–21 from the Phase 6+7 coverage assignment:
 *  20. No drift warning when large% < 20% — claim admin, insert 9 medium +
 *      1 large article (10% large). Visit Settings → System. Assert NO
 *      drift-warning-panel.
 *  21. Drift warning fires at >20% large — insert 4 more large articles
 *      (so 5 large / 13 total ≈ 38%). Reload. Assert warning copy +
 *      copyable standing prompt.
 *
 * Requires a real DB (Postgres container via startStack).
 *
 * NOTE: The existing `phase7-image-and-system.spec.ts` tests the System
 * page at 80% large (4 large / 5 total). This spec uses a different
 * founding token and a separate batch of articles so there is no
 * interference. Each spec gets its own DB container (startStack removes
 * + recreates `lucidindex-e2e-postgres` on beforeAll), so the two specs
 * don't collide as long as they run sequentially (which they do — workers=1).
 */

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { foundAdmin } from './support/found-admin'

// ── SQL helpers ───────────────────────────────────────────────────────────────

function psql(sql: string): void {
  execFileSync(
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
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, stdio: ['pipe', 'pipe', 'inherit'] },
  )
}

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

test('20–21. drift warning absent at 10% large; fires at ~38% large', async ({ browser }) => {
  const { baseURL } = stack

  // ── Claim founding admin ──────────────────────────────────────────────────
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

  // ── Seed prerequisite rows (prompt_template + target + agent_token + run_log)
  psql(`
    BEGIN;

    INSERT INTO prompt_templates (slug, body)
      VALUES ('p7_drift_tmpl', 'fixture')
      ON CONFLICT (slug) DO NOTHING;

    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
      SELECT 'p7 drift target', 'https://example.com/drift', 'hourly',
             (SELECT id FROM prompt_templates WHERE slug = 'p7_drift_tmpl'),
             now()
      WHERE NOT EXISTS (SELECT 1 FROM targets WHERE label = 'p7 drift target');

    INSERT INTO agent_tokens (label, token_hash)
      SELECT 'p7 drift agent',
             'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      WHERE NOT EXISTS (SELECT 1 FROM agent_tokens WHERE label = 'p7 drift agent');

    -- queue row (acked) so run_log can reference it
    INSERT INTO queue (target_id, acked_at)
      SELECT (SELECT id FROM targets WHERE label = 'p7 drift target'), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM queue
        WHERE target_id = (SELECT id FROM targets WHERE label = 'p7 drift target')
      );

    -- run_log row
    INSERT INTO run_log (target_id, queue_item_id, agent_token_id, status,
                         articles_count, started_at, completed_at)
      SELECT
        (SELECT id FROM targets WHERE label = 'p7 drift target'),
        (SELECT id FROM queue WHERE target_id =
           (SELECT id FROM targets WHERE label = 'p7 drift target') LIMIT 1),
        (SELECT id FROM agent_tokens WHERE label = 'p7 drift agent'),
        'succeeded', 10, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM run_log
        WHERE target_id = (SELECT id FROM targets WHERE label = 'p7 drift target')
      );

    COMMIT;
  `)

  // ── Test 20: 9 medium + 1 large → 10% large, NO drift warning ────────────
  psql(`
    WITH parents AS (
      SELECT
        (SELECT id FROM targets WHERE label = 'p7 drift target') AS target_id,
        (SELECT id FROM agent_tokens WHERE label = 'p7 drift agent') AS agent_token_id,
        (SELECT id FROM run_log
           WHERE target_id = (SELECT id FROM targets WHERE label = 'p7 drift target')
           LIMIT 1) AS run_log_id
    )
    INSERT INTO articles (target_id, agent_token_id, run_log_id, source_url, slug, title,
                          summary, topic_badges, significance, difficulty)
    SELECT p.target_id, p.agent_token_id, p.run_log_id,
           'https://example.com/drift/' || g,
           'p7-drift-article-' || g,
           'Drift fixture ' || g,
           'Summary ' || g,
           ARRAY['DRIFT']::text[],
           CASE WHEN g = 1 THEN 'large' ELSE 'medium' END,
           'easy'
    FROM parents p, generate_series(1, 10) AS g;
  `)

  await page.goto('/settings/system')
  await expect(page.getByRole('heading', { name: /^System$/ })).toBeVisible()

  // With 1 large / 10 total = 10% large, drift warning must be absent.
  await expect(page.getByTestId('drift-warning-panel')).toHaveCount(0)

  // ── Test 21: add 4 more large articles → 5/13 ≈ 38% large ────────────────
  // Insert 3 more articles (to reach 13 total): all 'large'.
  // Current: 10 articles (1 large). Adding 3 more large → 4 large / 13 total ≈ 31%.
  // Actually we need 5 large out of 13: insert 4 more large = 5 large total,
  // 13 total. 5/13 ≈ 38.5% > 20%.
  psql(`
    WITH parents AS (
      SELECT
        (SELECT id FROM targets WHERE label = 'p7 drift target') AS target_id,
        (SELECT id FROM agent_tokens WHERE label = 'p7 drift agent') AS agent_token_id,
        (SELECT id FROM run_log
           WHERE target_id = (SELECT id FROM targets WHERE label = 'p7 drift target')
           LIMIT 1) AS run_log_id
    )
    INSERT INTO articles (target_id, agent_token_id, run_log_id, source_url, slug, title,
                          summary, topic_badges, significance, difficulty)
    SELECT p.target_id, p.agent_token_id, p.run_log_id,
           'https://example.com/drift/extra-' || g,
           'p7-drift-extra-' || g,
           'Drift extra large ' || g,
           'Summary extra ' || g,
           ARRAY['DRIFT']::text[],
           'large',
           'hard'
    FROM parents p, generate_series(1, 4) AS g;
  `)

  // Reload the system page to pick up the newly inserted articles.
  await page.reload()

  // 5 large / 14 total ≈ 35.7% — above the 20% threshold.
  // drift-warning-panel should now be visible.
  const drift = page.getByTestId('drift-warning-panel')
  await expect(drift).toBeVisible({ timeout: 15_000 })

  // The large_pct display should be > 20%
  const largePct = page.getByTestId('drift-large-pct')
  await expect(largePct).toBeVisible()
  const pctText = await largePct.textContent()
  const pctNum = Number.parseFloat(pctText?.replace('%', '') ?? '0')
  expect(pctNum).toBeGreaterThan(20)

  // The standing prompt textarea is present and readable
  const promptBox = page.getByTestId('drift-standing-prompt')
  await expect(promptBox).toBeVisible()
  const promptValue = await promptBox.inputValue()
  expect(promptValue.length).toBeGreaterThan(10)

  // Copy button is present
  await expect(page.getByTestId('drift-copy-button')).toBeVisible()

  await auth.cleanup()
  await ctx.close()
})
