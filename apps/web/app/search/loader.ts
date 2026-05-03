/**
 * Search loader (#73).
 *
 * Two backends:
 *
 *   - `LUCIDINDEX_MOCK=1` → in-process substring filter over the mock
 *     article set. Same filter rules as the real-DB path
 *     (`dashboard_visible = true OR includeArchived`). The mocks
 *     opt one article into "archived" via `dashboardVisible: false`
 *     so the "Include archived" toggle has a visible effect.
 *
 *   - Default → Postgres FTS via `articles.tsvector` (generated column
 *     populated from `title || summary || agent_deep_dive`, indexed
 *     with GIN — see `packages/db/schema/articles.ts`). Uses
 *     `plainto_tsquery('english', $1)` so user input is sanitized at
 *     the planner level (no SQL injection risk via the `q` param;
 *     drizzle parameterizes `sql.placeholder`-style binds anyway).
 *
 * Hard rules from the spec:
 *   - Cap at 50 results — search is a discovery affordance, not a
 *     dump-everything endpoint.
 *   - Order by ts_rank_cd DESC so the strongest matches lead.
 */

import { db } from '@lucidindex/db/client'
import { sql } from '@lucidindex/db/query'
import { mockArticles } from '@/app/_mock/articles'

/** Hard cap on the result set — keeps the page bounded. */
export const SEARCH_RESULT_LIMIT = 50

/**
 * The minimum-shape view model the search route renders against.
 * Mirrors `MockArticle` for the fields the dashboard tile reads, which
 * lets the search results page reuse `ArticleCard` without adapter code.
 */
export type SearchResult = {
  id: string
  slug: string
  title: string
  summary: string
  topicBadges: string[]
  significance: 'small' | 'medium' | 'large'
  publishedLabel: string
  publishedEstimated: boolean
  publishedAt: string
  heroImageUrl: string
  agentLabel: string
  creatorLabel?: string
  creatorSlug?: string
  readMinutes: number
  reasonablenessRating: number | null
  crossSource: never[]
  sourceUrl: string
  /** Whether the article was rolled off the dashboard (Phase 7 #72). */
  archived: boolean
}

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

type DbSearchRow = {
  id: string
  slug: string
  title: string
  summary: string
  topic_badges: string[] | null
  significance: string
  source_published_at: string | Date | null
  source_published_at_estimated: boolean
  hero_image_hash: string | null
  agent_label: string | null
  creator_label: string | null
  creator_slug: string | null
  reasonableness_rating: number | null
  source_url: string
  dashboard_visible: boolean
}

function formatPublishLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  const year = d.getUTCFullYear()
  return `${day}. ${month} ${year}`
}

function rowToResult(row: DbSearchRow): SearchResult {
  const publishedIso = row.source_published_at
    ? row.source_published_at instanceof Date
      ? row.source_published_at.toISOString()
      : new Date(row.source_published_at).toISOString()
    : ''
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    topicBadges: row.topic_badges ?? [],
    significance: (row.significance as 'small' | 'medium' | 'large') ?? 'small',
    publishedLabel: formatPublishLabel(publishedIso || null),
    publishedEstimated: row.source_published_at_estimated,
    publishedAt: publishedIso,
    heroImageUrl: row.hero_image_hash ? `/i/${row.hero_image_hash}` : '',
    agentLabel: row.agent_label ?? 'unknown',
    ...(row.creator_label ? { creatorLabel: row.creator_label } : {}),
    ...(row.creator_slug ? { creatorSlug: row.creator_slug } : {}),
    readMinutes: 1, // search results don't load deep-dive bodies
    reasonablenessRating: row.reasonableness_rating ?? null,
    crossSource: [],
    sourceUrl: row.source_url,
    archived: !row.dashboard_visible,
  }
}

/**
 * Run a search. Returns up to {@link SEARCH_RESULT_LIMIT} matches.
 *
 * `query` is trimmed and treated as a `plainto_tsquery` input — so
 * "webgpu compute" matches articles containing both terms. Empty
 * query short-circuits to an empty array (the page renders the
 * editorial empty state in that case).
 */
export async function searchArticles(
  query: string,
  options: { includeArchived?: boolean } = {},
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const includeArchived = options.includeArchived === true

  if (MOCK_MODE) {
    const needle = trimmed.toLowerCase()
    return mockArticles
      .filter((a) => {
        if (!includeArchived && a.dashboardVisible === false) return false
        const haystack = `${a.title} ${a.summary} ${a.agentDeepDive ?? ''}`.toLowerCase()
        return haystack.includes(needle)
      })
      .slice(0, SEARCH_RESULT_LIMIT)
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        topicBadges: a.topicBadges,
        significance: a.significance,
        publishedLabel: a.publishedLabel,
        publishedEstimated: a.publishedEstimated,
        publishedAt: a.publishedAt,
        heroImageUrl: a.heroImageUrl,
        agentLabel: a.agentLabel,
        ...(a.creatorLabel ? { creatorLabel: a.creatorLabel } : {}),
        ...(a.creatorSlug ? { creatorSlug: a.creatorSlug } : {}),
        readMinutes: a.readMinutes,
        reasonablenessRating: a.reasonablenessRating,
        crossSource: [],
        sourceUrl: a.sourceUrl,
        archived: a.dashboardVisible === false,
      }))
  }

  // Real-DB FTS path.
  //
  // - `plainto_tsquery('english', $1)` parses user input safely (handles
  //   quotes, ampersands, etc. without throwing).
  // - The dashboard-visibility branch uses a parameter so the planner
  //   can prepare a single statement.
  // - LEFT JOINs to `agent_tokens` and `targets` for the byline + creator
  //   slug — same shape the dashboard / article-page loaders use.
  const rows = await db.execute<DbSearchRow>(sql`
    SELECT
      a.id,
      a.slug,
      a.title,
      a.summary,
      a.topic_badges,
      a.significance,
      a.source_published_at,
      a.source_published_at_estimated,
      a.hero_image_hash,
      a.dashboard_visible,
      ag.label AS agent_label,
      t.label  AS creator_label,
      t.slug   AS creator_slug,
      a.reasonableness_rating,
      a.source_url
    FROM articles a
    LEFT JOIN agent_tokens ag ON ag.id = a.agent_token_id
    LEFT JOIN targets      t  ON t.id  = a.target_id
    WHERE a.tsvector @@ plainto_tsquery('english', ${trimmed})
      AND (a.dashboard_visible = true OR ${includeArchived} = true)
    ORDER BY ts_rank_cd(a.tsvector, plainto_tsquery('english', ${trimmed})) DESC
    LIMIT ${SEARCH_RESULT_LIMIT}
  `)

  return rows.map(rowToResult)
}
