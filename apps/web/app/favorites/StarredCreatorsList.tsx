'use client'

/**
 * StarredCreatorsList — client component for the Favorites and Starred pages.
 *
 * Reads starred creator slugs from localStorage via `useTopicPrefs()` and
 * renders each as a clickable pill that navigates to `/c/<slug>`.
 */

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { useTopicPrefs } from '@/lib/topic-prefs'

export function StarredCreatorsList() {
  const { starredCreators } = useTopicPrefs()
  const router = useRouter()

  if (starredCreators.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No starred creators yet. Star a creator from their page to follow them here.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {Array.from(starredCreators)
        .sort()
        .map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => router.push(`/c/${encodeURIComponent(slug)}`)}
            className="cursor-pointer"
          >
            <Badge
              variant="secondary"
              className="border border-foreground text-xs uppercase tracking-[0.1em] px-3 py-1 hover:bg-accent transition-colors"
            >
              {slug}
            </Badge>
          </button>
        ))}
    </div>
  )
}
