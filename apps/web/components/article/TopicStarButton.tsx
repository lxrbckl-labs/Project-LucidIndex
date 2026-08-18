'use client'

/**
 * TopicStarButton — client component for starring/unstarring a topic.
 *
 * Rendered inside the server-component TopicProfileTile footer. Reads +
 * writes localStorage via `useTopicPrefs()`. Mirrors TopicFocusCard's star
 * (and CreatorStarButton's style) so the topic card and author card read as
 * a set.
 */

import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTopicPrefs } from '@/lib/topic-prefs'

type Props = {
  topicName: string
}

export function TopicStarButton({ topicName }: Props) {
  const { starred, toggleStar } = useTopicPrefs()
  const isStarred = starred.has(topicName)

  return (
    <Button
      variant="ghost"
      size="icon"
      className="border shrink-0"
      onClick={() => toggleStar(topicName)}
      aria-pressed={isStarred}
      aria-label={isStarred ? `Unstar ${topicName}` : `Star ${topicName}`}
    >
      <Star className={`h-4 w-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
    </Button>
  )
}
