/**
 * Search route (#73).
 *
 * Public by design — there is no auth gate (the article page is also
 * public, so search has to mirror that). Admin-only interactions stay
 * gated at the action level, not the route level.
 *
 * URL contract:
 *   - `?q=<term>`              — the search query (required to render results).
 *   - `?include_archived=1`    — when set, includes articles with
 *                                `dashboard_visible = false` (rolled off
 *                                by the Phase 7 #72 retention purge).
 *
 * Anatomy:
 *
 *   <TopNav>             ← same chrome as dashboard, with the search input
 *   <Wordmark — small>   ← editorial anchor, but visually subdued vs. dashboard
 *   "SEARCH" subhead     ← all-caps small subhead, anchors the page mode
 *   <q rehydrate input>  ← lets admin tweak query without browser back
 *   <archived toggle>    ← form-driven; clicking it submits a GET to /search
 *   <results>            ← list of cards; editorial empty state when N=0
 */

import { ArticleCard } from '@/components/article/ArticleCard'
import { TopNav } from '@/components/chrome/TopNav'
import { Wordmark } from '@/components/chrome/Wordmark'
import { type SearchResult, searchArticles } from './loader'

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

/**
 * The result list re-uses `ArticleCard`, which is typed against
 * `MockArticle`. Adapt the search-result shape into the subset
 * `ArticleCard` actually reads. Keeping this adapter local to the
 * route means `ArticleCard` doesn't grow a search-specific surface.
 */
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
    crossSource: [],
    sourceUrl: r.sourceUrl,
  }
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
    <div className="min-h-screen bg-paper">
      <TopNav />

      <main className="px-6 pt-12 pb-24 md:px-18">
        {/* Smaller wordmark on the search page — the dashboard owns the
            full-bleed treatment; here it's a return-anchor. */}
        <div className="py-4 md:py-6">
          <Wordmark className="text-[clamp(2rem,8vw,5rem)]" />
        </div>

        {/* Subhead — small caps, ALL CAPS "SEARCH" labels the page mode. */}
        <p className="text-sm uppercase tracking-[0.16em] text-[var(--color-muted-700)]">Search</p>

        {/* Hairline rule — editorial separator under the subhead. */}
        <div className="mt-4 mb-8 h-px w-full bg-[var(--color-card-border)]" />

        {/* Form lets the admin tweak the query without browser back; also
            carries the archived toggle as a checkbox. Submitting reloads
            the page with the new params. */}
        <search aria-label="Article search">
          <form method="get" action="/search" className="flex flex-wrap items-center gap-6">
            <label htmlFor="search-q" className="sr-only">
              Search query
            </label>
            <input
              id="search-q"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search articles…"
              autoComplete="off"
              className="min-w-[260px] flex-1 border-b border-[var(--color-card-border)] bg-transparent px-1 py-2 text-[length:var(--text-body)] text-ink placeholder:text-[var(--color-muted-500)] focus:border-ink focus:outline-none"
            />
            <label className="flex items-center gap-2 text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-700)]">
              <input
                type="checkbox"
                name="include_archived"
                value="1"
                defaultChecked={includeArchived}
                className="h-4 w-4 accent-ink"
              />
              Include archived
            </label>
            <button
              type="submit"
              className="border border-ink px-4 py-2 text-[var(--text-meta)] uppercase tracking-[0.12em] text-ink hover:bg-ink hover:text-paper"
            >
              Apply
            </button>
          </form>
        </search>

        <div className="mt-8 mb-8 h-px w-full bg-[var(--color-card-border)]" />

        {/* Results — editorial empty state when no query OR no matches.
            We split the two cases so the empty-state copy can speak to
            the user's intent (no query yet vs. nothing matched). */}
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

function ResultsHint() {
  return (
    <section className="max-w-[640px] py-10">
      <p className="text-xl font-semibold text-ink leading-snug">Type a query to begin.</p>
      <p className="mt-3 text-base text-[var(--color-muted-700)] leading-relaxed">
        Search runs over every article&apos;s title, summary, and deep-dive body.
      </p>
    </section>
  )
}

function EmptyState({ query, includeArchived }: { query: string; includeArchived: boolean }) {
  return (
    <section className="max-w-[640px] py-10" data-testid="search-empty">
      <p className="text-xl font-semibold text-ink leading-snug">
        Nothing matched &ldquo;{query}&rdquo;.
      </p>
      <p className="mt-3 text-base text-[var(--color-muted-700)] leading-relaxed">
        {includeArchived
          ? 'Try a different query or fewer terms.'
          : 'Try a different query, fewer terms, or include archived articles in the search.'}
      </p>
    </section>
  )
}

function Results({ results }: { results: SearchResult[] }) {
  return (
    <section data-testid="search-results">
      <p className="mb-4 text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-700)]">
        {results.length} {results.length === 1 ? 'result' : 'results'}
      </p>
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((result) => (
          <li key={result.id} className="flex">
            <div className="flex w-full flex-col">
              <ArticleCard article={asCardArticle(result)} />
              {result.archived ? (
                <span
                  className="mt-2 inline-flex w-fit border border-[var(--color-card-border)] px-2 py-0.5 text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-500)]"
                  style={{ borderRadius: 'var(--radius-pill)' }}
                >
                  Archived
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
