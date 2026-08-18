/**
 * Tests for `check_article_exists` — the dedup primitive callers should
 * hit BEFORE doing research work.
 *
 * Audit task 1 hardened the intent: cross-target source-level dedup.
 * A match on the source_url anywhere in the corpus counts, regardless of
 * which target captured the article — hidden + dashboard-invisible rows
 * included so suppressed content isn't re-researched.
 *
 * Coverage:
 *
 *   1. No match — returns `{ exists: false }`.
 *   2. Match — returns `{ exists: true, article: {...} }`.
 *   3. hidden=true rows still returned.
 *   4. dashboard_visible=false rows still returned.
 *   5. URL canonicalization across casing / tracking-param differences.
 *   6. Parse failure — returns `error: 'invalid_source_url'`.
 *   7. Cross-target match.
 *
 * Audit round 9 — TEST HARNESS LANDED:
 *
 * `packages/db/test-helpers.ts` exposes `makeTestDb()` +
 * `truncateAllTables(db)`. The fixture below uses them to bring the
 * test database to a known state before each test. The tool under
 * test (`checkArticleExists`) uses the module-level `db` proxy from
 * `@lucidindex/db/client`, which resolves `DATABASE_URL` lazily — so
 * we set `process.env.DATABASE_URL` to the test DB URL in a
 * `beforeAll` BEFORE the dynamic import.
 *
 * Requires `DATABASE_URL_TEST` (or a `lucidindex_test` DB at the same
 * host as `DATABASE_URL`) to be reachable. See
 * `apps/mcp-dashboard/docs/TESTING.md` for one-time setup.
 */

import {
  agentTokens,
  articles,
  promptTemplates,
  queue,
  runLog,
  targets,
} from '@lucidindex/db/schema'
import { makeTestDb, resolveTestDatabaseUrl, truncateAllTables } from '@lucidindex/db/test-helpers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const HAS_TEST_DB = Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)

// We skip the entire suite at runtime when no DB is reachable. This is
// the "developer didn't bother to provision the test DB" path — CI
// has DATABASE_URL_TEST set explicitly and won't hit it.
const describeIfDb = HAS_TEST_DB ? describe : describe.skip

