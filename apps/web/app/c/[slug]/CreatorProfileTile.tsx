/**
 * CreatorProfileTile — same shape as `ArticleCard`, repurposed as the
 * "profile" pinned at index 0 of the creator masonry.
 *
 * Anatomy (mirrors ArticleCard so the grid stays uniform):
 *   - hero band: gradient identicon with the creator's first letter (no image)
 *   - CardHeader: article-count "badge" + title + handle byline
 *   - CardContent: description (line-clamped)
 *   - CardFooter: sentiment gauge (left) + star + optional external-link icon (right)
 */

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { CreatorStarButton } from './CreatorStarButton'
import type { CreatorSentiment } from './loader'
import { SentimentGauge } from './SentimentGauge'

type Props = {
  slug: string
  label: string
  description: string | null
  socialUrl: string | null
  photoUrl: string | null
  articleCount: number
  sentiment: CreatorSentiment | null
}

/**
 * Map the creator's name to a stable hue for the identicon block. Keeps
 * the same creator looking the same across renders without persisting
 * any per-creator color in the DB.
 */
function hueFromString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function CreatorProfileTile({
  slug,
  label,
  description,
  socialUrl,
  photoUrl,
  articleCount,
  sentiment,
}: Props) {
  const showGauge = sentiment !== null && sentiment.count >= 3
  const initial = (label.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '?').toUpperCase()
  const hue = hueFromString(label)

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* Hero band — photo when available, gradient identicon as fallback. */}
      {photoUrl ? (
        // biome-ignore lint/performance/noImgElement: external creator photos served as-is for v1
        <img
          src={photoUrl}
          alt={`${label} portrait`}
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      ) : (
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
      )}

      <CardHeader className="pb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <CardTitle className="font-display text-2xl font-bold uppercase tracking-tight leading-tight">
            {label}
          </CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {articleCount} {articleCount === 1 ? 'article' : 'articles'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {description ? (
          <p className="text-sm text-muted-foreground text-justify">{description}</p>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">
            No bio on file yet — the agent will write one on its next pass.
          </p>
        )}
      </CardContent>

      {/* Sentiment band — divider above, sits directly under the description. */}
      {showGauge && sentiment && (
        <div className="px-6 py-4 border-t border-border/40">
          <SentimentGauge averageSentiment={sentiment.averageSentiment} count={sentiment.count} />
        </div>
      )}

      <CardFooter className="pt-4 flex items-center justify-end gap-2">
        <CreatorStarButton slug={slug} label={label} />
        {socialUrl && (
          <Button variant="ghost" size="icon" className="border" asChild>
            <a
              href={socialUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label}'s website`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
