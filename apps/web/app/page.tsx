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
 *   - Authenticated admin → the Phase 5 Fyrre-style dashboard:
 *     wordmark + masonry of article cards. When the article list is
 *     empty, the admin-flavored empty state (#62) renders instead of
 *     the masonry — different copy from the public landing because
 *     the admin needs the "go configure a creator" pitch.
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
 */

import { requireAdmin } from '@lucidindex/auth'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
import { AuthenticatedEmptyState } from '@/components/article/AuthenticatedEmptyState'
import { loadDashboardArticles } from './_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export default async function Page() {
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
  // Page chrome here is intentionally minimal: wordmark + hairline rule.
  // The full nav row + filter pill row land in #55 / #61.
  // ---------------------------------------------------------------------
  const articles = await loadDashboardArticles()

  return (
    <main className="min-h-screen bg-paper px-6 pt-16 pb-24 md:px-18">
      <h1
        className="text-[length:var(--text-display-xl)] font-black tracking-tight leading-none text-ink uppercase w-full"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        LUCIDINDEX
      </h1>

      <div className="mt-8 mb-12 h-px w-full bg-[var(--color-card-border)]" />

      {articles.length === 0 ? <AuthenticatedEmptyState /> : <ArticleMasonry articles={articles} />}
    </main>
  )
}
