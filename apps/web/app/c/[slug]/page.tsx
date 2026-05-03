/**
 * Creator page — `/c/<slug>` (#71).
 *
 * Phase 5 rebuild on shadcn primitives with neutral defaults.
 *
 * Renders a scoped view of all articles from a single creator (target).
 * Public by design — same as the article page, no auth gate. The creator
 * slug is derived lazily from `target.label + target.created_at` via
 * `generateSlug` (see `packages/shared/src/slug.ts`).
 *
 * Anatomy (top to bottom):
 *
 *   Page chrome:
 *     - <TopNav>       ← same as dashboard / article page
 *     - Back button    ← <EscapeToBack> (shadcn ghost Button + ChevronLeft)
 *     - <Wordmark>     ← LUCIDINDEX wordmark
 *     - hairline rule
 *
 *   Creator header — shadcn <Card>:
 *     - Creator label (display sans, bold)
 *     - Creator handle / URL — muted body
 *     - Article count — shadcn <Badge variant="secondary">
 *
 *   Below the header:
 *     - <ArticleMasonry> with articles scoped to this creator
 *     - OR an editorial empty state when no articles exist yet
 *
 * Lazy-backfill note: in real-DB mode, the creator page loader calls
 * `getOrSetTargetSlug()` which generates + persists the slug on first
 * access, so existing `targets` rows without a slug are silently
 * migrated on their first creator-page visit. Phase 7 can add a NOT
 * NULL migration once all rows are backfilled.
 *
 * Image note: hero images on creator-page tiles use the same fallback
 * logic as the dashboard. The `/i/[hash]` image-serve route lands in
 * Phase 7 #74.
 *
 * Creator profile: label + handle only. Bio, cover image, etc. are
 * future iterations — don't add them here.
 *
 * Hidden articles: filtered out — consistent with the home dashboard.
 * `dashboard_visible` is NOT filtered here (creator pages show all
 * non-hidden articles regardless of the 14-day retention flag, so
 * the creator's archive stays browsable via their creator page).
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findMockArticlesByCreatorSlug, findMockCreatorBySlug } from '@/app/_mock/articles'
import { ArticleMasonry } from '@/components/article/ArticleMasonry'
import { TopNav } from '@/components/chrome/TopNav'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreatorStarButton } from './CreatorStarButton'
import { loadCreatorArticles, loadCreatorBySlug } from './loader'

// DB-backed (loadCreatorBySlug, loadCreatorArticles) — never statically
// renderable. The lazy slug-backfill side-effect inside loadCreatorBySlug
// also wants real request-time semantics, not build-time.
export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params

  if (MOCK_MODE) {
    const creator = findMockCreatorBySlug(slug)
    if (!creator) return { title: 'Creator not found — LucidIndex' }
    return {
      title: `${creator.label} — LucidIndex`,
      description: `Articles from ${creator.label} on LucidIndex.`,
    }
  }

  const creator = await loadCreatorBySlug(slug)
  if (!creator) return { title: 'Creator not found — LucidIndex' }
  return {
    title: `${creator.label} — LucidIndex`,
    description: `Articles from ${creator.label} on LucidIndex.`,
  }
}

export default async function CreatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (MOCK_MODE) {
    const creator = findMockCreatorBySlug(slug)
    if (!creator) notFound()

    const articles = findMockArticlesByCreatorSlug(slug)

    return (
      <CreatorPageLayout
        slug={slug}
        label={creator.label}
        handle={creator.handle}
        articleCount={articles.length}
      >
        {articles.length === 0 ? (
          <CreatorEmptyState label={creator.label} />
        ) : (
          <ArticleMasonry articles={articles} />
        )}
      </CreatorPageLayout>
    )
  }

  // Real-DB path. `loadCreatorBySlug` also performs the lazy slug backfill
  // (get-or-set): if the target's `slug` column is null, it generates +
  // persists the slug and returns the target. This means existing targets
  // silently get their slug on first creator-page visit.
  const creator = await loadCreatorBySlug(slug)
  if (!creator) notFound()

  const articles = await loadCreatorArticles(creator.id)

  return (
    <CreatorPageLayout
      slug={slug}
      label={creator.label}
      handle={creator.urlOrHandle}
      articleCount={articles.length}
    >
      {articles.length === 0 ? (
        <CreatorEmptyState label={creator.label} />
      ) : (
        <ArticleMasonry articles={articles} />
      )}
    </CreatorPageLayout>
  )
}

// ---------------------------------------------------------------------------
// Layout wrapper — shared between mock and real-DB paths.
// ---------------------------------------------------------------------------

function CreatorPageLayout({
  slug,
  label,
  handle,
  articleCount,
  children,
}: {
  slug: string
  label: string
  handle: string
  articleCount: number
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="px-4 pt-4 pb-16">
        {/* Creator header — shadcn <Card> with label, handle, article count, star. */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
                  {label}
                </CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">{handle}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">
                  {articleCount} {articleCount === 1 ? 'article' : 'articles'}
                </Badge>
                <CreatorStarButton slug={slug} label={label} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0" />
        </Card>

        {/* Article content — masonry or empty state. */}
        {children}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state — rendered when the creator has no published articles yet.
// ---------------------------------------------------------------------------

function CreatorEmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
        Nothing from {label} yet.
      </p>
      <p className="mt-6 max-w-[480px] text-base leading-relaxed text-muted-foreground">
        Your agents haven't filed any articles from this creator. Check back once a run completes.
      </p>
    </div>
  )
}
