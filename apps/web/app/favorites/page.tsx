/**
 * Favorites page — `/favorites`.
 *
 * Aggregates four sections, all client-rendered from localStorage:
 *   1. Starred articles      — via <StarredArticlesMasonry> (/api/articles/by-ids)
 *   2. Starred topics        — from localStorage
 *   3. Starred creators      — from localStorage
 *   4. Not-interested topics — from localStorage
 *
 * Public — stars/prefs are a client-only guest preference, no sign-in.
 */

import { StarredArticlesMasonry } from '@/components/article/StarredArticlesMasonry'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { NotInterestedTopicsList } from './NotInterestedTopicsList'
import { StarredCreatorsList } from './StarredCreatorsList'
import { StarredTopicsList } from './StarredTopicsList'

export const dynamic = 'force-dynamic'

export default function FavoritesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />

      <main className="flex-1 px-4 pt-4 pb-4">
        {/* ----------------------------------------------------------------
            Section 1 — Starred articles (client, localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Starred articles</h2>
          <StarredArticlesMasonry />
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
