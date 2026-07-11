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
 *     When the article list is empty, the masonry simply doesn't render —
 *     the topic pills / live stream and the footer are all that show.
 *
 * The giant editorial <Wordmark> is dropped from the dashboard body —
 * Wordmark lives in TopNav per Phase 3. A smaller wordmark is shown in
 * the brand row alongside the filter pills.
 *
 * Data-loading and mock-mode behavior is unchanged from Phase 3.
 */

import { requireAdmin } from '@lucidindex/auth'
import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { FilteredArticleMasonry } from '@/components/article/FilteredArticleMasonry'
import { LiveArticleStream } from '@/components/article/LiveArticleStream'
import { MasonryKeyboardNav } from '@/components/article/MasonryKeyboardNav'
import { ScrollTopOnArrive } from '@/components/article/ScrollTopOnArrive'
import { StarredArticlesMasonry } from '@/components/article/StarredArticlesMasonry'
import { TopicProfileTile } from '@/components/article/TopicProfileTile'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopicBadgeFilterRow } from '@/components/chrome/TopicBadgeFilterRow'
import { TopNav } from '@/components/chrome/TopNav'
import { Button } from '@/components/ui/button'
import {
  loadDashboardArticles,
  loadDashboardBadges,
  loadTopicSentimentTimeline,
  loadTopicTopAuthors,
} from './_lib/dashboard-loader'

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

  // Public-readable dashboard: the magazine feed renders for everyone, not just
  // the admin. Load articles/badges up front so the empty-state branch can run.
  // Admin-only actions (star, settings, etc.) stay gated inside their own routes.
  const [articles, badgeNames] = await Promise.all([
    // Stars are a client-only localStorage preference now, so the Starred
    // filter renders client-side (below) — the server feed ignores `starred`.
    loadDashboardArticles({ badge: badgeFilter }),
    loadDashboardBadges(),
  ])

  if (!session && articles.length === 0) {
    // -------------------------------------------------------------------
    // Public visitor, nothing filed yet — preserve the Phase 1 empty state
    // exactly. The e2e suite asserts this copy verbatim.
    // Do not change without updating `tests/e2e/founding-admin.spec.ts`.
    // -------------------------------------------------------------------
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {/* TopNav supplies the LUCIDINDEX wordmark heading the e2e asserts on. */}
        <TopNav />
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
          <div className="mx-auto flex flex-col items-center gap-3 rounded-xl border bg-background p-6 shadow-sm max-w-sm w-full text-center">
            <h2 className="text-xl font-semibold tracking-tight">Nothing has been filed yet.</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">Check back soon.</p>
            <Button variant="default" asChild className="w-full mt-2">
              <Link href="/" data-testid="dashboard-link">
                <LayoutDashboard className="h-5 w-5 mr-2 rotate-90" />
                Dashboard
              </Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // Content grid — rendered for admin AND public visitors. Articles/badges
  // were loaded above so the empty-state branch could run.
  // ---------------------------------------------------------------------
  const badgeOptions = badgeNames.map((name) => ({ name }))

  // Compute topic-focus card metadata (cheap, in-memory from the already-loaded articles list).
  // Use creatorLabel as the author key when present, falling back to creatorSlug —
  // counting on creatorSlug alone produced 0 when targets had a label but no slug.
  const topicFocusCreatorCount = new Set(
    articles
      .map((a) => {
        const x = a as { creatorLabel?: string; creatorSlug?: string }
        return x.creatorLabel ?? x.creatorSlug ?? null
      })
      .filter((v): v is string => Boolean(v)),
  ).size

  // Topic-focus enrichment — only loaded when a badge is selected. Feeds the
  // vertical TopicProfileTile pinned at the head of the article grid.
  const [topAuthors, topicTimeline] = badgeFilter
    ? await Promise.all([loadTopicTopAuthors(badgeFilter), loadTopicSentimentTimeline(badgeFilter)])
    : [[], []]

  const topicCard = badgeFilter ? (
    <TopicProfileTile
      topicName={badgeFilter}
      articleCount={articles.length}
      creatorCount={topicFocusCreatorCount}
      topAuthors={topAuthors}
      timeline={topicTimeline}
    />
  ) : null

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Thin top nav — Settings + Account links. */}
      <TopNav />

      <main className="flex-1 px-4 pt-4 pb-4 flex flex-col gap-4">
        {/* Forces scroll-to-top when arriving via an article topic badge,
            beating the browser's restored scroll position. Renders nothing. */}
        <ScrollTopOnArrive />

        {/* Topic filter pills — hidden in focused view (the topic card now
            lives in the grid as its first cell, so no banner renders here). */}
        {badgeFilter ? null : <TopicBadgeFilterRow badges={badgeOptions} />}

        {/* Live arrivals strip — SSE-driven horizontal scroll. */}
        <LiveArticleStream badgeFilter={badgeFilter} />

        {starredFilter ? (
          /* Starred filter: client-rendered from the viewer's localStorage stars. */
          <StarredArticlesMasonry />
        ) : articles.length === 0 ? null : (
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
              prefix={topicCard}
            />
            {/* Keyboard nav handler — renders nothing visible; attaches
                a window-level keydown listener that walks focus across
                [data-masonry-tile] elements. */}
            <MasonryKeyboardNav />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
