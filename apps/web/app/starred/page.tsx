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
 *     <ArticleMasonry> (starred articles)   OR   empty state
 */

import { requireAdmin } from '@lucidindex/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
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

      <main className="px-4 md:px-6 lg:px-8 pt-6 pb-16">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Starred</h1>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">&larr; Dashboard</Link>
          </Button>
        </div>

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
      </main>
    </div>
  )
}
