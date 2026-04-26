/**
 * GET /api/settings/badges/suggestions
 *
 * Returns the unresolved `topic_badge_suggestions` for the inbox UI. Each
 * row carries the suggesting article's slug + title so the panel can link
 * out to "the article that triggered this." Resolved suggestions are
 * intentionally excluded — the inbox is a working surface, not a history.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { desc, eq } from '@lucidindex/db/query'
import { articles, topicBadgeSuggestions } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const rows = await db
    .select({
      id: topicBadgeSuggestions.id,
      name: topicBadgeSuggestions.name,
      count: topicBadgeSuggestions.count,
      createdAt: topicBadgeSuggestions.createdAt,
      lastSeenAt: topicBadgeSuggestions.lastSeenAt,
      articleId: topicBadgeSuggestions.articleId,
      articleSlug: articles.slug,
      articleTitle: articles.title,
    })
    .from(topicBadgeSuggestions)
    .leftJoin(articles, eq(articles.id, topicBadgeSuggestions.articleId))
    .where(eq(topicBadgeSuggestions.resolved, false))
    .orderBy(desc(topicBadgeSuggestions.lastSeenAt))

  return NextResponse.json({ ok: true, suggestions: rows })
}
