/**
 * Starred articles loader.
 *
 * Returns all articles where `starred = true`, ordered newest-first.
 * Admin-gated at the route level — this loader is only called from the
 * authenticated branch of `app/starred/page.tsx`.
 *
 * Mock mode: filters the in-process mock article set by `starred === true`.
 * Real-DB: queries `articles` with `WHERE starred = true AND hidden = false`.
 */

import { db } from '@lucidindex/db/client'
import { and, desc, eq } from '@lucidindex/db/query'
import { agentTokens, articles, targets } from '@lucidindex/db/schema'
import { mapArticleRowToCard } from '@lucidindex/shared/article-view'
import { type MockArticle, mockArticles } from '@/app/_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export async function loadStarredArticles(): Promise<MockArticle[]> {
  if (MOCK_MODE) {
    return mockArticles.filter((a) => a.starred === true)
  }

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      topicBadges: articles.topicBadges,
      significance: articles.significance,
      sourcePublishedAt: articles.sourcePublishedAt,
      sourcePublishedAtEstimated: articles.sourcePublishedAtEstimated,
      heroImageHash: articles.heroImageHash,
      agentLabel: agentTokens.label,
      creatorLabel: targets.label,
      creatorSlug: targets.slug,
      reasonablenessRating: articles.reasonablenessRating,
      crossSource: articles.crossSource,
      citations: articles.citations,
      sourceUrl: articles.sourceUrl,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(agentTokens, eq(articles.agentTokenId, agentTokens.id))
    .leftJoin(targets, eq(articles.targetId, targets.id))
    .where(and(eq(articles.starred, true), eq(articles.hidden, false)))
    .orderBy(desc(articles.createdAt))

  return rows.map(mapArticleRowToCard) as MockArticle[]
}
