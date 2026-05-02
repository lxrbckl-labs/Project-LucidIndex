/**
 * LargeArticleCard — hero variant of ArticleCard (#59 / Phase 4).
 *
 * Spans 2 columns on `lg+` via `lg:col-span-2` applied by the masonry
 * wrapper. Visually distinct via sizing only — same shadcn Card primitive.
 *
 * Differences from ArticleCard:
 *   - `lg:col-span-2` on the outer wrapper (applied in ArticleMasonry)
 *   - `aspect-[2/1]` hero image (wider, more dramatic)
 *   - `<CardTitle>` uses `text-2xl` for visual prominence
 */

import Link from 'next/link'
import type { MockArticle } from '@/app/_mock/articles'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { HideArticleButton } from './HideArticleButton'
import { StarButton } from './StarButton'
import { TileShareButton } from './TileShareButton'

const BASE_URL =
  process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'

type Props = {
  article: MockArticle
}

export function LargeArticleCard({ article }: Props) {
  return (
    <Link
      href={`/a/${article.slug}`}
      className="block h-full no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
      data-masonry-tile=""
    >
      <Card className="h-full flex flex-col overflow-hidden hover:bg-accent/50 transition-colors">
        {/* Hero image — wider aspect for the hero variant */}
        {article.heroImageUrl ? (
          // biome-ignore lint/performance/noImgElement: dev-only mock heroes
          <img
            src={article.heroImageUrl}
            alt={article.title}
            className="w-full aspect-[2/1] object-cover"
            loading="lazy"
          />
        ) : (
          <Skeleton className="w-full aspect-[2/1]" />
        )}

        <CardHeader className="pb-2">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {article.topicBadges.map((badge) => (
              <Badge key={badge} variant="secondary">
                {badge}
              </Badge>
            ))}
          </div>

          {/* Title — larger for the hero variant */}
          <CardTitle className="text-2xl font-semibold leading-snug line-clamp-2">
            {article.title}
          </CardTitle>

          {/* Byline: creator + read time */}
          <p className="text-xs text-muted-foreground mt-1">
            {article.creatorLabel ? <span>{article.creatorLabel} &middot; </span> : null}
            {article.readMinutes} min
          </p>
        </CardHeader>

        <CardContent className="flex-1 pb-2">
          <p className="line-clamp-3 text-sm text-muted-foreground">{article.summary}</p>
        </CardContent>

        <CardFooter className="pt-4 flex items-center justify-between">
          <div className="flex gap-1">
            <TileShareButton url={`${BASE_URL}/a/${article.slug}`} />
            <StarButton
              articleId={article.id}
              slug={article.slug}
              initialStarred={article.starred ?? false}
            />
          </div>
          <HideArticleButton articleId={article.id} slug={article.slug} />
        </CardFooter>
      </Card>
    </Link>
  )
}
