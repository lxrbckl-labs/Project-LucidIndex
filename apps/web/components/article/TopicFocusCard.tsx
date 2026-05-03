'use client'

/**
 * TopicFocusCard — shadcn Card header for the dashboard topic-focus view.
 *
 * Rendered when `?badge=<name>` is present on the dashboard. Replaces the
 * old TopicFocusHeader inline row.
 *
 * Layout:
 *   <Card>
 *     <CardHeader>
 *       Left:  topic name (font-display, uppercase) + subtitle (N articles, M authors)
 *       Right: star button
 *     Metadata row (badges): article count · author count · last updated · top creator
 *
 * Star button reads from / writes to localStorage via `useTopicPrefs()`.
 * The back button is now handled by TopNav (Part A) — not repeated here.
 */

import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useTopicPrefs } from '@/lib/topic-prefs'

type Props = {
  topicName: string
  articleCount: number
  creatorCount: number
}

export function TopicFocusCard({ topicName, articleCount, creatorCount }: Props) {
  const { starred, toggleStar } = useTopicPrefs()
  const isStarred = starred.has(topicName)

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
              {topicName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {articleCount} {articleCount === 1 ? 'article' : 'articles'} from {creatorCount}{' '}
              {creatorCount === 1 ? 'author' : 'authors'}
            </p>
          </div>

          {/* Star toggle — top-right */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 border border-input shrink-0"
            onClick={() => toggleStar(topicName)}
            aria-pressed={isStarred}
            aria-label={isStarred ? `Unstar ${topicName}` : `Star ${topicName}`}
          >
            <Star className={`h-4 w-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  )
}
