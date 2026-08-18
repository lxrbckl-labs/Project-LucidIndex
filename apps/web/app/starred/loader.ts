/**
 * Article-by-ids loader.
 *
 * Stars are a client-only localStorage preference (`article-prefs.ts`), so the
 * "starred articles" views (/starred, /favorites, the dashboard Starred
 * filter) send the locally-stored ids here and get back card data to render.
 * Public — no auth: anyone can view the articles they've starred.
 *
 * Mock mode: filters the in-process mock article set by id.
 * Real-DB: queries `articles` WHERE id IN (...) AND hidden = false.
 */

import { db } from '@lucidindex/db/client'
import { and, desc, eq, inArray } from '@lucidindex/db/query'
import { agentTokens, articles, targets } from '@lucidindex/db/schema'
import { mapArticleRowToCard } from '@lucidindex/shared/article-view'
import { type MockArticle, mockArticles } from '@/app/_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

/** Cap on ids accepted per request — bounds the query + response size. */
const MAX_IDS = 1000

/** Card-shaped column projection for article-card loaders. */
const cardColumns = {
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
}

/**
 * Load card data for a set of article ids, newest-first. Ids that don't exist
 * (or are hidden) are silently dropped. Returns `[]` for empty input.
 */
export async function loadArticlesByIds(ids: string[]): Promise<MockArticle[]> {
  const unique = Array.from(new Set(ids)).slice(0, MAX_IDS)
  if (unique.length === 0) return []

  if (MOCK_MODE) {
    const wanted = new Set(unique)
    return mockArticles.filter((a) => wanted.has(a.id))
  }

  const rows = await db
    .select(cardColumns)
    .from(articles)
    .leftJoin(agentTokens, eq(articles.agentTokenId, agentTokens.id))
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(and(inArray(articles.id, unique), eq(articles.hidden, false)))
    .orderBy(desc(articles.createdAt))

  return rows.map(mapArticleRowToCard) as MockArticle[]
}
