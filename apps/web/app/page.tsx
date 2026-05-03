/**
 * Root dashboard route — Phase 4 shadcn rebuild.
 *
 * Branches on session state:
 *
 *   - Unauthenticated visitor → the Phase 1 empty state copy is
 *     preserved verbatim ("Nothing has been filed yet.") because the
 *     founding-admin e2e asserts this exact copy. The surrounding markup
 *     is rebuilt using shadcn Card.
 *
 *   - Authenticated admin → clean shadcn content grid:
 *         <TopNav>                    ← thin top bar (Phase 3, unchanged)
 *         <main>
 *           brand row: <Wordmark> + <TopicBadgeFilterRow>
 *           <LiveArticleStream>        ← SSE new-arrivals, horizontal scroll
 *           <ArticleMasonry>           ← responsive 1/2/3/4-col grid
 *           <MasonryKeyboardNav>       ← invisible keyboard handler
 *
 *     When the article list is empty, <AuthenticatedEmptyState> renders
 *     instead of the masonry.
 *
 * The giant editorial <Wordmark> is dropped from the dashboard body —
 * Wordmark lives in TopNav per Phase 3. A smaller wordmark is shown in
 * the brand row alongside the filter pills.
 *
 * Data-loading and mock-mode behavior is unchanged from Phase 3.
 */

import { requireAdmin } from '@lucidindex/auth'
import { AuthenticatedEmptyState } from '@/components/article/AuthenticatedEmptyState'
import { FilteredArticleMasonry } from '@/components/article/FilteredArticleMasonry'
import { LiveArticleStream } from '@/components/article/LiveArticleStream'
import { MasonryKeyboardNav } from '@/components/article/MasonryKeyboardNav'
import { TopicFocusCard } from '@/components/article/TopicFocusCard'
import { TopicBadgeFilterRow } from '@/components/chrome/TopicBadgeFilterRow'
import { TopNav } from '@/components/chrome/TopNav'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { loadDashboardArticles, loadDashboardBadges } from './_lib/dashboard-loader'

// Reads the iron-session cookie via requireAdmin() and queries the DB for
// articles / badges — never statically renderable.
export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

type SearchParams = Record<string, string | string[] | undefined>

function readBadgeParam(params: SearchParams): string | null {
  const raw = params.badge
  if (!raw) return null
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function readStarredParam(params: SearchParams): boolean {
  const raw = params.starred
  if (!raw) return false
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '1'
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const badgeFilter = readBadgeParam(params)
  const starredFilter = readStarredParam(params)

  // In mock mode, skip the session gate entirely.
  const session = MOCK_MODE ? { adminId: 'mock' } : await requireAdmin()

  if (!session) {
    // -------------------------------------------------------------------
    // Public visitor — preserve the Phase 1 empty state exactly.
    // The e2e suite asserts this copy verbatim.
    // Do not change without updating `tests/e2e/founding-admin.spec.ts`.
    // -------------------------------------------------------------------
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24">
        <Card className="w-full max-w-lg">
          <CardHeader>
            {/* h1 heading — e2e asserts getByRole('heading', { name: 'LUCIDINDEX' }) */}
            <h1 className="text-xl font-semibold uppercase tracking-wider text-card-foreground">
              LUCIDINDEX
            </h1>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold text-foreground leading-snug">
              Nothing has been filed yet.
            </p>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              Your agents will be filing articles here. Check back soon.
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  // ---------------------------------------------------------------------
  // Authenticated admin — shadcn content grid.
  // ---------------------------------------------------------------------
  const [articles, badgeNames] = await Promise.all([
    loadDashboardArticles({ badge: badgeFilter, starred: starredFilter }),
    loadDashboardBadges(),
  ])

  const badgeOptions = badgeNames.map((name) => ({ name }))

  // Compute topic-focus card metadata (cheap, in-memory from the already-loaded articles list)
  const topicFocusCreatorCount = new Set(
    articles.map((a) => (a as { creatorSlug?: string }).creatorSlug).filter(Boolean),
  ).size

  return (
    <div className="min-h-screen bg-background">
      {/* Thin top nav — Settings + Account links. */}
      <TopNav />

      <main className="px-4 pt-4 pb-16">
        {/* Topic filter row OR focus card, depending on ?badge */}
        <div className="mb-6">
          {badgeFilter ? (
            /* Focused view: topic card with star + metadata. Back lives in TopNav. */
            <TopicFocusCard
              topicName={badgeFilter}
              articleCount={articles.length}
              creatorCount={topicFocusCreatorCount}
            />
          ) : (
            /* Default view: topic-badge filter pills */
            <TopicBadgeFilterRow badges={badgeOptions} />
          )}
        </div>

        {/* Live arrivals strip — SSE-driven horizontal scroll. */}
        <div className="mb-6">
          <LiveArticleStream badgeFilter={badgeFilter} />
        </div>

        {articles.length === 0 ? (
          <AuthenticatedEmptyState />
        ) : (
          <>
            {/*
              FilteredArticleMasonry reads notInterested from localStorage
              (client-side) and culls matching articles.
              In focused view (badgeFilter set) skip the not-interested
              filter — the user explicitly chose this topic.
            */}
            <FilteredArticleMasonry
              articles={articles}
              skipNotInterestedFilter={badgeFilter !== null}
            />
            {/* Keyboard nav handler — renders nothing visible; attaches
                a window-level keydown listener that walks focus across
                [data-masonry-tile] elements. */}
            <MasonryKeyboardNav />
          </>
        )}
      </main>
    </div>
  )
}
