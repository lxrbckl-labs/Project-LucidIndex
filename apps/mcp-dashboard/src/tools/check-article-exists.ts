// `check_article_exists` — source-level, CROSS-TARGET dedup primitive.
//
// INTENT: dedup is source-level, not target-level. If ANY agent (writing for
// ANY target) has already covered a given source URL, no one should re-cover
// it. So this tool looks up by CANONICAL `source_url` across ALL targets and
// returns the FIRST match it finds, regardless of which target captured it.
// That is the correct shape for a "should I research this URL?" check.
//
// URL normalization (P0 / audit round 3): the input URL is canonicalized via
// `@lucidindex/shared/url`'s `normalizeSourceUrl` before the lookup so
// `https://Example.com/a/`, `https://example.com/a`, and
// `https://example.com/a?utm_source=newsletter` all resolve to the same
// stored row. Migration `0029_normalize_source_urls` backfilled existing
// rows to the canonical form, so the equality lookup against
// `articles.source_url` works without further casing.
//
// Unlike `search_articles`, this is NOT filtered by `hidden` or
// `dashboard_visible` — agents doing dedup MUST see human-suppressed and
// retention-rolled-off articles so they don't waste a research cycle
// re-writing something the corpus has already covered.
//
// Returned shape lets the caller decide what to do:
//   - `{ exists: false }`                       → safe to research + write
//   - `{ exists: true, article: { hidden,    → already covered (possibly by
//                                  dashboard_visible } }` another target); abort
//   - `{ exists: false, normalized, error: 'invalid_source_url' }` → input
//     URL did not parse; nothing was looked up
//
// Performance note: the WHERE clause is on `source_url` alone, so the
// composite `(target_id, source_url)` unique constraint can't service this
// query — Postgres can only use the leading column. A dedicated
// single-column index on `articles.source_url` (added in migration 0028)
// makes the lookup O(log n).
//
// Read-only. Works on either transport (no auth context required).

import { db } from '@lucidindex/db/client'
import { articles, targets } from '@lucidindex/db/schema'
import { InvalidSourceUrlError, normalizeSourceUrl } from '@lucidindex/shared/url'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

export const checkArticleExistsInputShape = {
  source_url: z
    .string()
    .url()
    .describe(
      'The source URL the agent is considering writing about. Server-side canonicalized: tracking params, fragments, default ports, case, www, and trailing slashes all collapse to a single dedup key, so callers can pass the URL as found in the wild.',
    ),
}

const args = z.object(checkArticleExistsInputShape)

export type CheckArticleExistsArgs = z.infer<typeof args>

export type CheckArticleExistsResult = {
  exists: boolean
  /** The canonical form of the input URL (echoed back so the agent can see what we looked up). Always present on a successful normalization. */
  normalized?: string
  /** Set when the input failed to parse — caller should reject the URL rather than retry. */
  error?: 'invalid_source_url'
  article?: {
    id: string
    slug: string
    title: string
    target_id: string
    target_label: string
    hidden: boolean
    dashboard_visible: boolean
    created_at: string
  }
}

export async function checkArticleExists(
  input: CheckArticleExistsArgs,
): Promise<CheckArticleExistsResult> {
  // Normalize the caller's URL into the canonical form used as the dedup
  // key. A parse failure here is reported back without throwing — the agent
  // gets `{ exists: false, error: 'invalid_source_url' }` and can decide
  // whether to retry with a cleaned-up URL or skip the candidate.
  let normalized: string
  try {
    normalized = normalizeSourceUrl(input.source_url)
  } catch (err) {
    if (err instanceof InvalidSourceUrlError) {
      return { exists: false, normalized: input.source_url, error: 'invalid_source_url' }
    }
    throw err
  }

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      targetId: articles.targetId,
      targetLabel: targets.label,
      hidden: articles.hidden,
      dashboardVisible: articles.dashboardVisible,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(eq(articles.sourceUrl, normalized))
    .limit(1)

  if (rows.length === 0) {
    return { exists: false, normalized }
  }

  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const row = rows[0]!
  return {
    exists: true,
    normalized,
    article: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      target_id: row.targetId,
      // leftJoin can technically yield null label if the target row was
      // deleted out from under the article — defensive coalesce keeps the
      // return shape stable.
      target_label: row.targetLabel ?? '',
      hidden: row.hidden,
      dashboard_visible: row.dashboardVisible,
      created_at: row.createdAt.toISOString(),
    },
  }
}
