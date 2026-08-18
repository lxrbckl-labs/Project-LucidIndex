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
import type { ReactNode } from 'react'
import type { MockArticle } from '@/app/_mock/articles'
import { ArticleCard } from './ArticleCard'
import { LargeArticleCard } from './LargeArticleCard'

type Props = {
  articles: MockArticle[]
  /**
   * Optional tile to render at index 0 of the grid (e.g. the creator
   * profile on /c/[slug]). Renders before the article tiles and shares
   * the same column rules. Hero-candidate logic is unaffected — the
   * first article still gets the hero check.
   */
  prefix?: ReactNode
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

/**
 * Pick a starting column for a hero (col-span-2) tile based on its hero
 * sequence number — alternates so heroes don't always pin to col 1. With
 * `grid-flow-dense` on the grid, smaller tiles fill the gaps to the left
 * when a hero starts further right, exercising the layout in different
 * places.
 *
 * Patterns rotate through the available start columns at each breakpoint:
 *   lg (3 cols, hero spans 2) → starts cycle 1 / 2
 *   xl (4 cols, hero spans 2) → starts cycle 1 / 2 / 3
 *
 * Class strings are literal so Tailwind's JIT picks them up at build time.
 */
const HERO_COL_STARTS = [
  'lg:col-start-1 xl:col-start-1',
  'lg:col-start-2 xl:col-start-2',
  'lg:col-start-1 xl:col-start-3',
] as const

function heroColStartClasses(heroIndex: number): string {
  return HERO_COL_STARTS[heroIndex % HERO_COL_STARTS.length] ?? HERO_COL_STARTS[0]
}

export function ArticleMasonry({ articles, prefix }: Props) {
  let heroSeq = 0

  return (
    <div className="grid grid-flow-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {prefix && <div>{prefix}</div>}
      {articles.map((article, index) => {
        const candidate = isHeroCandidate(index) ? 'large' : 'small'
        const size = effectiveCardSize(article, candidate)

        if (size === 'large') {
          const colStart = heroColStartClasses(heroSeq)
          heroSeq += 1
          return (
            <div key={article.id} className={`lg:col-span-2 ${colStart}`}>
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