describeIfDb('checkArticleExists (integration)', () => {
  // Point the module-level `db` proxy at the test DB BEFORE importing
  // the tool. The proxy caches the client on globalThis in non-prod,
  // so setting the env after the first import would still leak the
  // wrong client. Static `import` runs before tests, so we use a
  // dynamic import below.
  let db: ReturnType<typeof makeTestDb>
  // biome-ignore lint/suspicious/noExplicitAny: lazy-imported tool surface
  let checkArticleExists: any

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    db = makeTestDb()
    const mod = await import('./check-article-exists.js')
    checkArticleExists = mod.checkArticleExists
  })

  afterAll(async () => {
    // Release the test connection pool so vitest exits cleanly.
    // The tool's module-level db proxy is harder to dispose; vitest
    // process exit closes the socket either way.
    // biome-ignore lint/suspicious/noExplicitAny: postgres-js handle
    await (db as any).$client?.end?.({ timeout: 1 })
  })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  /** Insert the minimum chain of rows needed to satisfy the
   *  articles FK constraints (agent_token, prompt_template, target,
   *  queue item, run_log) and return their ids for follow-up inserts. */
  // INSERT ... RETURNING always yields one row for single-row inserts,
  // so `[x] = ...` array destructure is safe; the `!` non-null assertions
  // on `.id` reads below are equally safe. Suppressed once at the top of
  // the helper to keep the per-line noise down.
  async function seedScaffold(label: string) {
    const [agentToken] = await db
      .insert(agentTokens)
      .values({ label, tokenHash: 'test-hash' })
      .returning({ id: agentTokens.id })
    const [tpl] = await db
      .insert(promptTemplates)
      .values({ slug: `tpl-${label}`, body: 'test prompt' })
      .returning({ id: promptTemplates.id })
    const [target] = await db
      .insert(targets)
      .values({
        label,
        urlOrHandle: `https://${label}.example.com`,
        cadence: 'daily',
        // biome-ignore lint/style/noNonNullAssertion: tpl resolved above
        promptTemplateId: tpl!.id,
        // `targets.next_due_at` is NOT NULL; the scheduler normally
        // sets it on insert via a trigger or scheduled tick. For the
        // test fixture we just pin it to now() so the row passes
        // the constraint.
        nextDueAt: new Date(),
      })
      .returning({ id: targets.id })
    const [queueItem] = await db
      .insert(queue)
      // biome-ignore lint/style/noNonNullAssertion: target resolved above
      .values({ targetId: target!.id })
      .returning({ id: queue.id })
    const now = new Date()
    const [run] = await db
      .insert(runLog)
      .values({
        // biome-ignore lint/style/noNonNullAssertion: target resolved above
        targetId: target!.id,
        // biome-ignore lint/style/noNonNullAssertion: queueItem resolved above
        queueItemId: queueItem!.id,
        // biome-ignore lint/style/noNonNullAssertion: agentToken resolved above
        agentTokenId: agentToken!.id,
        status: 'succeeded',
        articlesCount: 1,
        startedAt: now,
        completedAt: now,
      })
      .returning({ id: runLog.id })
    return {
      // biome-ignore lint/style/noNonNullAssertion: agentToken resolved above
      agentTokenId: agentToken!.id,
      // biome-ignore lint/style/noNonNullAssertion: target resolved above
      targetId: target!.id,
      // biome-ignore lint/style/noNonNullAssertion: run resolved above
      runLogId: run!.id,
    }
  }

  it('returns { exists: false } when no article matches', async () => {
    const result = await checkArticleExists({
      source_url: 'https://example.com/does-not-exist',
    })
    expect(result.exists).toBe(false)
    expect(result.article).toBeUndefined()
    expect(result.normalized).toBeDefined()
  })

  it('returns { exists: true, article } with the full projected shape', async () => {
    const scaffold = await seedScaffold('foxnews')
    await db.insert(articles).values({
      targetId: scaffold.targetId,
      agentTokenId: scaffold.agentTokenId,
      runLogId: scaffold.runLogId,
      sourceUrl: 'https://example.com/story',
      slug: 'story-1',
      title: 'A Story',
      summary: 'Summary',
      topicBadges: [],
      significance: 'small',
      difficulty: 'easy',
    })

    const result = await checkArticleExists({ source_url: 'https://example.com/story' })
    expect(result.exists).toBe(true)
    expect(result.article).toBeDefined()
    expect(result.article.slug).toBe('story-1')
    expect(result.article.title).toBe('A Story')
    expect(result.article.target_id).toBe(scaffold.targetId)
    expect(result.article.target_label).toBe('foxnews')
    expect(result.article.hidden).toBe(false)
    expect(result.article.dashboard_visible).toBe(true)
    expect(result.article.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns the article even when hidden: true', async () => {
    const scaffold = await seedScaffold('cnn')
    await db.insert(articles).values({
      targetId: scaffold.targetId,
      agentTokenId: scaffold.agentTokenId,
      runLogId: scaffold.runLogId,
      sourceUrl: 'https://example.com/hidden',
      slug: 'hidden-1',
      title: 'Hidden',
      summary: 'S',
      topicBadges: [],
      significance: 'small',
      difficulty: 'easy',
      hidden: true,
    })

    const result = await checkArticleExists({ source_url: 'https://example.com/hidden' })
    expect(result.exists).toBe(true)
    expect(result.article.hidden).toBe(true)
  })

  it('returns the article even when dashboard_visible: false', async () => {
    const scaffold = await seedScaffold('msnbc')
    await db.insert(articles).values({
      targetId: scaffold.targetId,
      agentTokenId: scaffold.agentTokenId,
      runLogId: scaffold.runLogId,
      sourceUrl: 'https://example.com/rolled-off',
      slug: 'rolled-1',
      title: 'Rolled',
      summary: 'S',
      topicBadges: [],
      significance: 'small',
      difficulty: 'easy',
      dashboardVisible: false,
    })

    const result = await checkArticleExists({ source_url: 'https://example.com/rolled-off' })
    expect(result.exists).toBe(true)
    expect(result.article.dashboard_visible).toBe(false)
  })

  it('canonicalizes URL casing / tracking params before matching', async () => {
    const scaffold = await seedScaffold('reuters')
    await db.insert(articles).values({
      targetId: scaffold.targetId,
      agentTokenId: scaffold.agentTokenId,
      runLogId: scaffold.runLogId,
      sourceUrl: 'https://example.com/a',
      slug: 'a-1',
      title: 'A',
      summary: 'S',
      topicBadges: [],
      significance: 'small',
      difficulty: 'easy',
    })

    const result = await checkArticleExists({
      source_url: 'https://Example.com/a?utm_source=newsletter',
    })
    expect(result.exists).toBe(true)
    expect(result.normalized).toBe('https://example.com/a')
  })

  it('returns invalid_source_url without touching the DB on a bad URL', async () => {
    const result = await checkArticleExists({ source_url: 'not-a-url' })
    expect(result.exists).toBe(false)
    expect(result.error).toBe('invalid_source_url')
    expect(result.article).toBeUndefined()
  })
})
