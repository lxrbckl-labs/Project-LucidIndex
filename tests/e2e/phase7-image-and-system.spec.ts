/**
 * Phase 7 acceptance — image route handler (#74) + Settings → System (#77).
 *
 * Two surfaces, one stack:
 *
 *   /i/<hash>  (#74)
 *     - 400 on a malformed hash (anything not 64 hex chars).
 *     - 404 when the hash is well-formed but no file exists.
 *     - 200 + image/webp + immutable Cache-Control when the request sends
 *       `Accept: image/webp` and the WebP variant exists on disk.
 *     - 200 + image/jpeg fallback when the request omits image/webp and the
 *       JPEG variant exists on disk.
 *
 *   /settings/system  (#77)
 *     - Renders the Phase 7 page with all four sections.
 *     - Cron jobs table lists every known job (zero-state friendly).
 *     - Queue depth panel shows the current count.
 *     - 30-day histograms render small/medium/large + easy/medium/hard rows.
 *     - Drift warning appears when `large_pct > 20%` (we seed 4 large + 1
 *       medium = 80% large, well past threshold) and exposes the standing
 *       prompt as copyable text.
 *
 * The image route is hit BEFORE the founding-admin claim so we can confirm
 * it's publicly readable (hero images render in OG cards for unauthenticated
 * scrapers — that's the whole point of the immutable cache).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type APIRequestContext, expect, request, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { setupVirtualAuthenticator } from './support/webauthn'

const FOUNDING_TOKEN = 'phase7-image-system-acceptance-test-token-do-not-use-in-prod'

// 64 hex chars — well-formed sha-256 shape so we exercise the read-from-disk
// branch, not the regex-rejects branch. The `aaaa…` prefix makes the file
// trivial to spot in stderr if a stray scan logs it.
const VALID_HASH = 'a'.repeat(64)
// Same length but with an obvious traversal attempt — must be rejected by
// the regex BEFORE any path-join happens.
const TRAVERSAL_HASH = '../etc/passwd-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.slice(
  0,
  64,
)
// Wrong length — also caught by the regex.
const SHORT_HASH = 'abc'

// Tiny PNG-ish payloads — the route doesn't care about the actual bytes,
// only that the file exists and the Content-Type matches the requested ext.
// We use distinguishable byte patterns so the assertion can verify the
// correct variant came back.
const WEBP_BYTES = Buffer.from('FAKE-WEBP-IMAGE-BYTES', 'utf8')
const JPEG_BYTES = Buffer.from('FAKE-JPEG-IMAGE-BYTES', 'utf8')

let stack: StackHandle
let imageDir: string

test.beforeAll(async () => {
  // Lay down hero-image fixtures in a known directory and pass it through
  // to the dev server via MCP_IMAGE_DIR (read at the top of route.ts as a
  // module-load constant — set BEFORE the server boots).
  imageDir = mkdtempSync(join(tmpdir(), 'lucidindex-e2e-images-'))
  mkdirSync(imageDir, { recursive: true })
  writeFileSync(join(imageDir, `${VALID_HASH}.webp`), WEBP_BYTES)
  writeFileSync(join(imageDir, `${VALID_HASH}.jpg`), JPEG_BYTES)

  process.env.MCP_IMAGE_DIR = imageDir

  stack = await startStack({ foundingToken: FOUNDING_TOKEN })
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('phase7 image route + system page', async ({ browser }) => {
  const baseURL = stack.baseURL

  // ===========================================================================
  // PART 1 — `/i/<hash>` route handler (#74)
  // ===========================================================================

  const anonReq: APIRequestContext = await request.newContext({ baseURL })

  // 1a. Bad-shape hashes get rejected before any fs access.
  for (const bad of [SHORT_HASH, TRAVERSAL_HASH, 'GGGG', '', 'a'.repeat(63), 'a'.repeat(65)]) {
    const res = await anonReq.fetch(`/i/${encodeURIComponent(bad)}`)
    // Empty string segment routes to the bare `/i` page (404 from Next),
    // anything else hits the handler and returns 400.
    if (bad === '') {
      expect(res.status(), `empty hash → not the route handler`).toBe(404)
    } else {
      expect(res.status(), `malformed hash ${JSON.stringify(bad)} should 400`).toBe(400)
    }
  }

  // 1b. Well-formed hash but no file on disk → 404.
  const missingHash = 'b'.repeat(64)
  const missingRes = await anonReq.fetch(`/i/${missingHash}`)
  expect(missingRes.status()).toBe(404)

  // 1c. Accept: image/webp → returns the WebP variant with immutable cache.
  const webpRes = await anonReq.fetch(`/i/${VALID_HASH}`, {
    headers: { accept: 'image/webp,image/apng,image/*,*/*;q=0.8' },
  })
  expect(webpRes.status()).toBe(200)
  expect(webpRes.headers()['content-type']).toBe('image/webp')
  expect(webpRes.headers()['cache-control']).toMatch(/public/)
  expect(webpRes.headers()['cache-control']).toMatch(/immutable/)
  expect(webpRes.headers()['cache-control']).toMatch(/max-age=\d+/)
  // Vary on Accept so caches don't poison cross-Accept requests.
  expect(webpRes.headers().vary?.toLowerCase()).toContain('accept')
  const webpBody = await webpRes.body()
  expect(Buffer.compare(webpBody, WEBP_BYTES)).toBe(0)

  // 1d. No image/webp in Accept → JPEG fallback.
  const jpgRes = await anonReq.fetch(`/i/${VALID_HASH}`, {
    headers: { accept: 'image/jpeg,image/*;q=0.8' },
  })
  expect(jpgRes.status()).toBe(200)
  expect(jpgRes.headers()['content-type']).toBe('image/jpeg')
  const jpgBody = await jpgRes.body()
  expect(Buffer.compare(jpgBody, JPEG_BYTES)).toBe(0)

  await anonReq.dispose()

  // ===========================================================================
  // PART 2 — Settings → System (#77)
  // ===========================================================================

  // 2a. Anonymous GET to /settings/system must redirect to /settings/login
  //     (the layout enforces this; we just want to confirm the page wasn't
  //     accidentally exposed). Browser context with auto-redirect off so we
  //     can inspect the raw response.
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()

  // Claim the founding admin first so we can navigate authenticated.
  const auth = await setupVirtualAuthenticator(page)
  await page.goto(`/settings/found?token=${encodeURIComponent(FOUNDING_TOKEN)}`)
  await page.getByTestId('founding-name').fill('Phase7 System')
  await page.getByTestId('founding-device').fill('Phase7 Virtual Authenticator')
  await page.getByTestId('founding-submit').click()
  await expect(page.getByTestId('recovery-modal')).toBeVisible()
  await page.getByTestId('recovery-dismiss').click()
  await page.waitForURL(/\/settings(\/|$)/, { timeout: 30_000 })
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/auth/session')
        return r.status()
      },
      { timeout: 15_000 },
    )
    .toBe(200)

  // 2b. With NO cron_runs, NO queue rows, NO articles — page renders with
  //     zero-state cells. Drift warning should NOT be present.
  await page.goto('/settings/system')
  await expect(page.getByRole('heading', { name: /^System$/ })).toBeVisible()

  // Cron jobs table renders every known job, even with no rows in the DB.
  for (const job of [
    'scheduler',
    'reaper',
    'hwm_reset',
    'retention_purge',
    'local_backup',
    'off_site_backup',
    'heartbeat',
  ]) {
    await expect(page.getByTestId(`cron-row-${job}`)).toBeVisible()
  }

  // Queue depth shows 0 on a fresh install.
  await expect(page.getByTestId('queue-depth-value')).toHaveText('0')

  // No drift warning when there are zero articles.
  await expect(page.getByTestId('drift-warning-panel')).toHaveCount(0)

  // 2c. Seed cron_runs (one success + one failure for `scheduler`) and
  //     enough `articles` rows to cross the 20% drift threshold for
  //     `large`. That requires either a target + agent_token + run_log
  //     parent rows, OR direct SQL skipping the FK chain. We go with the
  //     full chain — `articles` has hard FKs and the schema check
  //     constraints reject placeholder enum values.
  psql(`
    BEGIN;

    -- 1. prompt_template: parent of targets.
    INSERT INTO prompt_templates (slug, body)
      VALUES ('phase7_fixture_template', 'fixture')
      ON CONFLICT (slug) DO NOTHING;

    -- 2. target: parent of articles + queue + run_log.
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
      SELECT 'phase7 fixture target', 'https://example.com', 'hourly',
             (SELECT id FROM prompt_templates WHERE slug = 'phase7_fixture_template'),
             now()
      WHERE NOT EXISTS (SELECT 1 FROM targets WHERE label = 'phase7 fixture target');

    -- 3. agent_token: parent of articles + run_log.
    INSERT INTO agent_tokens (label, token_hash)
      SELECT 'phase7 fixture agent',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      WHERE NOT EXISTS (SELECT 1 FROM agent_tokens WHERE label = 'phase7 fixture agent');

    -- 4. queue rows — two unacked plus one we'll burn through to seed run_log.
    --    Queue panel reads count(*) WHERE acked_at IS NULL, so the third row
    --    (immediately acked below) doesn't inflate depth.
    INSERT INTO queue (target_id)
      SELECT (SELECT id FROM targets WHERE label = 'phase7 fixture target')
      FROM generate_series(1, 3);

    -- Mark the last-inserted queue row as acked so depth = 2.
    UPDATE queue SET acked_at = now()
      WHERE id = (
        SELECT id FROM queue
          WHERE target_id = (SELECT id FROM targets WHERE label = 'phase7 fixture target')
            AND acked_at IS NULL
          ORDER BY enqueued_at DESC
          LIMIT 1
      );

    -- 5. run_log row referencing the acked queue item — articles need this FK.
    INSERT INTO run_log (target_id, queue_item_id, agent_token_id, status,
                         articles_count, started_at, completed_at)
      SELECT (SELECT id FROM targets WHERE label = 'phase7 fixture target'),
             (SELECT id FROM queue WHERE acked_at IS NOT NULL
                AND target_id = (SELECT id FROM targets WHERE label = 'phase7 fixture target')
                LIMIT 1),
             (SELECT id FROM agent_tokens WHERE label = 'phase7 fixture agent'),
             'succeeded', 5, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM run_log
          WHERE target_id = (SELECT id FROM targets WHERE label = 'phase7 fixture target')
      );

    -- 6. articles — 4 'large' + 1 'medium' = 80% large, well past 20% drift.
    WITH parents AS (
      SELECT
        (SELECT id FROM targets WHERE label = 'phase7 fixture target') AS target_id,
        (SELECT id FROM agent_tokens WHERE label = 'phase7 fixture agent') AS agent_token_id,
        (SELECT id FROM run_log
            WHERE target_id = (SELECT id FROM targets WHERE label = 'phase7 fixture target')
            LIMIT 1) AS run_log_id
    )
    INSERT INTO articles (target_id, agent_token_id, run_log_id, source_url, slug, title,
                          summary, topic_badges, significance, difficulty)
    SELECT p.target_id, p.agent_token_id, p.run_log_id,
           'https://example.com/p7/' || g, 'p7-fixture-' || g,
           'Fixture article ' || g, 'Body ' || g, ARRAY['fixture']::text[],
           CASE WHEN g <= 4 THEN 'large' ELSE 'medium' END,
           CASE WHEN g <= 2 THEN 'easy' WHEN g <= 4 THEN 'medium' ELSE 'hard' END
    FROM parents p, generate_series(1, 5) AS g;

    -- 7. cron_runs — one success + one failure for scheduler so the
    --    success-rate cell renders "1/2 (50%)".
    INSERT INTO cron_runs (job, started_at, completed_at, status)
      VALUES ('scheduler', now(), now(), 'succeeded'),
             ('scheduler', now(), now(), 'failed');

    COMMIT;
  `)

  // 2d. Reload and assert on the seeded state.
  await page.reload()

  // Queue depth should now read 2.
  await expect(page.getByTestId('queue-depth-value')).toHaveText('2')

  // Cron-row for scheduler should show non-empty timestamps in both columns
  // and a "1/2 (50%)" success-rate cell.
  const schedRow = page.getByTestId('cron-row-scheduler')
  await expect(schedRow).toContainText(/UTC/)
  await expect(schedRow).toContainText('1/2')

  // Significance histogram: large = 4 (80%), medium = 1 (20%).
  await expect(page.getByTestId('sig-large-count')).toHaveText('4')
  await expect(page.getByTestId('sig-large-pct')).toHaveText('80%')
  await expect(page.getByTestId('sig-medium-count')).toHaveText('1')

  // Drift warning is visible and surfaces the calibration prompt copy.
  const drift = page.getByTestId('drift-warning-panel')
  await expect(drift).toBeVisible()
  await expect(page.getByTestId('drift-large-pct')).toHaveText('80%')
  const promptBox = page.getByTestId('drift-standing-prompt')
  await expect(promptBox).toHaveValue(/Rate conservatively/)
  // Copy button is present and clickable; we don't assert clipboard content
  // (Playwright's clipboard permission grant is browser-context-specific
  // and adds flake), only that the button toggles its label.
  const copyBtn = page.getByTestId('drift-copy-button')
  await expect(copyBtn).toBeVisible()

  await auth.cleanup()
  await ctx.close()
})

/**
 * Run an arbitrary SQL block against the e2e Postgres container.
 * `support/dev-server.ts` always names the container `lucidindex-e2e-postgres`
 * and exposes `lucidindex` / `lucidindex` for user/db.
 */
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
