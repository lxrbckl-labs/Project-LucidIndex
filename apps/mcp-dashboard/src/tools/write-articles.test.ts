/**
 * Tests for `write_articles` — the most consequential mutation on the
 * dashboard MCP surface.
 *
 * These cover the five paths surfaced by the round-3 regression audit:
 *
 *   1. Happy path  — fresh insert returns `{ id, deduped: false }`.
 *   2. Dedup       — re-insert of an existing `(target_id, source_url)`
 *                    returns `{ id, deduped: true }` with the existing id.
 *   3. Slug retry  — same date+title from a different source_url collides
 *                    on the slug-unique constraint and retries with
 *                    `disambiguate(slug, source_url)`; the second insert
 *                    succeeds.
 *   4. Strict-mode badge reject — an unknown topic badge under
 *                    `strict_mode = true` rejects the call with the
 *                    `unknown_topic_badge` error code.
 *   5. Unknown-badge upsert (default mode) — the article inserts and a
 *                    row appears in `topic_badge_suggestions`. After
 *                    task 4 of this audit, the suggestion is ONLY
 *                    attributed to genuinely-inserted articles (not
 *                    dedup'd ones).
 *
 * STATUS: SKIPPED.
 *
 * Why: write_articles is a deep transactional path that touches articles,
 * topic_badges, topic_badge_suggestions, comparison_sources, run_log,
 * queue, and (for the hero-image path) the on-disk image store. There is
 * no in-memory drizzle adapter in this workspace today. Writing a
 * useful test requires one of:
 *
 *   (a) A live throwaway Postgres (DATABASE_URL_TEST) with a per-test
 *       reset hook — same shape as the existing docker-compose smoke
 *       harness, but inverted to run from `vitest`.
 *   (b) A mock/stub layer over @lucidindex/db/client + the dedup helper
 *       + fetchAndStoreHeroImage that lets the test simulate the queue
 *       row, settings row, topic_badges rows, and dedup outcomes
 *       without a real DB.
 *
 * UPDATE (audit round 9): the harness landed —
 * `@lucidindex/db/test-helpers` exports `makeTestDb()`,
 * `resolveTestDatabaseUrl()`, and `truncateAllTables()`. See
 * `check-article-exists.test.ts` for the working pattern. This file
 * stays SKIPPED only because write_articles touches enough tables
 * (articles, topic_badges, topic_badge_suggestions,
 * comparison_sources, run_log, queue, settings, plus the hero-image
 * pipeline) that the fixture work is substantial — out of scope for
 * round 9. The next round can copy the bootstrap shape from
 * check-article-exists.test.ts verbatim and start un-skipping cases.
 *
 * AUDIT ROUND 3 ADDITIONS to cover when the DB harness lands:
 *   6. URL-normalization: a write with the canonical/non-canonical
 *      variants of the same URL produces the same article id; the second
 *      call returns `deduped: true`.
 *   7. Per-article savepoint: a batch with one good + one bad article
 *      (e.g. URL parse failure or unique-violation on retry) leaves the
 *      good article inserted and surfaces the bad one in `failures` —
 *      `accepted: 1`, `failures.length: 1`.
 *   8. Hero-fetch is in Pass 2 (parallel, outside the txn): mock
 *      `fetchAndStoreHeroImage` to assert it was called BEFORE the
 *      txn began (e.g. by recording the call order against a DB row's
 *      insert timestamp).
 *   9. Nullable suggestion attribution: a batch where EVERY article
 *      carrying an unknown badge is deduped still results in a
 *      `topic_badge_suggestions` row with `article_id IS NULL` (count
 *      bumps on subsequent sightings).
 */

import { describe, it } from 'vitest'

describe.skip('writeArticles', () => {
  // ------------------------------------------------------------------------
  // 1. Happy path: fresh insert
  // ------------------------------------------------------------------------
  it('inserts a fresh article and returns { id, deduped: false }', async () => {
    // TODO(next round): seed queue + target, call writeArticles with one
    // article carrying a brand-new source_url. Assert:
    //   - result.accepted === 1
    //   - result.results[0].deduped === false
    //   - result.results[0].id is a uuid
    //   - articles row exists with the expected slug + source_url
    //   - run_log row exists with articles_count = 1
  })

  // ------------------------------------------------------------------------
  // 2. Dedup: re-insert returns deduped: true with the existing id
  // ------------------------------------------------------------------------
  it('returns deduped: true with the existing id on re-insert of (target_id, source_url)', async () => {
    // TODO(next round): seed an existing article for (target_id, source_url).
    // Call writeArticles with the same pair. Assert:
    //   - result.results[0].deduped === true
    //   - result.results[0].id === <existing article id>
    //   - no new articles row was inserted
    //   - hero image fetch is NOT attempted (the audit task 3 fix —
    //     fetchAndStoreHeroImage should be a sinon spy that records 0 calls).
  })

  // ------------------------------------------------------------------------
  // 3. Slug collision: retry with the source-URL disambiguator
  // ------------------------------------------------------------------------
  it('retries the insert with disambiguate(slug, source_url) on slug-unique collision', async () => {
    // TODO(next round): seed an existing article that occupies the primary
    // slug `YYYY-MM-DD-<kebab-title>`. Call writeArticles with a DIFFERENT
    // source_url but the same date + title. Assert:
    //   - result.results[0].deduped === false (it inserted)
    //   - the inserted article's slug ends with a 6-char hex suffix
    //     (the disambiguate() output)
    //   - both articles still exist in the table
  })

  // ------------------------------------------------------------------------
  // 4. Strict-mode badge reject
  // ------------------------------------------------------------------------
  it('rejects with unknown_topic_badge when strict_mode is on and a badge is missing', async () => {
    // TODO(next round): set settings.strict_mode = true. Call writeArticles
    // with topic_badges = ['definitely-not-a-known-badge']. Assert:
    //   - throws ToolError
    //   - error.code === 'unknown_topic_badge'
    //   - error.message names the missing badge
    //   - NO article was inserted (transactional all-or-nothing)
    //   - NO row in topic_badge_suggestions
  })

  // ------------------------------------------------------------------------
  // 5. Unknown-badge upsert (default mode)
  // ------------------------------------------------------------------------
  it('inserts the article and adds a topic_badge_suggestions row when default-mode encounters an unknown badge', async () => {
    // TODO(next round): leave settings.strict_mode = false. Call
    // writeArticles with topic_badges = ['novel-badge']. Assert:
    //   - article is inserted
    //   - topic_badge_suggestions has one row { name: 'novel-badge', count: 1 }
    //   - row.article_id === <inserted article id>
    //
    // ADDITIONAL coverage for the audit task-4 fix — only inserted articles
    // get attributed:
    //   - Call again with two articles in one batch where the FIRST is a
    //     dedup of an existing source_url that already carries 'novel-badge',
    //     and the SECOND is a genuinely-new insert that also carries
    //     'novel-badge'. Assert the suggestion row's article_id is the
    //     SECOND (inserted) article's id, NOT the first (deduped) one.
    //
    //   - Edge case: if EVERY article carrying an unknown badge is deduped
    //     in this batch, no new suggestion row is created (count is NOT
    //     incremented). The badge's original-introducer attribution lives
    //     on its own write call; we don't double-count here.
  })
})
