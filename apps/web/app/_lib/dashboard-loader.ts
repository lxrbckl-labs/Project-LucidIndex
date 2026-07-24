/**
 * Dashboard server loader (closes the Phase 5 mock-only gap).
 *
 * This module is the single dispatch point used by `app/page.tsx` for the
 * authenticated dashboard. It branches on `LUCIDINDEX_MOCK`:
 *
 *   - `LUCIDINDEX_MOCK=1`         → 12 in-process mock articles via
 *                                   `app/_mock/articles.ts`. Preserved
 *                                   for the Phase 5 visual gate (#63)
 *                                   and for SWE-4's screenshot session.
 *   - `LUCIDINDEX_MOCK_EMPTY=1`   → empty array, used to screenshot the
 *                                   authenticated empty state without
 *                                   wiring a DB.
 *   - default (no env)            → real Drizzle queries against the
 *                                   `articles` table. This is the
 *                                   production path and the path the
 *                                   `pnpm db:seed-demo` 800-1200 article
 *                                   dataset feeds into.
 *
 * Filter contract (matches the search loader and the spec):
 *   - `dashboard_visible = true`  — articles rolled off by the 6-day
 *                                   retention purge (#72) drop out of
 *                                   the dashboard but stay reachable via
 *                                   share-link / "Include archived" search.
 *
 * Order:  `created_at DESC` — newest agent-insertion first.
 *
 * Cap:    {@link DASHBOARD_ARTICLE_LIMIT} (100). The masonry's first-page
 *         needs are well-served at this size; new arrivals stream in via
 *         the SSE bus (`apps/web/app/api/events/route.ts`) so users don't
 *         hit a page-reload boundary for fresh content.
 *
 * Hero images: hydrated to the `/i/<hash>` Route Handler URL via
 *              `heroImageUrlFromHash()` in `@lucidindex/shared/article-view`.
 *              Cache-Control + WebP-vs-JPEG content negotiation lives in
 *              `apps/web/app/i/[hash]/route.ts` (#74); this loader just
 *              hands the URL to the masonry.
 *
 * Bylines: hydrated via a LEFT JOIN to `agent_tokens.label`. Falls back
 *          to "unknown" when the join misses (the FK is non-null at the
 *          DB level — the LEFT JOIN is a defensive belt-and-suspenders).
 *
 * Topic-badge filter: applied in SQL via `topic_badges @> ARRAY[$1]` so
 *          the filtered slice fits within the LIMIT cleanly. Single-select
 *          per Phase 5 §1; multi-select is out of scope for this PR.
 */

import { db } from '@lucidindex/db/client'
import { and, asc, desc, eq, sql } from '@lucidindex/db/query'
import { agentTokens, articles, targets, topicBadges } from '@lucidindex/db/schema'
import { mapArticleRowToCard } from '@lucidindex/shared/article-view'
import { generateSlug } from '@lucidindex/shared/slug'
import {
  loadDashboardArticles as loadMockDashboardArticles,
  loadDashboardBadges as loadMockDashboardBadges,
  type MockArticle,
} from '@/app/_mock/articles'
import type { CreatorSentimentWeek } from '@/app/c/[slug]/loader'

/**
 * Initial-page cap — keeps the dashboard render bounded. New arrivals
 * append via the SSE bus rather than expanding the initial page. The
 * Phase 5 spec didn't pin a number; 100 is the project rule of thumb
 * documented in the assignment for this gap.
 */
export const DASHBOARD_ARTICLE_LIMIT = 100

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'
const MOCK_EMPTY_MODE = process.env.LUCIDINDEX_MOCK_EMPTY === '1'

/**
 * Load the dashboard article set. The return type is `MockArticle[]`
 * for backwards compatibility with `ArticleMasonry`, which has been
 * consuming that shape since Phase 5. We map DB rows into that shape
 * via the shared `mapArticleRowToCard` helper.
 *
 * Optional `badge` filter — when set, only articles tagged with that
 * badge are returned. Same single-select contract the pill row writes
 * to via `?badge=…`.
 */
