/**
 * Starred articles route — `/starred`.
 *
 * Admin-gated: only the logged-in admin can star articles, so this page
 * redirects public visitors to `/settings/login`. Mock mode skips the
 * session gate entirely (same pattern as the dashboard).
 *
 * Anatomy:
 *   <TopNav>
 *   <main>
 *     heading "Starred"
 *
 *     Topics    ← client-rendered from localStorage via StarredTopicsList
 *       <StarredTopicsList />
 *
 *     Creators  ← client-rendered from localStorage via StarredCreatorsList
 *       <StarredCreatorsList />
 *
 *     Articles  ← server-rendered
 *       <ArticleMasonry> (starred articles)   OR   empty state
 */

import { requireAdmin } from '@lucidindex/auth'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { StarredCreatorsList } from '@/app/favorites/StarredCreatorsList'
import { StarredTopicsList } from '@/app/favorites/StarredTopicsList'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { Button } from '@/components/ui/button'
import { loadStarredArticles } from './loader'

export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export default async function StarredPage() {
  const session = MOCK_MODE ? { adminId: 'mock' } : await requireAdmin()

  if (!session) {
    redirect('/settings/login')
  }

  const articles = await loadStarredArticles()

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="px-4 pt-4 pb-4">
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 border border-input"
            aria-label="Back to dashboard"
            asChild
          >
            <Link href="/">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Starred</h1>
        </div>

        {/* ----------------------------------------------------------------
            Topics section (client-rendered from localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.08em] text-muted-foreground mb-3">
            Topics
          </p>
          <StarredTopicsList />
        </section>

        {/* ----------------------------------------------------------------
            Creators section (client-rendered from localStorage)
        ---------------------------------------------------------------- */}
        <section className="mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.08em] text-muted-foreground mb-3">
            Creators
          </p>
          <StarredCreatorsList />
        </section>

        {/* ----------------------------------------------------------------
            Articles section (server-rendered)
        ---------------------------------------------------------------- */}
        <section>
          <p className="text-sm font-medium uppercase tracking-[0.08em] text-muted-foreground mb-3">
            Articles
          </p>
          {articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-lg font-medium text-foreground">No starred articles yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Star an article from the dashboard or article page to save it here.
              </p>
              <Button variant="outline" size="sm" asChild className="mt-6">
                <Link href="/">Browse dashboard</Link>
              </Button>
            </div>
          ) : (
            <ArticleMasonry articles={articles} />
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
