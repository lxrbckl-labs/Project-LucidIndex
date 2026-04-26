/**
 * Root dashboard route.
 *
 * Branches on session state:
 *
 *   - Unauthenticated visitor → the original Phase 1 empty state
 *     ("Nothing has been filed yet.") — preserved verbatim because the
 *     founding-admin e2e (`tests/e2e/founding-admin.spec.ts`) asserts
 *     this exact copy on the public landing.
 *
 *   - Authenticated admin → the Phase 5 Fyrre-style dashboard, which
 *     after #55 / #61 / #60 looks like:
 *
 *         <TopNav>            ← thin top bar, Settings + Account
 *         <Wordmark>          ← page-spanning LUCIDINDEX
 *         <TopicBadgeFilterRow>  ← single-select pill row, "All" first
 *         <hairline rule>
 *         <LiveArticleStream> ← SSE-driven new-arrival strip (client)
 *         <ArticleMasonry>    ← static masonry, filtered by ?badge=…
 *
 *     When the article list is empty, the admin-flavored empty state
 *     (#62) renders instead of the masonry — different copy from the
 *     public landing because the admin needs the "go configure a
 *     creator" pitch.
 *
 * Mock-article rendering for development and the Phase 5 visual gate
 * (#63): set `LUCIDINDEX_MOCK=1` in the environment when running
 * `next dev`. The mock loader returns 12 fake articles spanning the
 * full significance distribution so the masonry's varied subdivisions
 * read clearly. With the flag unset, real DB articles drive the
 * layout (placeholder loader returns empty until Phase 5 backend
 * wiring lands).
 *
 * `LUCIDINDEX_MOCK=1` ALSO bypasses the session check — the visual gate
 * runs the dev server with no DB and no founding admin, so there is no
 * cookie to validate against. The bypass is gated to mock mode only;
 * production code paths still require a real authenticated session.
 *
 * Filter routing (#61): the active topic-badge filter is encoded in the
 * URL as `?badge=<name>`. This page reads it from `searchParams` and
 * filters the masonry server-side before rendering. The pill row (a
 * client component) is the only thing that writes to the URL.
 */

import { requireAdmin } from '@lucidindex/auth'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
import { AuthenticatedEmptyState } from '@/components/article/AuthenticatedEmptyState'
import { LiveArticleStream } from '@/components/article/LiveArticleStream'
import { TopicBadgeFilterRow } from '@/components/chrome/TopicBadgeFilterRow'
import { TopNav } from '@/components/chrome/TopNav'
import { Wordmark } from '@/components/chrome/Wordmark'
import { loadDashboardArticles, loadDashboardBadges } from './_mock/articles'

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

export default async function Page({
  searchParams,
}: {
  // Next 15 ships searchParams as a Promise — must be awaited before
  // touching its keys.
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const badgeFilter = readBadgeParam(params)

  // In mock mode, skip the session gate entirely — the visual gate runs
  // against a flag-driven dev server that has no admins table populated.
  // Outside mock mode, real session validation still applies.
  const session = MOCK_MODE ? { adminId: 'mock' } : await requireAdmin()

  if (!session) {
    // -------------------------------------------------------------------
    // Public visitor — preserve the Phase 1 empty state exactly.
    // The e2e suite asserts this copy verbatim. Do not change without
    // updating `tests/e2e/founding-admin.spec.ts` first.
    // -------------------------------------------------------------------
    return (
      <main className="min-h-screen bg-paper flex flex-col px-6 pt-16 pb-24 md:px-18">
        {/* Editorial wordmark — page-spanning, visual anchor */}
        <h1
          className="text-[clamp(3rem,12vw,9rem)] font-black tracking-tight leading-none text-ink uppercase w-full"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          LUCIDINDEX
        </h1>

        {/* Hairline rule — editorial separator */}
        <div className="mt-8 mb-12 h-px w-full bg-[var(--color-card-border)]" />

        {/* Empty-state copy — muted, intentional, not transactional */}
        <div className="max-w-[640px]">
          <p className="text-xl font-semibold text-ink leading-snug">Nothing has been filed yet.</p>
          <p className="mt-3 text-base text-[var(--color-muted-700)] leading-relaxed">
            Your agents will be filing articles here. Check back soon.
          </p>
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------------
  // Authenticated admin — full Fyrre-style dashboard.
  // ---------------------------------------------------------------------
  const [allArticles, badgeNames] = await Promise.all([
    loadDashboardArticles(),
    loadDashboardBadges(),
  ])

  // Server-side filter — when `?badge=…` is set, drop articles that
  // don't carry that badge. The pill row's "All" state passes no param.
  const articles = badgeFilter
    ? allArticles.filter((a) => a.topicBadges.includes(badgeFilter))
    : allArticles

  const badgeOptions = badgeNames.map((name) => ({ name }))

  return (
    <div className="min-h-screen bg-paper">
      {/* Thin top nav — Settings + Account links, hairline bottom border. */}
      <TopNav />

      <main className="px-6 pt-12 pb-24 md:px-18">
        {/* Page-spanning wordmark — visual anchor + breathing room. */}
        <div className="py-6 md:py-10">
          <Wordmark />
        </div>

        {/* Topic-badge filter pills — single-select, "All" first. */}
        <div className="mt-6">
          <TopicBadgeFilterRow badges={badgeOptions} />
        </div>

        {/* Hairline rule — editorial separator below the filter row. */}
        <div className="mt-6 mb-12 h-px w-full bg-[var(--color-card-border)]" />

        {/* Live arrivals strip — SSE-driven, fades in new tiles without
            disturbing the static masonry below. */}
        <div className="mb-6">
          <LiveArticleStream badgeFilter={badgeFilter} />
        </div>

        {articles.length === 0 ? (
          <AuthenticatedEmptyState />
        ) : (
          <ArticleMasonry articles={articles} />
        )}
      </main>
    </div>
  )
}
