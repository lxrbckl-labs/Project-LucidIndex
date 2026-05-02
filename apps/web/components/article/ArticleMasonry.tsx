/**
 * ArticleMasonry — shadcn responsive grid layout (#57 / Phase 4).
 *
 * Phase 4 replaces the Fyrre editorial panel-pattern grid (6 curated
 * named-area patterns, 4-col desktop, `grid-template-areas`) with a
 * clean uniform responsive grid:
 *
 *   grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4, gap-4
 *
 * Hero tiles (`effectiveCardSize === 'large'`) span 2 columns on lg+
 * (`lg:col-span-2`) for visual variation. The density gate from
 * `@lucidindex/shared/article-density` still governs whether a
 * candidate article actually gets the hero slot — thin articles fall
 * back to the standard ArticleCard at 1 col.
 *
 * Hero candidacy: every 7th article (0-indexed modulo 7 === 0) is a
 * candidate for a large tile. The `effectiveCardSize` helper gates the
 * final decision — if the article's summary is too thin (<40 words) the
 * tile renders as `ArticleCard` instead of `LargeArticleCard`.
 *
 * Preserved from Phase 3:
 *   - `data-masonry-tile` attribute on tile root elements — MasonryKeyboardNav
 *     depends on this selector.
 *   - `effectiveCardSize` density gate from `@lucidindex/shared/article-density`.
 */

import { effectiveCardSize } from '@lucidindex/shared/article-density'
import type { MockArticle } from '@/app/_mock/articles'
import { ArticleCard } from './ArticleCard'
import { LargeArticleCard } from './LargeArticleCard'

type Props = {
  articles: MockArticle[]
}

/**
 * Determine whether the article at position `index` is a hero candidate.
 * Every 7th article (index % 7 === 0) is eligible. The actual card size
 * is then gated by `effectiveCardSize` to prevent thin articles from
 * occupying the wide slot.
 */
function isHeroCandidate(index: number): boolean {
  return index % 7 === 0
}

export function ArticleMasonry({ articles }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {articles.map((article, index) => {
        const candidate = isHeroCandidate(index) ? 'large' : 'small'
        const size = effectiveCardSize(article, candidate)

        if (size === 'large') {
          return (
            <div key={article.id} className="lg:col-span-2">
              <LargeArticleCard article={article} />
            </div>
          )
        }

        return (
          <div key={article.id}>
            <ArticleCard article={article} />
          </div>
        )
      })}
    </div>
  )
}
