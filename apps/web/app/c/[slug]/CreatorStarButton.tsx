'use client'

/**
 * CreatorStarButton — client component for starring/unstarring a creator.
 *
 * Rendered inside the server-component CreatorPageLayout. Reads + writes
 * localStorage via `useTopicPrefs()`. Mirrors the topic star button style.
 */

import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTopicPrefs } from '@/lib/topic-prefs'

type Props = {
  slug: string
  label: string
}

export function CreatorStarButton({ slug, label }: Props) {
  const { starredCreators, toggleStarCreator } = useTopicPrefs()
  const isStarred = starredCreators.has(slug)

  return (
    <Button
      variant="ghost"
      size="icon"
      className="border shrink-0"
      onClick={() => toggleStarCreator(slug)}
      aria-pressed={isStarred}
      aria-label={isStarred ? `Unstar ${label}` : `Star ${label}`}
    >
      <Star className={`h-4 w-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
    </Button>
  )
}
