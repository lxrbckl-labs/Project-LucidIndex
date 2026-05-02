/**
 * Pure view-mapping helpers shared between dashboard / creator / article
 * loaders.
 *
 * Lives in `@lucidindex/shared` so the workspace's vitest setup can cover
 * the row → view-model translation without standing up a Postgres instance.
 * The DB-aware loaders (`apps/web/app/_lib/dashboard-loader.ts`,
 * `apps/web/app/c/[slug]/loader.ts`, etc.) consume these helpers after
 * fetching the raw rows — keeping the SQL and the shape-mapping in
 * separate files keeps each one independently testable.
 *
 * Why these helpers exist:
 *
 *   - `formatPublishLabel(iso)` was duplicated in three places:
 *     `apps/web/app/a/[slug]/loader.ts`, `apps/web/app/c/[slug]/loader.ts`,
 *     and `apps/web/app/search/loader.ts`. Each duplicate flagged "could
 *     share a util" in its own header comment. This module collapses them
 *     to a single source of truth.
 *
 *   - `mapArticleRowToCard(row)` is the dashboard / creator-page card
 *     shape — i.e. what `ArticleMasonry` renders against (a superset of
 *     the dashboard tile's needs, kept compatible with the existing
 *     `MockArticle` view model so callers don't branch on backing-store).
 */

/**
 * Format a UTC ISO timestamp as the editorial-style "24. April 2026"
 * pill label. Server-side only; uses `Intl.DateTimeFormat` with a fixed
 * UK locale + UTC time-zone so the slug and the pill agree across
 * environments and the SSR output is stable across regions.
 *
 * Returns the original string when parsing fails so we never throw on a
 * malformed `articles.source_published_at` value (defensive: that
 * column is nullable, but the loaders pre-filter null before calling).
 */
export function formatPublishLabel(iso: string): string {
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
 * Significance buckets — tile-size driver for the masonry. CHECK
 * constraint on `articles.significance` enforces this same triple at
 * the DB level (`articles_significance_check`).
 */
export type ArticleSignificance = 'small' | 'medium' | 'large'

/**
 * One cross-source link rendered under "Other coverage" on the article
 * page. `crossSource` is stored as `jsonb` on the row; this is the
 * decoded shape the view layer renders against.
 */
export type ArticleCrossSourceEntry = {
  title: string
  source_url: string
  publisher?: string
}

/**
 * One external citation attached to an article. Mirrors `ArticleCitation`
 * from `@lucidindex/db/schema` but lives here (in the shared package) so
 * view-layer code and tests can import it without pulling in the DB client.
 */
export type ArticleCitationView = {
  url: string
  title: string
  source_name: string
  accessed_at?: string
  image_url?: string | null
}

/**
 * Dashboard / creator-page card shape — matches `MockArticle` for the
 * fields `ArticleMasonry` reads, so the masonry doesn't need to branch
 * on backing-store. `creatorLabel` / `creatorSlug` are optional because
 * the lazy slug-backfill (Phase 6 #71) means a target row may have a
 * null slug until its first creator-page visit.
 */
export type ArticleCardView = {
  id: string
  slug: string
  title: string
  summary: string
  topicBadges: string[]
  significance: ArticleSignificance
  publishedLabel: string
  publishedEstimated: boolean
  publishedAt: string
  heroImageUrl: string
  agentLabel: string
  creatorLabel?: string
  creatorSlug?: string
  readMinutes: number
  reasonablenessRating: number | null
  crossSource: ArticleCrossSourceEntry[]
  citations: ArticleCitationView[]
  sourceUrl: string
  /**
   * Agent-insertion timestamp — `articles.created_at`. Drives the "NEW"
   * pill (#79). Always populated for DB-backed rows; mock-backed rows
   * synthesize this elsewhere (`getMockCreatedAt`) and don't set it on
   * the card view.
   */
  createdAt: Date
}

/**
 * The minimal raw-row shape the mapper consumes. Defined as the
 * intersection of what the dashboard / creator-page select clauses
 * already pull — so a loader can pass its row straight in without any
 * adapter glue. Every field maps 1:1 to an `articles` column except
 * `agentLabel` (joined from `agent_tokens.label`) and `creatorLabel` /
 * `creatorSlug` (joined from `targets.label` / `targets.slug`).
 */
export type ArticleCardRow = {
  id: string
  slug: string
  title: string
  summary: string
  topicBadges: string[]
  significance: string
  sourcePublishedAt: Date | null
  sourcePublishedAtEstimated: boolean
  heroImageHash: string | null
  agentLabel: string | null
  creatorLabel: string | null
  creatorSlug: string | null
  reasonablenessRating: number | null
  crossSource: unknown
  citations: unknown
  sourceUrl: string
  createdAt: Date
}

/**
 * Estimate read time at 250 wpm from the summary. The dashboard tile
 * doesn't need the deep-dive body, so we estimate from `summary` alone
 * — the article-page loader has its own helper that includes the body
 * for a more accurate per-page read estimate.
 *
 * Floor of 1 minute so a stub article doesn't render "0 Min".
 */
export function estimateCardReadMinutes(summary: string): number {
  const trimmed = summary.trim()
  if (!trimmed) return 1
  const words = trimmed.split(/\s+/).length
  return Math.max(1, Math.round(words / 250))
}

/**
 * Decode the jsonb `cross_source` column into a typed array. drizzle
 * surfaces jsonb as `unknown`; this helper narrows defensively, keeping
 * only entries with the required `title` + `source_url` strings and
 * promoting `publisher` when present.
 */
export function decodeCrossSource(raw: unknown): ArticleCrossSourceEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ArticleCrossSourceEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.title === 'string' && typeof e.source_url === 'string') {
      out.push({
        title: e.title,
        source_url: e.source_url,
        ...(typeof e.publisher === 'string' ? { publisher: e.publisher } : {}),
      })
    }
  }
  return out
}

