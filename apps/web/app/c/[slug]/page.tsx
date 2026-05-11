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
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { CreatorProfileTile } from './CreatorProfileTile'
import { loadCreatorArticles, loadCreatorBySlug, loadCreatorSentiment } from './loader'

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

    const profileTile = (
      <CreatorProfileTile
        slug={slug}
        label={creator.label}
        description={null}
        socialUrl={null}
        photoUrl={null}
        articleCount={articles.length}
        sentiment={null}
      />
    )

    return (
      <CreatorPageLayout label={creator.label}>
        <ArticleMasonry articles={articles} prefix={profileTile} />
      </CreatorPageLayout>
    )
  }

  // Real-DB path. `loadCreatorBySlug` also performs the lazy slug backfill
  // (get-or-set): if the target's `slug` column is null, it generates +
  // persists the slug and returns the target. This means existing targets
  // silently get their slug on first creator-page visit.
  const creator = await loadCreatorBySlug(slug)
  if (!creator) notFound()

  const [articles, sentiment] = await Promise.all([
    loadCreatorArticles(creator.id),
    loadCreatorSentiment(creator.id),
  ])

  const profileTile = (
    <CreatorProfileTile
      slug={slug}
      label={creator.label}
      description={creator.description}
      socialUrl={creator.socialUrl}
      photoUrl={creator.photoUrl}
      articleCount={articles.length}
      sentiment={sentiment}
    />
  )

  return (
    <CreatorPageLayout label={creator.label}>
      <ArticleMasonry articles={articles} prefix={profileTile} />
    </CreatorPageLayout>
  )
}

// ---------------------------------------------------------------------------
// Layout wrapper — shared between mock and real-DB paths.
// ---------------------------------------------------------------------------

function CreatorPageLayout({
  label: _label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="px-4 pb-4">{children}</main>
      <SiteFooter />
    </div>
  )
}
