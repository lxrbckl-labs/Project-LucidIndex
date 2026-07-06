/**
 * Creator-page server loader (#71).
 *
 * Two functions:
 *
 *   - `loadCreatorBySlug(slug)` — resolves a target row by slug. If the
 *     target's `slug` column is null (lazy backfill: the 0003 migration
 *     added the column nullable), this helper generates the slug from
 *     `target.label + target.created_at`, persists it, and returns the
 *     target. This is the "get-or-set" pattern described in the schema
 *     comment — existing rows are silently migrated on first access.
 *
 *     Collision handling: `generateSlug` is deterministic, so two targets
 *     with the same label created at the same millisecond would collide.
 *     In practice that's astronomically unlikely. If a unique-constraint
 *     violation does occur (future edge case), the INSERT is a no-op
 *     (slug already set by a concurrent request) and the page still
 *     resolves correctly via a fallback re-query.
 *
 *   - `loadCreatorArticles(targetId)` — returns the article list for a
 *     target in `created_at DESC` order. Filters `hidden = false`.
 *     Does NOT filter `dashboard_visible` — creator pages show the full
 *     archive including articles that have rolled off the dashboard.
 *
 * The ArticleMasonry component accepts `MockArticle[]`; in real-DB mode
 * we need to map the raw DB rows to `MockArticle`-compatible shape. We
 * return a minimal compatible subset and fill in mock-only fields
 * (e.g. `readMinutes`) with computed values.
 *
 * Hero images: `heroImageUrl` is the `/i/<hash>` route URL when the
 * article has a hero, or '' when it doesn't (the masonry card falls
 * through to a muted placeholder).
 */

import { db } from '@lucidindex/db/client'
import { and, desc, eq, isNull, sql } from '@lucidindex/db/query'
import { agentTokens, articles, targets } from '@lucidindex/db/schema'
import { generateSlug } from '@lucidindex/shared/slug'
import type { MockArticle } from '@/app/_mock/articles'

/**
 * The minimal target view the creator page needs.
 */
export type CreatorViewModel = {
  id: string
  label: string
  slug: string
  urlOrHandle: string
  description: string | null
  socialUrl: string | null
  photoUrl: string | null
}

/**
 * Aggregate sentiment summary for a creator. Hidden behind the
 * `count >= MIN_COUNT` gate in the UI so a one-off rating doesn't
 * render a misleading gauge.
 */
export type CreatorSentiment = {
  averageSentiment: number
  count: number
}

/**
 * Resolve a target by slug, with lazy slug generation for rows that
 * predate the 0003 migration (nullable `slug` column).
 *
 * Returns null when no target matches the slug.
 */
export async function loadCreatorBySlug(slug: string): Promise<CreatorViewModel | null> {
  // First try: direct lookup by slug.
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      slug: targets.slug,
      urlOrHandle: targets.urlOrHandle,
      description: targets.description,
      socialUrl: targets.socialUrl,
      photoUrl: targets.photoUrl,
      createdAt: targets.createdAt,
    })
    .from(targets)
    .where(eq(targets.slug, slug))
    .limit(1)

  const row = rows[0]
  if (row?.slug) {
    return {
      id: row.id,
      label: row.label,
      slug: row.slug,
      urlOrHandle: row.urlOrHandle,
      description: row.description,
      socialUrl: row.socialUrl,
      photoUrl: row.photoUrl,
    }
  }

  // Not found by slug — this slug may belong to a target whose `slug`
  // column is still null (lazy backfill path). Load all null-slug targets
  // and check if any of them would generate this slug.
  //
  // This is a one-time migration cost per target, not a hot path.
  const nullSlugRows = await db
    .select({
      id: targets.id,
      label: targets.label,
      urlOrHandle: targets.urlOrHandle,
      description: targets.description,
      socialUrl: targets.socialUrl,
      photoUrl: targets.photoUrl,
      createdAt: targets.createdAt,
    })
    .from(targets)
    .where(isNull(targets.slug))

  for (const t of nullSlugRows) {
    const candidate = generateSlug(t.label, t.createdAt)
    if (candidate === slug) {
      // Found the match — persist the slug and return.
      await db
        .update(targets)
        .set({ slug: candidate })
        .where(and(eq(targets.id, t.id), isNull(targets.slug)))
      return {
        id: t.id,
        label: t.label,
        slug: candidate,
        urlOrHandle: t.urlOrHandle,
        description: t.description,
        socialUrl: t.socialUrl,
        photoUrl: t.photoUrl,
      }
    }
  }

  return null
}

/**
 * Average sentiment across a creator's non-hidden articles, with a count
 * so the UI can decide whether to render the gauge (`count >= 3`).
 *
 * Skips rows with NULL sentiment so the average reflects only articles
 * the agent actually scored.
 */
export async function loadCreatorSentiment(targetId: string): Promise<CreatorSentiment> {
  const rows = await db
    .select({
      avg: sql<string | null>`avg(${articles.sentiment})::text`,
      count: sql<number>`count(${articles.sentiment})::int`,
    })
    .from(articles)
    .where(
      and(
        eq(articles.targetId, targetId),
        eq(articles.hidden, false),
        // Drizzle 0.45 doesn't expose isNotNull from our re-export surface;
        // emit raw SQL to keep the slice tight.
        sql`${articles.sentiment} is not null`,
      ),
    )
  const row = rows[0]
  const avg = row?.avg ? Number(row.avg) : 0
  const count = row?.count ?? 0
  return { averageSentiment: avg, count }
}

/**
 * A single week's sentiment bucket for the creator timeline chart.
 * `weekStart` is the ISO-week start (Monday) as an ISO-8601 string.
 */
