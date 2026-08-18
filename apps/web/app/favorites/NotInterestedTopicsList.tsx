'use client'

/**
 * NotInterestedTopicsList — client component for the Favorites page.
 *
 * Reads not-interested topics from localStorage via `useTopicPrefs()` and
 * renders each with a Restore button that removes the topic from the list.
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTopicPrefs } from '@/lib/topic-prefs'

export function NotInterestedTopicsList() {
  const { notInterested, toggleNotInterested } = useTopicPrefs()

  if (notInterested.size === 0) {
    return <p className="text-sm text-muted-foreground">No topics hidden.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from(notInterested)
        .sort()
        .map((name) => (
          <div key={name} className="flex items-center justify-between gap-4">
            <Badge variant="secondary" className="text-xs uppercase tracking-[0.1em] px-3 py-1">
              {name}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleNotInterested(name)}
              className="shrink-0"
            >
              Restore
            </Button>
          </div>
        ))}
    </div>
  )
}
