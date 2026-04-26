/**
 * Article-page server loader (#64).
 *
 * Bridges the two sources of truth that the article page can render
 * against:
 *
 *   - `LUCIDINDEX_MOCK=1` → in-process mock array under `_mock/articles`.
 *     Same flag the dashboard uses, so the visual gate's flag-only run
 *     also covers the per-article page.
 *
 *   - Default → `articles` table via Drizzle. Filters out `hidden = true`
 *     rows (they 404 — Phase 6 #69 will add the admin "hide" action;
 *     this loader respects the column today).
 *
 * The shape returned (`ArticleViewModel`) is deliberately neutral — it
 * is what the page component renders against, regardless of backing
 * store. That keeps the page free of mock-vs-DB branching.
 *
 * Public visibility: the article page is unauthenticated by design
 * (share-link target). The loader does NOT consult the session — the
 * page-level interactions (star button, mark-read) are gated by the
 * server actions instead.
 */

import { db } from '@lucidindex/db/client'
import { and, eq } from '@lucidindex/db/query'
import { agentTokens, articles, targets } from '@lucidindex/db/schema'
import { findMockArticleBySlug, mockArticles } from '@/app/_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export type ArticleCrossSource = {
  title: string
  source_url: string
  publisher?: string
}

/**
 * The minimum-shape view model the article page renders against. Bigger
 * than the dashboard's `MockArticle` because the page surfaces fields
 * the dashboard tile doesn't (deep-dive body, reasonableness rating,
 * cross-source list). Slimmer than the raw DB row in two places: the
 * `id` is a string (uuid), and `crossSource` is decoded into a typed
 * array instead of left as raw `jsonb`.
 */
export type ArticleViewModel = {
  id: string
  slug: string
  title: string
  summary: string
  agentDeepDive: string | null
  topicBadges: string[]
  publishedAtIso: string | null
  publishedLabel: string
  publishedEstimated: boolean
  heroImageUrl: string | null
  agentLabel: string
  /** Creator (target) label — the source being analysed (e.g. "MKBHD"). */
  creatorLabel: string | null
  /** Creator slug for `/c/<slug>` link. Null when the target has no slug yet
   * (lazy backfill — will be populated on first creator-page visit). */
  creatorSlug: string | null
  reasonablenessRating: number | null
  crossSource: ArticleCrossSource[]
  starred: boolean
  read: boolean
  sourceUrl: string
}

/**
 * Format a date as the editorial-style "24. April 2026" pill label —
 * matches the Visual Identity reference and the dashboard pill format.
 * Server-side only; uses Intl.DateTimeFormat with a fixed locale so
 * the slug and the pill agree across environments.
 */
function formatPublishLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  const year = d.getUTCFullYear()
  return `${day}. ${month} ${year}`
}

/**
 * Resolve a slug to a view model, or `null` when the article is missing
 * or hidden. The page maps `null` to a Next.js 404.
 */
