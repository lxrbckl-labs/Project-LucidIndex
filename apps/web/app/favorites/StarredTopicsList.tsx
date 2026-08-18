'use client'

/**
 * StarredTopicsList — client component for the Favorites page.
 *
 * Reads starred topics from localStorage via `useTopicPrefs()` and renders
 * each as a clickable badge pill that navigates to the dashboard topic-focus
 * view (`/?badge=<name>`).
 */

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { useTopicPrefs } from '@/lib/topic-prefs'

export function StarredTopicsList() {
  const { starred } = useTopicPrefs()
  const router = useRouter()

  if (starred.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No starred topics yet. Star a topic from the dashboard to follow it.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {Array.from(starred)
        .sort()
        .map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => router.push(`/?badge=${encodeURIComponent(name)}`)}
            className="cursor-pointer"
          >
            <Badge
              variant="secondary"
              className="border text-xs uppercase tracking-[0.1em] px-3 py-1 hover:bg-accent transition-colors"
            >
              {name}
            </Badge>
          </button>
        ))}
    </div>
  )
}
