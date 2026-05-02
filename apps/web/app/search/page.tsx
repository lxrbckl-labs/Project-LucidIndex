/**
 * Search route (#73) — Phase 6 shadcn rebuild.
 *
 * Public by design — there is no auth gate (the article page is also
 * public, so search has to mirror that). Admin-only interactions stay
 * gated at the action level, not the route level.
 *
 * URL contract (unchanged):
 *   - `?q=<term>`              — the search query (required to render results).
 *   - `?include_archived=1`    — when set, includes articles with
 *                                `dashboard_visible = false` (rolled off
 *                                by the Phase 7 #72 retention purge).
 *
 * Anatomy:
 *
 *   <TopNav>             ← shadcn chrome (Phase 3); Wordmark lives here
 *   <SearchFilterForm>   ← client component: shadcn Input + Checkbox + Label
 *   results count        ← text-sm text-muted-foreground
 *   <Results>            ← reuses ArticleCard (already shadcn'd in Phase 4)
 *   <EmptyState>         ← shadcn Card centered with suggestion copy
 *   <ResultsHint>        ← shown when no query supplied
 */

import { TopNav } from '@/components/chrome/TopNav'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from './EmptyState'
import { searchArticles } from './loader'
import { Results } from './Results'
import { ResultsHint } from './ResultsHint'
import { SearchFilterForm } from './SearchFilterForm'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function readStringParam(params: SearchParams, key: string): string {
  const raw = params[key]
  if (!raw) return ''
  return Array.isArray(raw) ? (raw[0] ?? '') : raw
}

function readIncludeArchived(params: SearchParams): boolean {
  const raw = readStringParam(params, 'include_archived')
  return raw === '1' || raw === 'true' || raw === 'on'
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const query = readStringParam(params, 'q').trim()
  const includeArchived = readIncludeArchived(params)

  // Run the search server-side. Empty query short-circuits in the loader.
  const results = query ? await searchArticles(query, { includeArchived }) : []

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Page heading */}
        <h1 className="sr-only">Search</h1>

        {/* Search form — client component so shadcn Checkbox + router work */}
        <SearchFilterForm query={query} includeArchived={includeArchived} />

        <Separator className="my-6" />

        {/* Results count */}
        {query && results.length > 0 ? (
          <p className="mb-4 text-sm text-muted-foreground" data-testid="search-count">
            {results.length} {results.length === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
          </p>
        ) : null}

        {/* Results — three cases: no query, empty result set, has results */}
        {!query ? (
          <ResultsHint />
        ) : results.length === 0 ? (
          <EmptyState query={query} includeArchived={includeArchived} />
        ) : (
          <Results results={results} />
        )}
      </main>
    </div>
  )
}
