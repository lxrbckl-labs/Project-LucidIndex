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
 *       actions: TileShareButton + StarButton + HideArticleButton
 *
 * The whole card wraps in a <Link> for tile-level navigation. Action
 * buttons call stopPropagation + preventDefault so they don't fire the
 * tile's Link navigation.
 *
 * `data-masonry-tile` on the outer Link is preserved for MasonryKeyboardNav.
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

export function ArticleCard({ article }: Props) {
  return (
    <Link
      href={`/a/${article.slug}`}
      className="block h-full no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
      data-masonry-tile=""
    >
      <Card className="h-full flex flex-col overflow-hidden hover:bg-accent/50 transition-colors">
        {/* Hero image or skeleton placeholder */}
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
              <Badge key={badge} variant="secondary">
                {badge}
              </Badge>
            ))}
          </div>

          {/* Title */}
          <CardTitle className="text-base font-semibold leading-snug line-clamp-2">
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
