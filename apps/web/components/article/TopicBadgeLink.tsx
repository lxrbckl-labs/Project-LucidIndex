'use client'

/**
 * TopicBadgeLink — a topic badge in the article header that filters the
 * dashboard to that topic.
 *
 * Links to `/?badge=<topic>`, but flags the navigation so the dashboard opens
 * at the top of the topic rather than at a browser-restored scroll position
 * (see <ScrollTopOnArrive> for the full rationale). The filter pills on the
 * dashboard intentionally preserve scroll, so this top-reset is scoped to the
 * article entry point via the one-shot flag rather than applied globally.
 */

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { SCROLL_TOP_FLAG } from './ScrollTopOnArrive'

export function TopicBadgeLink({ badge }: { badge: string }) {
  return (
    <Link
      href={`/?badge=${encodeURIComponent(badge)}`}
      onClick={() => {
        try {
          window.sessionStorage.setItem(SCROLL_TOP_FLAG, '1')
        } catch {
          // sessionStorage unavailable — fall back to default scroll behavior.
        }
      }}
      className="rounded-md transition-opacity hover:opacity-80"
    >
      <Badge variant="outline">{badge}</Badge>
    </Link>
  )
}
