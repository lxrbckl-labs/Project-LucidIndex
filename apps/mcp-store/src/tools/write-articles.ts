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
// run_log timing — flow change:
// ----------------------------
// Before #43, `ack_queue_item` created the run_log row. But articles need
// a non-null `run_log_id`, so write_articles created an INTERIM run_log
// row with sentinel status `succeeded` and ack_queue_item promoted it.
// That worked but the sentinel was awkward.
//
// With #43: write_articles still creates the run_log row first (FK still
// requires it), but does so cleanly — status='succeeded' with
// articles_count populated as we go. The "promotion" in ack_queue_item is
// now an UPDATE that adjusts the terminal status if the run actually
// failed (or otherwise leaves the row untouched).
//
// If write_articles never runs (failed-pass scenario), ack_queue_item
// inserts a fresh run_log row with articles_count=0 — same as before.
//
// #65 deterministic slugs: slug generation now lives in
// `@lucidindex/shared/slug` so the article-page route and the write
// path stay in sync. The primary slug is `YYYY-MM-DD-<kebab-title>`
// from the source publish date; on a `slug` unique-violation we retry
// once with a 6-char source-URL hash suffix. The earlier random-suffix
// strategy has been removed.

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
  source_url: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  agent_deep_dive: z.string().optional(),
  agent_opinion: z.string().optional(),
  topic_badges: z.array(z.string()).default([]),
  significance: z.enum(['small', 'medium', 'large']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  reasonableness_rating: z.number().int().min(0).max(10).optional(),
  source_published_at: z.string().datetime().optional(),
  source_published_at_estimated: z.boolean().optional(),
  hero_image_url: z.string().url().optional(),
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

export type WriteArticlesResult = {
  accepted: number
  results: { id: string; deduped: boolean }[]
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

  // ---- run_log row creation (see file header for the timing change) ----
  //
  // Find or create. Idempotent: a previous write_articles for this same
  // queue_item_id + agent reuses its run_log row so articles_count keeps
  // accumulating across calls (rare, but possible).
  const existingRunLog = await db
    .select({ id: runLog.id })
    .from(runLog)
    .where(and(eq(runLog.queueItemId, q.id), eq(runLog.agentTokenId, args.agentTokenId)))
    .limit(1)

  let runLogId: string
  const now = new Date()
  if (existingRunLog.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length-checked above
    runLogId = existingRunLog[0]!.id
  } else {
    const inserted = await db
      .insert(runLog)
      .values({
        targetId: q.targetId,
        queueItemId: q.id,
        agentTokenId: args.agentTokenId,
        // 'succeeded' is the optimistic terminal status. ack_queue_item
        // overwrites this if the run is acked as 'failed'.
        status: 'succeeded',
        articlesCount: 0,
        startedAt: q.enqueuedAt,
        completedAt: now,
      })
      .returning({ id: runLog.id })
    // biome-ignore lint/style/noNonNullAssertion: just inserted one row
    runLogId = inserted[0]!.id
  }

  // ---- per-article processing ----
  //
  // We do dedup + insert + suggestion-upsert + image-fetch in a
  // transaction so a mid-batch failure leaves the DB consistent. The
  // image-fetch IS NOT in the transaction's critical path — we resolve
  // the hash before opening the transaction so we don't hold a DB tx
  // open across an HTTP fetch.
  const heroHashes = new Map<number, string | null>()
  for (let i = 0; i < args.articles.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index in range
    const a = args.articles[i]!
    if (a.hero_image_url) {
      const result = await fetchAndStoreHeroImage(a.hero_image_url)
      heroHashes.set(i, result.ok ? result.hash : null)
    } else {
      heroHashes.set(i, null)
    }
  }

  const results: { id: string; deduped: boolean }[] = []

  await db.transaction(async (tx) => {
    // Suggestion upserts run AFTER the article inserts because
    // topic_badge_suggestions.article_id is NOT NULL — we need a real
    // article id to attribute each suggestion to. The block below the
    // article loop emits one ON CONFLICT (name) DO UPDATE per unknown
    // badge.
    for (let i = 0; i < args.articles.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: index in range
      const a = args.articles[i]!

      // Pre-insert dedup. If `(target_id, source_url)` already exists,
      // return the existing id and skip the insert. We still keep the
      // DB UNIQUE constraint for last-resort safety against a
      // concurrent insert that races between the SELECT and the INSERT.
      const existingId = await findExistingArticleId(q.targetId, a.source_url)
      if (existingId) {
        results.push({ id: existingId, deduped: true })
        continue
      }

      // #65: slug is `YYYY-MM-DD-<kebab-title>` from the source publish
      // date when present, otherwise the run's "now". On a slug-unique
      // collision (different source URL, same title + date), retry once
      // with the source-URL hash disambiguator suffix.
      const slugDate = a.source_published_at ? new Date(a.source_published_at) : new Date()
      const primarySlug = generateSlug(a.title, slugDate)
      const insertValues = {
        targetId: q.targetId,
        agentTokenId: args.agentTokenId,
        runLogId,
        sourceUrl: a.source_url,
        title: a.title,
        summary: a.summary,
        agentDeepDive: a.agent_deep_dive ?? null,
        agentOpinion: a.agent_opinion ?? null,
        topicBadges: a.topic_badges,
        significance: a.significance,
        difficulty: a.difficulty,
        reasonablenessRating: a.reasonableness_rating ?? null,
        sourcePublishedAt: a.source_published_at ? new Date(a.source_published_at) : null,
        sourcePublishedAtEstimated: a.source_published_at_estimated ?? false,
        heroImageHash: heroHashes.get(i) ?? null,
        // jsonb columns — pass the arrays as-is; drizzle handles the cast.
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column
        crossSource: (a.cross_source ?? []) as any,
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column
        citations: (a.citations ?? []) as any,
      } as const
      try {
        const inserted = await tx
          .insert(articles)
          .values({ ...insertValues, slug: primarySlug })
          .returning({ id: articles.id })

        // biome-ignore lint/style/noNonNullAssertion: just inserted one row
        const id = inserted[0]!.id
        results.push({ id, deduped: false })
      } catch (err) {
        if (isUniqueViolation(err)) {
          // 23505 has two flavors here:
          //
          //   (a) `(target_id, source_url)` collision — a concurrent writer
          //       beat us to inserting this article. Re-resolve and treat
          //       as deduped.
          //   (b) `slug` collision — a different article ended up with the
          //       same primary slug (same date + title, different source).
          //       Retry once with `disambiguate(slug, source_url)`.
          //
          // We can't easily tell which constraint fired without inspecting
          // the driver-specific error fields, so try the source-URL dedup
          // first; if no existing row exists, fall through to a slug retry.
          const existingId = await findExistingArticleId(q.targetId, a.source_url)
          if (existingId) {
            results.push({ id: existingId, deduped: true })
            continue
          }
          // Slug collision path — retry with disambiguator. If THIS also
          // 23505s we let it bubble up; in practice the 6-char hash makes
          // a second collision astronomically unlikely.
          const retrySlug = disambiguate(primarySlug, a.source_url)
          const inserted = await tx
            .insert(articles)
            .values({ ...insertValues, slug: retrySlug })
            .returning({ id: articles.id })
          // biome-ignore lint/style/noNonNullAssertion: just inserted one row
          const id = inserted[0]!.id
          results.push({ id, deduped: false })
          continue
        }
        throw err
      }
    }

    // Suggestion-inbox upserts. We need at least one inserted article to
    // attribute a suggestion to (the FK on topic_badge_suggestions
    // requires article_id). Pick the first non-deduped result; if every
    // article in this batch was a dedup, attribute to the first deduped
    // article id (still a real article row).
    if (unknownBadges.length > 0 && results.length > 0) {
      // Find which article first mentioned each unknown badge.
      const firstArticleForBadge = new Map<string, string>()
      for (let i = 0; i < args.articles.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: index in range
        const article = args.articles[i]!
        // biome-ignore lint/style/noNonNullAssertion: results parallels articles
        const result = results[i]!
        for (const b of article.topic_badges) {
          if (unknownBadges.includes(b) && !firstArticleForBadge.has(b)) {
            firstArticleForBadge.set(b, result.id)
          }
        }
      }

      for (const badgeName of unknownBadges) {
        const articleId = firstArticleForBadge.get(badgeName)
        if (!articleId) continue
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

  return { accepted: results.length, results }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '23505'
}