export async function loadArticleBySlug(slug: string): Promise<ArticleViewModel | null> {
  if (MOCK_MODE) {
    const mock = findMockArticleBySlug(slug)
    if (!mock) return null
    return {
      id: mock.id,
      slug: mock.slug,
      title: mock.title,
      summary: mock.summary,
      agentDeepDive: mock.agentDeepDive ?? null,
      topicBadges: mock.topicBadges,
      publishedAtIso: mock.publishedAt,
      publishedLabel: mock.publishedLabel,
      publishedEstimated: mock.publishedEstimated,
      heroImageUrl: mock.heroImageUrl,
      agentLabel: mock.agentLabel,
      creatorLabel: mock.creatorLabel ?? null,
      creatorSlug: mock.creatorSlug ?? null,
      reasonablenessRating: mock.reasonablenessRating,
      crossSource: mock.crossSource,
      starred: mock.starred ?? false,
      read: mock.read ?? false,
      sourceUrl: mock.sourceUrl,
    }
  }

  // Real-DB path. Join `articles` to `agent_tokens` (byline) and
  // `targets` (creator label + slug for the creator page link).
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      agentDeepDive: articles.agentDeepDive,
      topicBadges: articles.topicBadges,
      sourcePublishedAt: articles.sourcePublishedAt,
      sourcePublishedAtEstimated: articles.sourcePublishedAtEstimated,
      heroImageHash: articles.heroImageHash,
      agentLabel: agentTokens.label,
      creatorLabel: targets.label,
      creatorSlug: targets.slug,
      reasonablenessRating: articles.reasonablenessRating,
      crossSource: articles.crossSource,
      starred: articles.starred,
      read: articles.read,
      hidden: articles.hidden,
      sourceUrl: articles.sourceUrl,
    })
    .from(articles)
    .leftJoin(agentTokens, eq(articles.agentTokenId, agentTokens.id))
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(and(eq(articles.slug, slug), eq(articles.hidden, false)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const publishedIso = row.sourcePublishedAt ? row.sourcePublishedAt.toISOString() : null
  // Image-serve route at `/i/<hash>` (Phase 7 #74). Returns null when the
  // article has no hero image; the article page falls back to a placeholder.
  const heroImageUrl = row.heroImageHash ? `/i/${row.heroImageHash}` : null

  // jsonb decoded by drizzle is `unknown[]`; narrow defensively.
  const crossSourceRaw = Array.isArray(row.crossSource) ? row.crossSource : []
  const crossSource: ArticleCrossSource[] = []
  for (const entry of crossSourceRaw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.title === 'string' && typeof e.source_url === 'string') {
      crossSource.push({
        title: e.title,
        source_url: e.source_url,
        ...(typeof e.publisher === 'string' ? { publisher: e.publisher } : {}),
      })
    }
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    agentDeepDive: row.agentDeepDive,
    topicBadges: row.topicBadges,
    publishedAtIso: publishedIso,
    publishedLabel: publishedIso ? formatPublishLabel(publishedIso) : '',
    publishedEstimated: row.sourcePublishedAtEstimated,
    heroImageUrl,
    agentLabel: row.agentLabel ?? 'unknown',
    creatorLabel: row.creatorLabel ?? null,
    creatorSlug: row.creatorSlug ?? null,
    reasonablenessRating: row.reasonablenessRating ?? null,
    crossSource,
    starred: row.starred,
    read: row.read,
    sourceUrl: row.sourceUrl,
  }
}

/**
 * Server-side cap on the deep-dive body for fair-use compliance (#66,
 * Round 6). 2000 words is generous for the byline-as-summary use case
 * the product is targeting; longer pieces get truncated with a footer
 * line on the page explaining why.
 *
 * The split is deliberately whitespace-naive — perfect tokenization
 * isn't the goal; "no more than ~2000 words leaves the server" is.
 *
 * Returned tuple: `[truncatedText, didTruncate]` so the page knows
 * whether to render the truncation footer.
 */
export const FAIR_USE_WORD_CAP = 2000

export function applyFairUseCap(body: string): { text: string; truncated: boolean } {
  const tokens = body.split(/\s+/)
  if (tokens.length <= FAIR_USE_WORD_CAP) {
    return { text: body, truncated: false }
  }
  const text = `${tokens.slice(0, FAIR_USE_WORD_CAP).join(' ')}…`
  return { text, truncated: true }
}

/**
 * Estimate read time at 250 wpm from the summary + deep-dive body.
 * Floor of 1 minute so a stub article doesn't render "0 Min".
 */
export function estimateReadMinutes(summary: string, body: string | null): number {
  const all = `${summary} ${body ?? ''}`.trim()
  if (!all) return 1
  const words = all.split(/\s+/).length
  return Math.max(1, Math.round(words / 250))
}

/** Test seam: expose mock article count without leaking the array. */
export function _mockArticleCount(): number {
  return mockArticles.length
}
