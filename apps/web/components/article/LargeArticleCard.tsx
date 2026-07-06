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

type Props = {
  article: MockArticle
}

export function LargeArticleCard({ article }: Props) {
  return (
    <Card className="h-full flex flex-col overflow-hidden">
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
        {/* Title — larger for the hero variant */}
        <CardTitle className="text-2xl font-semibold leading-snug line-clamp-2">
          {article.title}
        </CardTitle>

        {/* Byline: creator + read time. Creator name links to /c/<slug>
            when the article carries a creatorSlug; falls back to plain
            text otherwise (no slug = no destination). */}
        <p className="text-xs text-muted-foreground mt-1">
          {article.creatorLabel ? (
            article.creatorSlug ? (
              <>
                <Link
                  href={`/c/${article.creatorSlug}`}
                  className="font-medium text-foreground hover:underline underline-offset-2"
                >
                  {article.creatorLabel}
                </Link>
                {' · '}
              </>
            ) : (
              <span>{article.creatorLabel} &middot; </span>
            )
          ) : null}
          {article.readMinutes} min
        </p>
      </CardHeader>

      <CardContent className="flex-1 pb-2 overflow-hidden relative">
        <p className="text-sm text-muted-foreground text-justify">{article.summary}</p>

        {/* Badges row */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {article.topicBadges.map((badge) => (
            <Link
              key={badge}
              href={`/?badge=${encodeURIComponent(badge)}`}
              className="rounded-md hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline" className="">
                {badge}
              </Badge>
            </Link>
          ))}
        </div>
      </CardContent>

      <CardFooter className="pt-4 flex items-center justify-between">
        <div className="flex gap-1">
          <TileShareButton slug={article.slug} />
          <StarButton articleId={article.id} />
        </div>
        <Button variant="outline" size="sm" asChild className="border">
          <Link href={`/a/${article.slug}`} data-masonry-tile="">
            View
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
