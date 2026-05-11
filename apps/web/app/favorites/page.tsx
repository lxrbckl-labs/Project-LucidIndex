/**
 * Favorites page — `/favorites`.
 *
 * Aggregates four sections:
 *   1. Starred articles      — server-rendered via loadStarredArticles()
 *   2. Starred topics        — client-rendered from localStorage
 *   3. Starred creators      — client-rendered from localStorage
 *   4. Not-interested topics — client-rendered from localStorage
 *
 * Auth-gated: redirects unauthenticated visitors to /settings/login.
 */

import { requireAdmin } from '@lucidindex/auth'
import { redirect } from 'next/navigation'
import { loadStarredArticles } from '@/app/starred/loader'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { NotInterestedTopicsList } from './NotInterestedTopicsList'
import { StarredCreatorsList } from './StarredCreatorsList'
import { StarredTopicsList } from './StarredTopicsList'

export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export default async function FavoritesPage() {
  const session = MOCK_MODE ? { adminId: 'mock' } : await requireAdmin()

  if (!session) {
    redirect('/settings/login')
  }

  const starredArticles = await loadStarredArticles()

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="px-4 pt-4 pb-4">
        {/* ----------------------------------------------------------------
            Section 1 — Starred articles (server-rendered)
        ---------------------------------------------------------------- */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Starred articles</h2>

          {starredArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No starred articles yet.</p>
          ) : (
            <ArticleMasonry articles={starredArticles} />
          )}
        </section>

        {/* ----------------------------------------------------------------
            Section 2 — Starred topics (client, localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Starred topics</h2>
          <StarredTopicsList />
        </section>

        {/* ----------------------------------------------------------------
            Section 3 — Starred creators (client, localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Starred creators</h2>
          <StarredCreatorsList />
        </section>

        {/* ----------------------------------------------------------------
            Section 4 — Not-interested topics (client, localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Hidden topics</h2>
          <NotInterestedTopicsList />
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
