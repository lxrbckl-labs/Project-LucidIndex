// `get_topic_badges` — return the curated topic-badge taxonomy.
//
// Read-only. Ordered by `display_order` (nulls last) then by `name`.

import { db } from '@lucidindex/db/client'
import { topicBadges } from '@lucidindex/db/schema'
import { asc, sql } from 'drizzle-orm'

export type TopicBadge = {
  name: string
  color: string | null
  display_order: number | null
}

export async function getTopicBadges(): Promise<{ badges: TopicBadge[] }> {
  const rows = await db
    .select({
      name: topicBadges.name,
      color: topicBadges.color,
      displayOrder: topicBadges.displayOrder,
    })
    .from(topicBadges)
    .orderBy(sql`${topicBadges.displayOrder} asc nulls last`, asc(topicBadges.name))

  return {
    badges: rows.map((r) => ({
      name: r.name,
      color: r.color,
      display_order: r.displayOrder,
    })),
  }
}
