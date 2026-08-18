/**
 * Settings → Badges (Phase 2 — closes #33).
 *
 * Server component: loads `topic_badges` and unresolved
 * `topic_badge_suggestions`, then hands them to a single client-side
 * `<BadgesPanel>` for the interactive UI. The auth gate happens one
 * level up in `apps/web/app/settings/layout.tsx`, so this page only
 * gets rendered for an authenticated admin.
 *
 * Why a single client component owns both sections:
 *   - Bulk approve/reject in the suggestion inbox needs shared selection
 *     state, and approve flows write into `topic_badges` — which the
 *     curated section needs to re-fetch. Co-locating the two avoids
 *     prop-drilling a refresh callback through a server boundary.
 *   - All mutations route through `router.refresh()`, which re-runs THIS
 *     server component and pipes new data back into `<BadgesPanel>`.
 *     That's why no client-side state mirror of the lists exists — the
 *     server is the source of truth.
 */

import { db } from '@lucidindex/db/client'
import { asc, desc, eq } from '@lucidindex/db/query'
import { articles, topicBadgeSuggestions, topicBadges } from '@lucidindex/db/schema'
import { type BadgeRow, BadgesPanel, type SuggestionRow } from './_components/BadgesPanel'

export const dynamic = 'force-dynamic'

export default async function BadgesPanelPage() {
  const [badgeRows, suggestionRows] = await Promise.all([
    db
      .select()
      .from(topicBadges)
      .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.createdAt)),
    db
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
      .orderBy(desc(topicBadgeSuggestions.lastSeenAt)),
  ])

  const initialBadges: BadgeRow[] = badgeRows.map((b) => ({
    id: b.id,
    name: b.name,
    displayOrder: b.displayOrder,
    hidden: b.hidden,
    createdAt: b.createdAt.toISOString(),
  }))

  const initialSuggestions: SuggestionRow[] = suggestionRows.map((s) => ({
    id: s.id,
    name: s.name,
    count: s.count,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    articleId: s.articleId,
    articleSlug: s.articleSlug,
    articleTitle: s.articleTitle,
  }))

  return <BadgesPanel initialBadges={initialBadges} initialSuggestions={initialSuggestions} />
}
