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
 *
 * Like ArticleCard, the card body is no longer wrapped in a <Link>.
 * Navigation is via the explicit "View" button in the footer.
 * `data-masonry-tile` lives on the View button's anchor.
 */

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { MockArticle } from '@/app/_mock/articles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StarButton } from './StarButton'
import { TileShareButton } from './TileShareButton'

const BASE_URL =
  process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'

type Props = {
  article: MockArticle
}

export function LargeArticleCard({ article }: Props) {
  return (
    <Card className="h-full flex flex-col overflow-hidden border-foreground hover:bg-accent/50 transition-colors">
      {/* Hero image — wider aspect for the hero variant; visual only */}
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
            <Link
              key={badge}
              href={`/?badge=${encodeURIComponent(badge)}`}
              className="rounded-md hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline" className="border-foreground">
                {badge}
              </Badge>
            </Link>
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

      <CardContent
        className="flex-1 pb-2 overflow-hidden relative"
        style={{
          maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent)',
        }}
      >
        <p className="text-sm text-muted-foreground text-justify">{article.summary}</p>
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
        <Button variant="outline" size="sm" asChild className="border border-foreground">
          <Link href={`/a/${article.slug}`} data-masonry-tile="">
            View
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
