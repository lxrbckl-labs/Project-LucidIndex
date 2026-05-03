'use client'

/**
 * TopicFocusHeader — header row for the dashboard topic-focus view.
 *
 * Rendered when `?badge=<name>` is present on the dashboard. Replaces the
 * TopicBadgeFilterRow pills for the duration of the focused view.
 *
 * Layout:
 *   [← Back]    TOPIC NAME    [Star toggle]  [EyeOff toggle]
 *
 * Back → router.push('/') to clear ?badge and return to default view.
 * Star / Not-interested toggles read from and write to localStorage via
 * `useTopicPrefs()`.
 */

import { ArrowLeft, EyeOff, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useTopicPrefs } from '@/lib/topic-prefs'

type Props = {
  topicName: string
}

export function TopicFocusHeader({ topicName }: Props) {
  const router = useRouter()
  const { starred, notInterested, toggleStar, toggleNotInterested } = useTopicPrefs()

  const isStarred = starred.has(topicName)
  const isNotInterested = notInterested.has(topicName)

  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      {/* Left: back button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 border border-input shrink-0"
        onClick={() => router.push('/')}
        aria-label="Back to all topics"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {/* Center: topic name */}
      <h1 className="text-2xl font-bold tracking-wider uppercase text-foreground flex-1 text-center">
        {topicName}
      </h1>

      {/* Right: star + not-interested toggles */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 border border-input"
          onClick={() => toggleStar(topicName)}
          aria-pressed={isStarred}
          aria-label={isStarred ? `Unstar ${topicName}` : `Star ${topicName}`}
        >
          <Star className={`h-4 w-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 border border-input"
          onClick={() => toggleNotInterested(topicName)}
          aria-pressed={isNotInterested}
          aria-label={
            isNotInterested
              ? `Restore ${topicName} (currently hidden)`
              : `Hide articles tagged ${topicName}`
          }
        >
          <EyeOff
            className={`h-4 w-4 ${isNotInterested ? 'opacity-100' : 'opacity-50'}`}
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  )
}
