/**
 * ArticleCard — shadcn Card tile for the dashboard grid (#58 / Phase 4).
 *
 * Anatomy:
 *   <Card>
 *     hero image (aspect-video, object-cover) or Skeleton placeholder
 *     <CardHeader>
 *       badges row (shadcn <Badge variant="secondary"> per topic)
 *       <CardTitle> article title (line-clamp-2)
 *       byline (text-xs text-muted-foreground: creator + date)
 *     <CardContent>
 *       summary (line-clamp-3 text-sm text-muted-foreground)
 *     <CardFooter>
 *       left: TileShareButton + StarButton
 *       right: View button (<Link href="/a/<slug>")
 *
 * The card is no longer a <Link> wrapper — navigation is via the explicit
 * "View" button in the footer. The card body is decorative on hover only.
 *
 * `data-masonry-tile` lives on the View button's anchor so
 * MasonryKeyboardNav can focus and activate it via Enter.
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

export function ArticleCard({ article }: Props) {
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* Hero image or skeleton placeholder — visual only, not clickable */}
      {article.heroImageUrl ? (
        // biome-ignore lint/performance/noImgElement: dev-only mock heroes
        <img
          src={article.heroImageUrl}
          alt={article.title}
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      ) : (
        <Skeleton className="w-full aspect-video" />
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
              <Badge variant="outline" className="">
                {badge}
              </Badge>
            </Link>
          ))}
        </div>

        {/* Title */}
        <CardTitle className="text-base font-semibold leading-snug line-clamp-2">
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
