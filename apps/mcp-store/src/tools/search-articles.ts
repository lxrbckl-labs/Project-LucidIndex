// `search_articles` — full-text search across the article corpus.
//
// Lets agents check "have we already covered this story?" before
// publishing duplicate work under a different URL. Hits the existing
// GIN-indexed `tsvector` column over `title || summary || agent_deep_dive`
// using `plainto_tsquery('english', $1)` — no special syntax expected
// from the caller, plain words are fine.
//
// Returns a small projection (id, slug, title, summary, source_url,
// target_id, source_published_at, created_at) ranked by `ts_rank`
// descending, capped at `limit` (default 10, max 50). Hidden articles
// are excluded so deleted-but-archived rows don't pollute results.

import { db } from '@lucidindex/db/client'
import { articles } from '@lucidindex/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

export const searchArticlesInputShape = {
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).optional(),
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
  source_published_at: string | null
  created_at: string
  rank: number
}

export async function searchArticles(
  input: SearchArticlesArgs,
): Promise<{ hits: SearchArticleHit[] }> {
  const limit = input.limit ?? 10
  const rank = sql<number>`ts_rank(${articles.tsvector}, plainto_tsquery('english', ${input.query}))`

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      summary: articles.summary,
      sourceUrl: articles.sourceUrl,
      targetId: articles.targetId,
      sourcePublishedAt: articles.sourcePublishedAt,
      createdAt: articles.createdAt,
      rank,
    })
    .from(articles)
    .where(
      and(
        eq(articles.hidden, false),
        sql`${articles.tsvector} @@ plainto_tsquery('english', ${input.query})`,
      ),
    )
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
      source_published_at: r.sourcePublishedAt ? r.sourcePublishedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
      rank: r.rank,
    })),
  }
}