/**
 * Decode the jsonb `citations` column into a typed array. Mirrors
 * `decodeCrossSource` — defensive narrowing, keeps only entries with the
 * required `url`, `title`, and `source_name` strings.
 */
export function decodeCitations(raw: unknown): ArticleCitationView[] {
  if (!Array.isArray(raw)) return []
  const out: ArticleCitationView[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (
      typeof e.url === 'string' &&
      typeof e.title === 'string' &&
      typeof e.source_name === 'string'
    ) {
      out.push({
        url: e.url,
        title: e.title,
        source_name: e.source_name,
        ...(typeof e.accessed_at === 'string' ? { accessed_at: e.accessed_at } : {}),
        ...(typeof e.image_url === 'string' || e.image_url === null
          ? { image_url: e.image_url as string | null }
          : {}),
      })
    }
  }
  return out
}

/**
 * Build the `/i/<hash>` Route Handler URL for a hero image, or empty
 * string when the article has no hero. The empty-string convention
 * matches the existing creator-page loader and is what `ArticleCard`
 * falls through to when rendering the muted placeholder.
 *
 * Content-hash URLs are immutable by construction — see
 * `apps/web/app/i/[hash]/route.ts` for the cache-control headers and
 * Accept-driven WebP/JPEG content negotiation.
 */
export function heroImageUrlFromHash(hash: string | null): string {
  return hash ? `/i/${hash}` : ''
}

/**
 * Map a raw DB row to the `ArticleCardView` consumed by `ArticleMasonry`.
 * Centralizes the shared decoding logic (publish-label format, hero URL
 * resolution, jsonb decoding, byline/creator fallbacks).
 *
 * `publishedAt` falls back to `createdAt` when `source_published_at` is
 * null — the agent-insertion timestamp is always populated, so we never
 * surface an empty pill. The `publishedEstimated` flag is preserved
 * verbatim so the UI can prefix "~" when the agent guessed the date.
 */
export function mapArticleRowToCard(row: ArticleCardRow): ArticleCardView {
  const publishedDate = row.sourcePublishedAt ?? row.createdAt
  const publishedAtIso = publishedDate.toISOString()
  const publishedLabel = formatPublishLabel(publishedAtIso)

  const significance = ((): ArticleSignificance => {
    if (
      row.significance === 'small' ||
      row.significance === 'medium' ||
      row.significance === 'large'
    ) {
      return row.significance
    }
    return 'small'
  })()

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    topicBadges: row.topicBadges,
    significance,
    publishedLabel,
    publishedEstimated: row.sourcePublishedAtEstimated,
    publishedAt: publishedAtIso,
    heroImageUrl: heroImageUrlFromHash(row.heroImageHash),
    agentLabel: row.agentLabel ?? 'unknown',
    ...(row.creatorLabel ? { creatorLabel: row.creatorLabel } : {}),
    ...(row.creatorSlug ? { creatorSlug: row.creatorSlug } : {}),
    readMinutes: estimateCardReadMinutes(row.summary),
    reasonablenessRating: row.reasonablenessRating,
    crossSource: decodeCrossSource(row.crossSource),
    citations: decodeCitations(row.citations),
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt,
  }
}
