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

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { StarredCreatorsList } from '@/app/favorites/StarredCreatorsList'
import { StarredTopicsList } from '@/app/favorites/StarredTopicsList'
import { StarredArticlesMasonry } from '@/components/article/StarredArticlesMasonry'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default function StarredPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />

      <main className="flex-1 px-4 pt-4 pb-4">
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
            Articles section (client-rendered from localStorage)
        ---------------------------------------------------------------- */}
        <section>
          <p className="text-sm font-medium uppercase tracking-[0.08em] text-muted-foreground mb-3">
            Articles
          </p>
          <StarredArticlesMasonry
            empty={
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-lg font-medium text-foreground">No starred articles yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Star an article from the dashboard or article page to save it here.
                </p>
                <Button variant="outline" size="sm" asChild className="mt-6">
                  <Link href="/">Browse dashboard</Link>
                </Button>
              </div>
            }
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