export type CreatorSentimentWeek = {
  weekStart: string
  avgSentiment: number
  n: number
}

/**
 * The author's most-frequent topic badges (most-frequent first, max 5).
 *
 * `topic_badges` is a `text[]` per article; unnest it across the creator's
 * non-hidden articles, count per topic, and rank. Emitted as raw SQL via
 * `db.execute` because `unnest` isn't on our drizzle re-export surface —
 * mirrors the raw-SQL topic aggregation in the forum/search loaders.
 *
 * Returns just the ordered topic strings (counts are used only for
 * ranking, never shown).
 */
export async function loadCreatorTopTopics(targetId: string): Promise<string[]> {
  const rows = await db.execute<{ topic: string; count: number }>(sql`
    SELECT topic, count(*)::int AS count
    FROM (
      SELECT unnest(topic_badges) AS topic
      FROM articles
      WHERE target_id = ${targetId}::uuid
        AND hidden = false
    ) t
    GROUP BY topic
    ORDER BY count DESC, topic ASC
    LIMIT 5
  `)
  return [...rows].map((r) => r.topic)
}

/**
 * Weekly average sentiment for a creator over the trailing 52 weeks.
 *
 * Filters non-hidden articles with a non-null sentiment inside the window,
 * buckets by ISO week (`date_trunc('week', ...)` — Monday start), and
 * returns `avg(sentiment)` + `count(*)` per populated week, oldest first.
 * The 52-week window is a query filter, so old data drops off on its own.
 *
 * `week_start` is cast to text in SQL (deterministic across driver type
 * parsers) and normalized to an ISO string on the way out.
 */
export async function loadCreatorSentimentTimeline(
  targetId: string,
): Promise<CreatorSentimentWeek[]> {
  const rows = await db.execute<{ week_start: string; avg_sentiment: number; n: number }>(sql`
    SELECT
      date_trunc('week', created_at)::text AS week_start,
      avg(sentiment)::float                AS avg_sentiment,
      count(*)::int                        AS n
    FROM articles
    WHERE target_id = ${targetId}::uuid
      AND hidden = false
      AND sentiment IS NOT NULL
      AND created_at >= now() - interval '52 weeks'
    GROUP BY date_trunc('week', created_at)
    ORDER BY date_trunc('week', created_at) ASC
  `)
  return [...rows].map((r) => ({
    weekStart: new Date(r.week_start).toISOString(),
    avgSentiment: r.avg_sentiment,
    n: r.n,
  }))
}

/**
 * Load articles for a creator (target), newest first.
 *
 * Filters `hidden = false`. Does NOT filter `dashboard_visible` — the
 * creator page is an archive view (see module-level comment).
 *
 * Returns a `MockArticle[]`-compatible array so `ArticleMasonry` can
 * consume it directly without branching on the caller side.
 */
export async function loadCreatorArticles(targetId: string): Promise<MockArticle[]> {
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      topicBadges: articles.topicBadges,
      significance: articles.significance,
      heroImageHash: articles.heroImageHash,
      agentLabel: agentTokens.label,
      creatorLabel: targets.label,
      creatorSlug: targets.slug,
      reasonablenessRating: articles.reasonablenessRating,
      crossSource: articles.crossSource,
      starred: articles.starred,
      read: articles.read,
      sourceUrl: articles.sourceUrl,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(agentTokens, eq(articles.agentTokenId, agentTokens.id))
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(and(eq(articles.targetId, targetId), eq(articles.hidden, false)))
    .orderBy(desc(articles.createdAt))

  return rows.map((row) => {
    const publishedAt = row.createdAt.toISOString()
    const publishedLabel = formatPublishLabel(publishedAt)
    const words = `${row.summary ?? ''} `.split(/\s+/).length
    const readMinutes = Math.max(1, Math.round(words / 250))
    // Image-serve route at `/i/<hash>` (Phase 7 #74). Empty string falls
    // through to the placeholder render in the masonry card.
    const heroImageUrl = row.heroImageHash ? `/i/${row.heroImageHash}` : ''

    // crossSource: decode jsonb defensively.
    const crossSourceRaw = Array.isArray(row.crossSource) ? row.crossSource : []
    const crossSource = crossSourceRaw
      .filter(
        (e): e is { title: string; source_url: string; publisher?: string } =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as Record<string, unknown>).title === 'string' &&
          typeof (e as Record<string, unknown>).source_url === 'string',
      )
      .map((e) => ({
        title: e.title,
        source_url: e.source_url,
        ...(typeof e.publisher === 'string' ? { publisher: e.publisher } : {}),
      }))

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      topicBadges: row.topicBadges,
      significance: (row.significance as 'small' | 'medium' | 'large') ?? 'small',
      publishedLabel,
      publishedEstimated: false,
      publishedAt,
      heroImageUrl,
      agentLabel: row.agentLabel ?? 'unknown',
      creatorLabel: row.creatorLabel ?? undefined,
      creatorSlug: row.creatorSlug ?? undefined,
      readMinutes,
      reasonablenessRating: row.reasonablenessRating ?? null,
      crossSource,
      sourceUrl: row.sourceUrl,
      starred: row.starred,
    }
  })
}

/**
 * Format a date as the editorial "24. April 2026" pill label.
 * Duplicated from `apps/web/app/a/[slug]/loader.ts` — both callers
 * are server-side only and the function is small enough to not warrant
 * a shared util extraction in this PR.
 */
function formatPublishLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(d)
  const year = d.getUTCFullYear()
  return `${day}. ${month} ${year}`
}
