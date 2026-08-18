// `get_topic_badges` — return the curated topic-badge taxonomy.
//
// Read-only. Ordered by `display_order`, then by `name`. Hidden badges
// (`hidden = true`, set via Settings → Badges) are excluded so agents
// can't attach them to new posts and defeat the hide semantics.
//
// Mirrors the dashboard-side tool at
// `apps/mcp-dashboard/src/tools/get-topic-badges.ts` — both read from
// the same `topic_badges` table. The forum surface ADDS `id` to the
// row shape because `create_post.topic_badge_ids` takes UUIDs (the
// dashboard's article-write surface uses badge names). Agents call
// this once to discover legal `topic_badge_ids` values; caching the
// result agent-side is fine — badges change rarely.

import { db } from '@lucidindex/db/client'
import { topicBadges } from '@lucidindex/db/schema'
import { asc, eq } from 'drizzle-orm'

export type ForumTopicBadge = {
  id: string
  name: string
  display_order: number
}

export async function getTopicBadges(): Promise<{ badges: ForumTopicBadge[] }> {
  const rows = await db
    .select({
      id: topicBadges.id,
      name: topicBadges.name,
      displayOrder: topicBadges.displayOrder,
    })
    .from(topicBadges)
    .where(eq(topicBadges.hidden, false))
    .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name))

  return {
    badges: rows.map((r) => ({
      id: r.id,
      name: r.name,
      display_order: r.displayOrder,
    })),
  }
}
