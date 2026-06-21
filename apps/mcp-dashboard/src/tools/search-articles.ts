// `search_articles` — full-text search across the article corpus.
//
// Lets agents check "have we already covered this story?" before
// publishing duplicate work under a different URL. Hits the existing
// GIN-indexed `tsvector` column over `title || summary || agent_deep_dive`
// using `plainto_tsquery('english', $1)` — no special syntax expected
// from the caller, plain words are fine.
//
// Returns a small projection (id, slug, title, summary, source_url,
// target_id, created_at, hidden, dashboard_visible)
// ranked by `ts_rank` descending, capped at `limit` (default 10, max 50).
//
// By default suppressed rows are excluded so normal browsing doesn't
// surface them. There are TWO ways an article can be suppressed:
//   - `hidden = true`: admin manually hid it.
//   - `dashboard_visible = false`: the 14-day retention purge rolled it
//      off the dashboard (still accessible by direct share-link).
//
// Pass `include_suppressed: true` when doing dedup checks — agents need
// to see BOTH categories so they don't re-research content that's already
// in the corpus. The `hidden` and `dashboard_visible` flags are always
// projected on each row so the caller can see WHY a result came back.
//
// `include_hidden` is accepted as a deprecated alias for
// `include_suppressed` (same semantics — both flags toggle BOTH filters).

import { db } from '@lucidindex/db/client'
import { articles } from '@lucidindex/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'

export const searchArticlesInputShape = {
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).optional(),
  include_suppressed: z
    .boolean()
    .optional()
    .describe(
      'Include suppressed articles. Suppressed = `hidden=true` (admin hidden) OR `dashboard_visible=false` (rolled off by 14-day retention purge). Default false (normal browsing). Set true when doing dedup checks — you do NOT want to re-research something the corpus has already suppressed.',
    ),
  include_hidden: z
    .boolean()
    .optional()
    .describe(
      'DEPRECATED alias for `include_suppressed`. Maps 1:1 — if either flag is true, both `hidden=true` AND `dashboard_visible=false` rows are returned. Prefer `include_suppressed` in new code.',
    ),
}

const searchArticlesArgs = z.object(searchArticlesInputShape)

export type SearchArticlesArgs = z.infer<typeof searchArticlesArgs>

export type SearchArticleHit = {
  id: string
  slug: string
  title: string
  summary: string
  source_url: string
  target_id: string
  created_at: string
  hidden: boolean
  dashboard_visible: boolean
  rank: number
}

export async function searchArticles(
  input: SearchArticlesArgs,
): Promise<{ hits: SearchArticleHit[] }> {
  const limit = input.limit ?? 10
  // Audit round 9: emit a structured deprecation warning whenever the
  // caller passes `include_hidden` at all (regardless of value). We
  // need to know when it's safe to remove the alias — a span of zero
  // emissions across a release cycle is the signal. Logged at warn so
  // it surfaces in normal operator dashboards without needing a debug
  // toggle. We do not echo the value to keep the log row stable
  // regardless of true/false.
  if (input.include_hidden !== undefined) {
    logger.warn('deprecated_arg_used', {
      tool: 'search_articles',
      arg: 'include_hidden',
    })
  }
  // `include_suppressed` is the canonical flag; `include_hidden` is a
  // deprecated alias. Either being true opens up BOTH filters.
  const includeSuppressed = input.include_suppressed === true || input.include_hidden === true
  const rank = sql<number>`ts_rank(${articles.tsvector}, plainto_tsquery('english', ${input.query}))`

  const matchPredicate = sql`${articles.tsvector} @@ plainto_tsquery('english', ${input.query})`
  // Only filter hidden + dashboard_visible when include_suppressed is false —
  // dedup callers need to see suppressed rows so they don't re-research them.
  const wherePredicate = includeSuppressed
    ? matchPredicate
    : and(eq(articles.hidden, false), eq(articles.dashboardVisible, true), matchPredicate)

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      sourceUrl: articles.sourceUrl,
      targetId: articles.targetId,
      createdAt: articles.createdAt,
      hidden: articles.hidden,
      dashboardVisible: articles.dashboardVisible,
      rank,
    })
    .from(articles)
    .where(wherePredicate)
    .orderBy(sql`${rank} desc`)
    .limit(limit)

  return {
    hits: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      source_url: r.sourceUrl,
      target_id: r.targetId,
      created_at: r.createdAt.toISOString(),
      hidden: r.hidden,
      dashboard_visible: r.dashboardVisible,
      rank: r.rank,
    })),
  }
}