export async function loadDashboardArticles(
  options: { badge?: string | null; starred?: boolean } = {},
): Promise<MockArticle[]> {
  const { badge, starred } = options

  // Mock-mode short-circuit (preserved verbatim from the original
  // `_mock/articles.ts` entry-point so SWE-4's screenshot session keeps
  // the same behavior). The page-level filter still runs against the
  // mock list afterwards.
  if (MOCK_EMPTY_MODE) return []
  if (MOCK_MODE) {
    let mocks = await loadMockDashboardArticles()
    if (starred) mocks = mocks.filter((a) => a.starred === true)
    if (badge) mocks = mocks.filter((a) => a.topicBadges.includes(badge))
    return mocks
  }

  // Real-DB path. The filter on `topic_badges` uses the postgres array
  // containment operator (`@>`); the `topic_badges` column is `text[]`
  // and the operand has to be cast to the same type via `ARRAY[$1]::text[]`.
  let where = eq(articles.dashboardVisible, true)
  if (starred) {
    where = and(where, eq(articles.starred, true)) as typeof where
  }
  if (badge) {
    where = and(where, sql`${articles.topicBadges} @> ARRAY[${badge}]::text[]`) as typeof where
  }

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
      targetCreatedAt: targets.createdAt,
      reasonablenessRating: articles.reasonablenessRating,
      crossSource: articles.crossSource,
      citations: articles.citations,
      sourceUrl: articles.sourceUrl,
      createdAt: articles.createdAt,
      starred: articles.starred,
    })
    .from(articles)
    .leftJoin(agentTokens, eq(articles.agentTokenId, agentTokens.id))
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(where)
    // Newest-first by agent-insertion time.
    .orderBy(desc(articles.createdAt))
    .limit(DASHBOARD_ARTICLE_LIMIT)

  // The mapper returns an `ArticleCardView` — structurally compatible
  // with the `MockArticle` fields the masonry reads. We cast the result
  // to `MockArticle[]` because `ArticleMasonry`'s prop type still
  // references the mock view model. Long-term, both should reference the
  // shared `ArticleCardView` directly — that rename is out of scope here
  // because it would touch every masonry / card / search consumer.
  return rows.map(mapArticleRowToCard) as MockArticle[]
}

/**
 * Load the curated topic-badge list for the filter pill row.
 *
 * Real-DB path reads `topic_badges` table ordered by `display_order` then
 * by `created_at` for a stable secondary order. Returns badge names only.
 *
 * Mock mode delegates to the existing mock helper, which derives badges
 * from the mock article set by first-appearance.
 */
export async function loadDashboardBadges(): Promise<string[]> {
  if (MOCK_EMPTY_MODE) return []
  if (MOCK_MODE) {
    return loadMockDashboardBadges()
  }

  const rows = await db
    .select({ name: topicBadges.name })
    .from(topicBadges)
    .where(eq(topicBadges.hidden, false))
    .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.createdAt))

  return rows.map((r) => r.name)
}

/**
 * The top authors writing on a given topic badge (most-prolific first,
 * max 5). The topic analog of `loadCreatorTopTopics`.
 *
 * Joins non-hidden articles carrying the badge (`topic_badges @> ARRAY[$1]`)
 * to their `targets`, groups by target, counts, and ranks by count DESC then
 * label ASC. `slug` falls back to `generateSlug(label, createdAt)` for rows
 * whose `slug` column is still null (lazy backfill, mirroring
 * `loadCreatorBySlug`), so every chip links to a resolvable `/c/<slug>`.
 */
export async function loadTopicTopAuthors(
  badge: string,
): Promise<{ label: string; slug: string }[]> {
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      slug: targets.slug,
      createdAt: targets.createdAt,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .innerJoin(targets, eq(articles.targetId, targets.id))
    .where(and(eq(articles.hidden, false), sql`${articles.topicBadges} @> ARRAY[${badge}]::text[]`))
    .groupBy(targets.id, targets.label, targets.slug, targets.createdAt)
    .orderBy(desc(sql`count(*)`), asc(targets.label))
    .limit(5)

  return rows.map((r) => ({
    label: r.label,
    slug: r.slug ?? generateSlug(r.label, r.createdAt),
  }))
}

/**
 * Weekly average sentiment across all articles carrying a topic badge over
 * the trailing 52 weeks. Mirrors `loadCreatorSentimentTimeline` exactly but
 * filters by badge membership (`badge = ANY(topic_badges)`) instead of
 * `target_id`, so the topic card can reuse `CreatorSentimentTimeline`.
 *
 * Filters non-hidden articles with a non-null sentiment inside the window,
 * buckets by ISO week (`date_trunc('week', ...)` — Monday start), and returns
 * `avg(sentiment)` + `count(*)` per populated week, oldest first. `week_start`
 * is cast to text in SQL and normalized to an ISO string on the way out.
 */
export async function loadTopicSentimentTimeline(badge: string): Promise<CreatorSentimentWeek[]> {
  const rows = await db.execute<{ week_start: string; avg_sentiment: number; n: number }>(sql`
    SELECT
      date_trunc('week', created_at)::text AS week_start,
      avg(sentiment)::float                AS avg_sentiment,
      count(*)::int                        AS n
    FROM articles
    WHERE hidden = false
      AND sentiment IS NOT NULL
      AND created_at >= now() - interval '52 weeks'
      AND ${badge} = ANY(topic_badges)
    GROUP BY date_trunc('week', created_at)
    ORDER BY date_trunc('week', created_at) ASC
  `)
  return [...rows].map((r) => ({
    weekStart: new Date(r.week_start).toISOString(),
    avgSentiment: r.avg_sentiment,
    n: r.n,
  }))
}
