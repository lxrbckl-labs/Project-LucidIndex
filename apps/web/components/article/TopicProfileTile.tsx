/**
 * TopicProfileTile — the topic analog of `CreatorProfileTile`, pinned at
 * index 0 of the dashboard article grid in the `?badge=<topic>` view.
 *
 * Anatomy (mirrors CreatorProfileTile so the two cards read as a set):
 *   - hero band: gradient identicon with the topic's first letter
 *   - CardHeader: TOPIC NAME + "N articles from M authors" subtitle
 *   - Top authors band: chip row of the top 5 authors on this topic
 *   - Sentiment Analysis band: reused CreatorSentimentTimeline
 *   - CardFooter: topic star (client child)
 *
 * Server component — the star is a small client child (TopicStarButton).
 */

import Link from 'next/link'
import { CreatorSentimentTimeline } from '@/app/c/[slug]/CreatorSentimentTimeline'
import type { CreatorSentimentWeek } from '@/app/c/[slug]/loader'
import { Badge } from '@/components/ui/badge'
import { Card, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { TopicStarButton } from './TopicStarButton'

type Props = {
  topicName: string
  articleCount: number
  creatorCount: number
  /** Top authors writing on this topic, most-prolific first (max 5). */
  topAuthors: { label: string; slug: string }[]
  /** Weekly sentiment buckets over the trailing 52 weeks, oldest first. */
  timeline: CreatorSentimentWeek[]
}

/**
 * Map the topic name to a stable hue for the identicon block. Keeps the
 * same topic looking the same across renders without persisting any color
 * in the DB. Identical to CreatorProfileTile's `hueFromString`.
 */
function hueFromString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function TopicProfileTile({
  topicName,
  articleCount,
  creatorCount,
  topAuthors,
  timeline,
}: Props) {
  const initial = (topicName.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '?').toUpperCase()
  const hue = hueFromString(topicName)

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* Hero band — gradient identicon with the topic's first letter. */}
      <div
        className="w-full aspect-video flex items-center justify-center identicon"
        style={
          {
            '--id-hue': hue,
            '--id-hue-shift': (hue + 40) % 360,
          } as React.CSSProperties
        }
        aria-hidden="true"
      >
        <span className="font-display text-7xl font-bold tracking-tight identicon-letter">
          {initial}
        </span>
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <CardTitle className="font-display text-2xl font-bold uppercase tracking-tight leading-tight">
            {topicName}
          </CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {articleCount} {articleCount === 1 ? 'article' : 'articles'} from {creatorCount}{' '}
            {creatorCount === 1 ? 'author' : 'authors'}
          </span>
        </div>
      </CardHeader>

      {/* Top authors — chip row, most-prolific first. Hidden when empty. */}
      {topAuthors.length > 0 && (
        <div className="px-6 py-4 border-t border-border/40 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Top Authors
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {topAuthors.map((author) => (
              <Link
                key={author.slug}
                href={`/c/${author.slug}`}
                className="rounded-md hover:opacity-80 transition-opacity"
              >
                <Badge variant="outline">{author.label}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Sentiment timeline band — hidden when there's no data. */}
      {timeline.length > 0 && (
        <div className="px-6 py-4 border-t border-b border-border/40">
          <CreatorSentimentTimeline data={timeline} />
        </div>
      )}

      <CardFooter className="mt-auto pt-4 flex items-center justify-end gap-2">
        <TopicStarButton topicName={topicName} />
      </CardFooter>
    </Card>
  )
}
