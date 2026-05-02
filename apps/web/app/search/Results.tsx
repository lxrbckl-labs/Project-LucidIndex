/**
 * Results — renders the list of search result hits (Phase 6 shadcn rebuild).
 *
 * Each result is rendered via the existing shadcn ArticleCard (Phase 4).
 * Archived results get an additional "Archived" badge below the card.
 *
 * The `asCardArticle` adapter is kept local — it converts `SearchResult`
 * (the minimal loader view-model) to the `MockArticle` subset that
 * `ArticleCard` reads, without expanding either type's public surface.
 */

import { ArticleCard } from '@/components/article/ArticleCard'
import { Badge } from '@/components/ui/badge'
import type { SearchResult } from './loader'

function asCardArticle(r: SearchResult) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    topicBadges: r.topicBadges,
    significance: r.significance,
    publishedLabel: r.publishedLabel,
    publishedEstimated: r.publishedEstimated,
    publishedAt: r.publishedAt,
    heroImageUrl: r.heroImageUrl,
    agentLabel: r.agentLabel,
    creatorLabel: r.creatorLabel,
    creatorSlug: r.creatorSlug,
    readMinutes: r.readMinutes,
    reasonablenessRating: r.reasonablenessRating,
    crossSource: [] as never[],
    sourceUrl: r.sourceUrl,
  }
}

type Props = {
  results: SearchResult[]
}

export function Results({ results }: Props) {
  return (
    <section data-testid="search-results">
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((result) => (
          <li key={result.id} className="flex flex-col">
            <ArticleCard article={asCardArticle(result)} />
            {result.archived ? (
              <div className="mt-2">
                <Badge variant="outline" className="text-muted-foreground">
                  Archived
                </Badge>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
