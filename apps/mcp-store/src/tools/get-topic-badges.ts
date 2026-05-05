// `get_topic_badges` — return the curated topic-badge taxonomy.
//
// Read-only. Ordered by `display_order`, then by `name`. Hidden badges
// (`hidden = true`, set via Settings → Badges) are excluded so agents
// can't attach them to new articles and defeat the hide semantics.

import { db } from '@lucidindex/db/client'
import { topicBadges } from '@lucidindex/db/schema'
import { asc, eq } from 'drizzle-orm'

export type TopicBadge = {
  name: string
  color: string | null
  display_order: number
}

export async function getTopicBadges(): Promise<{ badges: TopicBadge[] }> {
  const rows = await db
    .select({
      name: topicBadges.name,
      color: topicBadges.color,
      displayOrder: topicBadges.displayOrder,
    })
    .from(topicBadges)
    .where(eq(topicBadges.hidden, false))
    .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name))

  return {
    badges: rows.map((r) => ({
      name: r.name,
      color: r.color,
      display_order: r.displayOrder,
    })),
  }
}
