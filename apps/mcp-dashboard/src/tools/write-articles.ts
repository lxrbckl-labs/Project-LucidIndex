// `write_articles` — insert article rows produced from a queue pull.
//
// #43 expanded the surface beyond the original stub:
//   - Topic-badge validation against `topic_badges`. Default mode routes
//     unknown badges to `topic_badge_suggestions` (upsert, count++ on
//     repeat). Strict mode (settings.strict_mode = true) rejects the call
//     with `unknown_topic_badge`.
//   - `(target_id, source_url)` dedup is now a no-op — return the existing
//     article id with `deduped: true` instead of throwing
//     `duplicate_source_url`. The DB UNIQUE constraint stays as a
//     last-resort safety net, but the happy path is the pre-insert lookup.
//   - Per-article result is `{ id, deduped }`. Response shape is
//     `{ accepted, results: { id, deduped }[] }`.
//
// #45 added the hero-image pipeline:
//   - When an article carries `hero_image_url`, fetch + sharp-resize +
//     write WebP+JPEG under data/images/<hash>.<ext>. Store just the hash
//     in `articles.hero_image_hash`.
//   - Failure (any reason) does NOT block the article write — log and
//     skip with `hero_image_hash = null`.
//
// run_log timing — flow (audit round 8, migration 0034):
// -------------------------------------------------------
// `pull_queue_item` is now the authoritative creator of the run_log row.
// It INSERTs at CLAIM time with status='in_progress', started_at=now(),
// completed_at=NULL. That makes `started_at` an honest pull-time
// timestamp — previously it was "first-write-time" (this file), N
// seconds or even minutes after the claim once the agent had finished
// researching.
//
// This file's job is to UPDATE that row's `articles_count` as it goes.
// Defensive fallback: if for any reason the row is missing (a queue row
// claimed BEFORE migration 0034 lands, or a manual DB poke), we
// recreate it with status='in_progress' so the FK from `articles.run_log_id`
// resolves. `ack_queue_item` then flips status → 'succeeded' | 'failed'
// and stamps completed_at.
//
// #65 deterministic slugs: slug generation now lives in
// `@lucidindex/shared/slug` so the article-page route and the write
// path stay in sync. The primary slug is `YYYY-MM-DD-<kebab-title>`
// from the source publish date; on a `slug` unique-violation we retry
// once with a 6-char source-URL hash suffix. The earlier random-suffix
// strategy has been removed.
//
// Audit round 3 (P0/P1/P2) restructure:
// ------------------------------------
// The per-article work now runs in THREE PASSES so slow hero-image hosts
// don't hold row locks and one bad insert doesn't roll back its siblings:
//
//   Pass 1 (no DB txn): normalize URL via `@lucidindex/shared/url`, then
//     run the source dedup lookup. Decide which articles will insert and
//     which return as `deduped: true`. URL-parse failures collect into
//     `failures` with code `invalid_source_url`.
//   Pass 2 (no DB txn): for each article that will insert, fetch + store
//     the hero image in parallel via `Promise.all`. Each fetch can fail
//     independently — failure stores `heroImageHash: null` and does not
//     block its siblings.
//   Pass 3 (one outer txn, per-article savepoints inside): insert the
//     non-deduped articles with their pre-resolved hero hashes. Each
//     insert is wrapped in `tx.transaction(async sp => {...})` so a
//     slug-collision retry inside one savepoint doesn't roll back its
//     neighbors; a hard insert failure becomes a per-article entry in
//     `failures` and the rest still land.
//
// Suggestion attribution (P2): when EVERY article that introduced a given
// unknown badge gets deduped, we now still upsert the suggestion with
// `article_id = NULL` so the curation inbox sees the sighting. Migration
// 0030 relaxed the FK NOT NULL.

import { db } from '@lucidindex/db/client'
import {
  articles,
  comparisonSources,
  queue,
  runLog,
  settings,
  topicBadges,
} from '@lucidindex/db/schema'
import { disambiguate, generateSlug } from '@lucidindex/shared/slug'
import { InvalidSourceUrlError, normalizeSourceUrl } from '@lucidindex/shared/url'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findExistingArticleId } from '../lib/dedup.js'
import { fetchAndStoreHeroImage } from '../lib/image-pipeline.js'
import { ToolError } from './index.js'

const citationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  source_name: z.string().min(1),
  accessed_at: z.string().datetime().optional(),
  image_url: z.string().url().nullable().optional(),
})

const articleSchema = z.object({
  // Parity with `check_article_exists` (audit round 6): both tools reject
  // non-URLs at the same layer so callers get a consistent error mode.
  // `normalizeSourceUrl()` in Pass 1 still catches the harder
  // canonicalization edge cases (mailto:, javascript:, etc.) via
  // `InvalidSourceUrlError` → per-article `failures` entry.
  source_url: z.string().url(),
  title: z.string().min(1),
  summary: z.string().min(1),
  agent_deep_dive: z.string().optional(),
  agent_opinion: z.string().optional(),
  topic_badges: z.array(z.string()).default([]),
  significance: z.enum(['small', 'medium', 'large']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  reasonableness_rating: z.number().int().min(0).max(10).optional(),
  sentiment: z.number().int().min(-5).max(5).optional(),
  // REQUIRED: every article must ship with a related hero image. Presence
  // is enforced here; relevance is the agent's responsibility (see the tool
  // description and editorial templates). A fetch failure on a valid URL
  // stays non-fatal (heroImageHash → null), but the URL itself is mandatory.
  hero_image_url: z
    .string()
    .url()
    .describe(
      'REQUIRED. URL of an image clearly relevant to this story — its lead/OG image or another on-topic photo. Every article must have a related hero image; do not submit without one.',
    ),
  cross_source: z.array(z.unknown()).optional(),
  citations: z.array(citationSchema).optional(),
})

export const writeArticlesInputShape = {
  queue_item_id: z.string().uuid(),
  articles: z.array(articleSchema).min(1),
}

const writeArticlesArgs = z.object(writeArticlesInputShape)

export type WriteArticlesArgs = z.infer<typeof writeArticlesArgs> & {
  agentTokenId: string
}

export type WriteArticleResult = {
  index: number
  id: string
  deduped: boolean
  source_url: string
}

export type WriteArticleFailure = {
  index: number
  source_url: string
  code: string
  message: string
}

export type WriteArticlesResult = {
  accepted: number
  results: WriteArticleResult[]
  failures: WriteArticleFailure[]
}

/**
 * Per-article plan built in Pass 1 (dedup + URL normalize). Carries the
 * canonical source_url, the dedup outcome, and (when we plan to insert)
 * a slot for the hero hash that Pass 2 fills in.
 */
type ArticlePlan =
  | {
      kind: 'insert'
      index: number
      sourceUrl: string // normalized
      heroImageHash: string | null // resolved in Pass 2
    }
  | {
      kind: 'deduped'
      index: number
      sourceUrl: string // normalized
      existingId: string
    }
  | {
      kind: 'failure'
      index: number
      // Raw source_url for the wire (so the agent sees what they sent).
      sourceUrl: string
      code: string
      message: string
    }

export async function writeArticles(args: WriteArticlesArgs): Promise<WriteArticlesResult> {
  // Verify the queue row is currently claimed by this agent.
  const queueRows = await db
    .select({
      id: queue.id,
      targetId: queue.targetId,
      enqueuedAt: queue.enqueuedAt,
      claimedBy: queue.claimedBy,
      ackedAt: queue.ackedAt,
    })
    .from(queue)
    .where(eq(queue.id, args.queue_item_id))
    .limit(1)

  if (queueRows.length === 0) {
    throw new ToolError('queue_item_not_found', `Queue item ${args.queue_item_id} not found.`)
  }
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const q = queueRows[0]!

  if (q.ackedAt !== null) {
    throw new ToolError('queue_item_already_acked', 'Queue item has already been acknowledged.')
  }
  if (q.claimedBy !== args.agentTokenId) {
    throw new ToolError(
      'queue_item_not_claimed_by_caller',
      'This queue item is claimed by a different agent.',
    )
  }

  // ---- #43 BADGE VALIDATION ----
  //
  // 1. Pull all distinct badges referenced across this call.
  // 2. SELECT the matching rows from topic_badges; anything missing is
  //    the "unknown" set.
  // 3. If strict_mode is on AND there are unknowns → reject the whole
  //    call. We're explicit about this being all-or-nothing per the spec.
  // 4. If default mode → upsert each unknown into topic_badge_suggestions
  //    (count++ on existing names) and proceed.
  const allBadges = Array.from(new Set(args.articles.flatMap((a) => a.topic_badges)))
  const unknownBadges: string[] = []
  if (allBadges.length > 0) {
    const known = await db
      .select({ name: topicBadges.name })
      .from(topicBadges)
      .where(inArray(topicBadges.name, allBadges))
    const knownSet = new Set(known.map((r) => r.name))
    for (const b of allBadges) {
      if (!knownSet.has(b)) unknownBadges.push(b)
    }
  }

  // settings is a singleton (id = 1). The row may not exist on a fresh
  // DB — treat absent settings as default mode (strict_mode = false).
  const settingsRows = await db
    .select({ strictMode: settings.strictMode })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1)
  const strictMode = settingsRows[0]?.strictMode ?? false

  if (unknownBadges.length > 0 && strictMode) {
    throw new ToolError(
      'unknown_topic_badge',
      `Strict mode is on and these topic badges are not in the taxonomy: ${unknownBadges.join(', ')}.`,
    )
  }

  // ---- CITATION SOURCE VALIDATION ----
  //
  // Citations reference comparison_sources by `name`. In strict_mode we
  // refuse the call if any citation names a source not in the active
  // taxonomy. In default mode citations with unknown source names are
  // accepted as-is — the article page just won't be able to resolve them
  // to a known logo / base_url, but the data is still readable.
  //
  // Inactive sources (`is_active = false`, soft-archived) are treated as
  // unknown so deactivating a source halts new citations against it.
  const allCitationSources = Array.from(
    new Set(args.articles.flatMap((a) => (a.citations ?? []).map((c) => c.source_name))),
  )
  if (allCitationSources.length > 0 && strictMode) {
    const knownSources = await db
      .select({ name: comparisonSources.name })
      .from(comparisonSources)
      .where(
        and(
          inArray(comparisonSources.name, allCitationSources),
          eq(comparisonSources.isActive, true),
        ),
      )
    const knownSourceSet = new Set(knownSources.map((r) => r.name))
    const unknownSources = allCitationSources.filter((s) => !knownSourceSet.has(s))
    if (unknownSources.length > 0) {
      throw new ToolError(
        'unknown_comparison_source',
        `Strict mode is on and these citation source_name values are not active comparison sources: ${unknownSources.join(', ')}.`,
      )
    }
  }

  // ---- run_log row lookup (see file header for the lifecycle) ----
  //
  // `pull_queue_item` created the in_progress run_log row at claim time
  // (migration 0034 + audit round 8). Look it up here so articles can
  // reference it via the non-null FK. We don't UPDATE started_at — the
  // pull-time timestamp is the canonical one.
  //
  // Defensive fallback: if the row is missing — queue claimed BEFORE
  // migration 0034 landed, or a manual DB poke — we INSERT it now with
  // status='in_progress' so the FK resolves and the run still completes
  // cleanly. ack_queue_item then promotes it to a terminal status.
  // Concurrent-writer race covered by ON CONFLICT DO NOTHING against the
  // (queue_item_id, agent_token_id) UNIQUE (migration 0032).
  let runLogId: string
  const existingRunLog = await db
    .select({ id: runLog.id })
    .from(runLog)
    .where(and(eq(runLog.queueItemId, q.id), eq(runLog.agentTokenId, args.agentTokenId)))
    .limit(1)
  if (existingRunLog.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length-checked above
    runLogId = existingRunLog[0]!.id
  } else {
    // Fallback path. `started_at = now()` here is still better than the
    // pre-0034 `q.enqueuedAt` (the 8-day bug) — we don't have the real
    // pull-time to fall back on in this path, so now() is the best proxy.
    const now = new Date()
    const inserted = await db
      .insert(runLog)
      .values({
        targetId: q.targetId,
        queueItemId: q.id,
        agentTokenId: args.agentTokenId,
        status: 'in_progress',
        articlesCount: 0,
        startedAt: now,
        completedAt: null,
      })
      .onConflictDoNothing({ target: [runLog.queueItemId, runLog.agentTokenId] })
      .returning({ id: runLog.id })
    if (inserted.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: just inserted one row
      runLogId = inserted[0]!.id
    } else {
      // Conflict fired — a concurrent writer (or a slow pull-queue-item
      // we raced with) created the row first. Re-SELECT it.
      const reSelect = await db
        .select({ id: runLog.id })
        .from(runLog)
        .where(and(eq(runLog.queueItemId, q.id), eq(runLog.agentTokenId, args.agentTokenId)))
        .limit(1)
      if (reSelect.length === 0) {
        throw new ToolError(
          'internal_error',
          'run_log find-or-create: ON CONFLICT fired but re-SELECT returned no rows.',
        )
      }
      // biome-ignore lint/style/noNonNullAssertion: length-checked above
      runLogId = reSelect[0]!.id
    }
  }

  // ====================================================================
  // PASS 1 (no DB txn) — URL normalize + dedup decision per article.
  // ====================================================================
  //
  // We build one ArticlePlan per input article. Three outcomes:
  //   - 'failure'  → URL parse failed; nothing further to do for this row.
  //   - 'deduped'  → canonical source_url already in `articles`; surface
  //                  the existing id.
  //   - 'insert'   → fresh; we'll fetch hero in Pass 2 and insert in Pass 3.
  const plans: ArticlePlan[] = []
  for (let i = 0; i < args.articles.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index in range
    const a = args.articles[i]!
    let canonical: string
    try {
      canonical = normalizeSourceUrl(a.source_url)
    } catch (err) {
      if (err instanceof InvalidSourceUrlError) {
        plans.push({
          kind: 'failure',
          index: i,
          sourceUrl: a.source_url,
          code: 'invalid_source_url',
          message: err.message,
        })
        continue
      }
      throw err
    }

    const existingId = await findExistingArticleId(q.targetId, canonical)
    if (existingId) {
      plans.push({ kind: 'deduped', index: i, sourceUrl: canonical, existingId })
    } else {
      plans.push({ kind: 'insert', index: i, sourceUrl: canonical, heroImageHash: null })
    }
  }

  // ====================================================================
  // PASS 2 (no DB txn) — hero-image fetch with bounded concurrency.
  // ====================================================================
  //
  // Each insert plan can have its own hero fetch. Failures are
  // non-blocking: a missing hero stores hash=null, but the article
  // still inserts in Pass 3.
  //
  // Audit round 6 — bounded concurrency: a previous version used a flat
  // `Promise.all`, which lets a 50-article batch spawn 50 parallel
  // image fetches × 25 MB each = 1.25 GB worst-case in flight. We now
  // cap concurrency at HERO_FETCH_CONCURRENCY via a tiny inline
  // semaphore (no new dep). Each "worker" pulls the next pending plan
  // off the queue until the queue is empty.
  const HERO_FETCH_CONCURRENCY = 5
  const pendingHeroIndexes: number[] = []
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    if (!p || p.kind !== 'insert') continue
    // biome-ignore lint/style/noNonNullAssertion: index in range
    const a = args.articles[p.index]!
    if (a.hero_image_url) pendingHeroIndexes.push(i)
  }
  let nextHero = 0
  async function heroWorker() {
    while (true) {
      const slot = nextHero++
      if (slot >= pendingHeroIndexes.length) return
      // biome-ignore lint/style/noNonNullAssertion: slot in range
      const planIdx = pendingHeroIndexes[slot]!
      // biome-ignore lint/style/noNonNullAssertion: index in range
      const p = plans[planIdx]!
      if (p.kind !== 'insert') continue
      // biome-ignore lint/style/noNonNullAssertion: index in range
      const a = args.articles[p.index]!
      if (!a.hero_image_url) continue
      try {
        const result = await fetchAndStoreHeroImage(a.hero_image_url)
        p.heroImageHash = result.ok ? result.hash : null
      } catch {
        // fetchAndStoreHeroImage logs internally; swallow here so a hero
        // fetch never blocks the insert pass.
        p.heroImageHash = null
      }
    }
  }
  const workerCount = Math.min(HERO_FETCH_CONCURRENCY, pendingHeroIndexes.length)
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) workers.push(heroWorker())
  await Promise.all(workers)

  // ====================================================================
  // PASS 3 (one outer txn, per-article savepoints inside) — INSERTs.
  // ====================================================================
  //
  // The outer transaction holds the suggestion-upsert and the run_log
  // articles_count bump as one atomic unit; per-article inserts each
  // get a savepoint so a slug-collision retry or a per-row error doesn't
  // roll back its siblings.
  const results: WriteArticleResult[] = []
  const failures: WriteArticleFailure[] = []

  // Push deduped + Pass-1 failures first so the result array is index-ordered
  // by the original input shape on the way out.
  for (const p of plans) {
    if (p.kind === 'deduped') {
      // biome-ignore lint/style/noNonNullAssertion: index in range
      const a = args.articles[p.index]!
      results.push({
        index: p.index,
        id: p.existingId,
        deduped: true,
        source_url: p.sourceUrl,
      })
      // Suppress unused-warning: we read p.index but want the original
      // raw source_url available for debugging; intentionally not used.
      void a
    } else if (p.kind === 'failure') {
      failures.push({
        index: p.index,
        source_url: p.sourceUrl,
        code: p.code,
        message: p.message,
      })
    }
  }

  await db.transaction(async (tx) => {
    for (const p of plans) {
      if (p.kind !== 'insert') continue
      // biome-ignore lint/style/noNonNullAssertion: index in range
      const a = args.articles[p.index]!

      // #65: slug is `YYYY-MM-DD-<kebab-title>` from the run's "now". On a
      // slug-unique collision (different source URL, same title + date), retry
      // once with the source-URL hash disambiguator suffix.
      const slugDate = new Date()
      const primarySlug = generateSlug(a.title, slugDate)
      const insertValues = {
        targetId: q.targetId,
        agentTokenId: args.agentTokenId,
        runLogId,
        sourceUrl: p.sourceUrl, // canonical form from Pass 1
        title: a.title,
        summary: a.summary,
        agentDeepDive: a.agent_deep_dive ?? null,
        agentOpinion: a.agent_opinion ?? null,
        topicBadges: a.topic_badges,
        significance: a.significance,
        difficulty: a.difficulty,
        reasonablenessRating: a.reasonableness_rating ?? null,
        sentiment: a.sentiment ?? null,
        heroImageHash: p.heroImageHash, // resolved in Pass 2
        // jsonb columns — pass the arrays as-is; drizzle handles the cast.
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column
        crossSource: (a.cross_source ?? []) as any,
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column
        citations: (a.citations ?? []) as any,
      } as const

      // Per-article savepoint so a hard insert failure for this row
      // doesn't roll back its siblings. Slug-retry stays inside the
      // savepoint so the retry's own conflict surface is local.
      try {
        await tx.transaction(async (sp) => {
          try {
            const inserted = await sp
              .insert(articles)
              .values({ ...insertValues, slug: primarySlug })
              .returning({ id: articles.id })
            // biome-ignore lint/style/noNonNullAssertion: just inserted one row
            const id = inserted[0]!.id
            results.push({
              index: p.index,
              id,
              deduped: false,
              source_url: p.sourceUrl,
            })
          } catch (err) {
            if (!isUniqueViolation(err)) throw err
            // 23505 has two flavors here:
            //
            //   (a) `(target_id, source_url)` collision — a concurrent writer
            //       beat us to inserting this article. Re-resolve and treat
            //       as deduped.
            //   (b) `slug` collision — a different article ended up with the
            //       same primary slug (same date + title, different source).
            //       Retry once with `disambiguate(slug, source_url)`.
            //
            // Drizzle's postgres-js driver doesn't surface the constraint
            // name reliably, so try the source-URL dedup first; if no
            // existing row exists, fall through to a slug retry.
            const existingId = await findExistingArticleId(q.targetId, p.sourceUrl)
            if (existingId) {
              results.push({
                index: p.index,
                id: existingId,
                deduped: true,
                source_url: p.sourceUrl,
              })
              return
            }
            // Slug collision path — retry with disambiguator. If THIS also
            // 23505s the savepoint rolls back; the outer catch records it
            // as a per-article failure.
            const retrySlug = disambiguate(primarySlug, p.sourceUrl)
            const inserted = await sp
              .insert(articles)
              .values({ ...insertValues, slug: retrySlug })
              .returning({ id: articles.id })
            // biome-ignore lint/style/noNonNullAssertion: just inserted one row
            const id = inserted[0]!.id
            results.push({
              index: p.index,
              id,
              deduped: false,
              source_url: p.sourceUrl,
            })
          }
        })
      } catch (err) {
        // Savepoint already rolled back — capture as a per-article
        // failure and continue to the next plan.
        const message = err instanceof Error ? err.message : String(err)
        const code = isUniqueViolation(err) ? 'unique_violation' : 'insert_failed'
        failures.push({
          index: p.index,
          source_url: p.sourceUrl,
          code,
          message,
        })
      }
    }

    // ---- Suggestion-inbox upserts ----
    //
    // We attribute each unknown badge to the FIRST article in this batch
    // that BOTH (a) mentions the badge AND (b) was actually INSERTED
    // (not deduped). When NO article in the batch carrying a given
    // unknown badge was inserted (every introducer was deduped), we
    // STILL upsert the suggestion with `article_id = NULL` so the
    // curation inbox sees the sighting (migration 0030 relaxed the
    // NOT NULL on the FK).
    if (unknownBadges.length > 0) {
      const firstArticleForBadge = new Map<string, string>()
      // results contains both inserts and dedups; only the inserts (i.e.
      // results with deduped:false) are eligible to anchor a suggestion.
      const insertedIndexToId = new Map<number, string>()
      for (const r of results) {
        if (!r.deduped) insertedIndexToId.set(r.index, r.id)
      }
      for (let i = 0; i < args.articles.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: index in range
        const article = args.articles[i]!
        const articleId = insertedIndexToId.get(i)
        if (!articleId) continue
        for (const b of article.topic_badges) {
          if (unknownBadges.includes(b) && !firstArticleForBadge.has(b)) {
            firstArticleForBadge.set(b, articleId)
          }
        }
      }

      for (const badgeName of unknownBadges) {
        const articleId = firstArticleForBadge.get(badgeName) ?? null
        // ON CONFLICT (name) DO UPDATE keeps the original article_id
        // (we only set it on INSERT). count++ and last_seen_at bump
        // both apply on conflict.
        await tx.execute(sql`
          INSERT INTO topic_badge_suggestions (name, article_id, target_id, agent_token_id, count, last_seen_at)
          VALUES (${badgeName}, ${articleId}, ${q.targetId}, ${args.agentTokenId}, 1, now())
          ON CONFLICT (name) DO UPDATE
          SET count = topic_badge_suggestions.count + 1,
              last_seen_at = now()
        `)
      }
    }

    // Keep the run_log articles_count in sync as we go (ack_queue_item
    // recomputes it definitively at finalization).
    const insertedCount = results.filter((r) => !r.deduped).length
    if (insertedCount > 0) {
      await tx
        .update(runLog)
        .set({ articlesCount: sql`${runLog.articlesCount} + ${insertedCount}` })
        .where(eq(runLog.id, runLogId))
    }
  })

  // Sort results by original input index so the wire response is
  // deterministic regardless of insert order.
  results.sort((a, b) => a.index - b.index)
  failures.sort((a, b) => a.index - b.index)

  const accepted = results.filter((r) => !r.deduped).length
  return { accepted, results, failures }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '23505'
}
