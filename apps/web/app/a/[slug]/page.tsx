/**
 * Standalone article page (#64 / #65 / #66).
 *
 * Phase 5 rebuild on shadcn primitives with neutral defaults.
 *
 * Route: `/a/<slug>` — the per-article home and the canonical share-link
 * target. Public by design (friends opening a share link must NOT hit a
 * login wall); admin-only interactions (star toggle) gate themselves.
 *
 * Anatomy (rendered top-to-bottom inside a single 640px column):
 *
 *   Page chrome:
 *     - <TopNav>       ← Settings + Account links + back button on /a/* (matches dashboard)
 *     - <Wordmark>     ← page-spanning LUCIDINDEX wordmark
 *     - hairline rule
 *
 *   Article header:
 *     - Date pill ("~"-prefixed when source date was estimated)
 *     - Topic badges — shadcn <Badge variant="secondary">
 *
 *   Body (single 640px column, generous editorial whitespace):
 *     - Hero image (aspect-[2/1], rounded corners; placeholder when null)
 *     - Title (<h1 className="text-3xl font-bold tracking-tight">)
 *     - Summary (italic standfirst paragraph)
 *     - Byline + read time
 *     - Agent deep-dive (server-capped at 2000 words for fair-use)
 *     - Reasonableness rating (hidden when null)
 *
 *   Cross-source list (hidden when N=0):
 *     - shadcn <Card> with "Also covered by" header
 *
 *   Bottom interactions:
 *     - Star toggle (admin-gated; renders disabled for public visitors)
 *     - Share button (shadcn Button variant="outline" + Share2)
 *
 * Read-state: this page calls `markRead(article.id)` server-side on
 * every render. The action is a no-op when the row is already read,
 * so revisits don't issue a write — the visit-marks-read semantics
 * cost one update per *unread* visit, not per visit.
 *
 * 404 handling: the loader returns null for missing slugs.
 * The page calls Next.js `notFound()` in that case.
 */

import { requireAdmin } from '@lucidindex/auth'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AgentOpinionSection } from '@/components/article/AgentOpinionSection'
import { CrossSourceList } from '@/components/article/CrossSourceList'
import { MarkSeenOnMount } from '@/components/article/MarkSeenOnMount'
import { ShareLinkButton } from '@/components/article/ShareLinkButton'
import { SourcesSection } from '@/components/article/SourcesSection'
import { StarButton } from '@/components/article/StarButton'
import { TopNav } from '@/components/chrome/TopNav'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { markRead } from './actions'
import { applyFairUseCap, loadArticleBySlug } from './loader'

// DB-backed (loadArticleBySlug, markRead) + session-aware (canInteract via
// requireAdmin) — never statically renderable.
export const dynamic = 'force-dynamic'

/**
 * Resolve the absolute base URL for OG meta tags (#67).
 *
 * Priority order:
 *   1. WEBAUTHN_ORIGIN — already set in all envs, matches the actual
 *      origin the app is served from (used for WebAuthn RP config).
 *   2. LUCIDINDEX_BASE_URL — an explicit override if someone wants to
 *      decouple OG base from the WebAuthn origin.
 *   3. Hard fallback for local dev.
 */
function getBaseUrl(): string {
  return process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'
}

/**
 * generateMetadata — per-article OG + Twitter card metadata (#67).
 *
 * Called by Next.js at request time (server component context) before
 * rendering the page. Returns `Metadata` shaped for og:title,
 * og:description, og:image (absolute URL), og:type=article, and
 * Twitter large-image card.
 *
 * Articles with a `heroImageHash` use the `/i/<hash>` route (Phase 7 #74)
 * for the og:image; articles without one fall back to the static OG
 * placeholder at `/og-placeholder.png`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await loadArticleBySlug(slug)
  if (!article) {
    return { title: 'Not found — LucidIndex' }
  }

  const baseUrl = getBaseUrl()

  // heroImageHash is available on the DB path (loader.ts surfaces it
  // via the heroImageUrl field). For mock mode heroImageUrl is a
  // picsum URL — use it directly; for DB mode construct the `/i/` route.
  const ogImageUrl = article.heroImageUrl
    ? article.heroImageUrl.startsWith('http')
      ? article.heroImageUrl
      : `${baseUrl}${article.heroImageUrl}`
    : `${baseUrl}/og-placeholder.png`

  const articleUrl = `${baseUrl}/a/${slug}`

  return {
    title: `${article.title} — LucidIndex`,
    description: article.summary,
    openGraph: {
      title: article.title,
      description: article.summary,
      type: 'article',
      url: articleUrl,
      images: [{ url: ogImageUrl, alt: article.title }],
      publishedTime: article.publishedAtIso ?? undefined,
      authors: [article.agentLabel ?? 'LucidIndex'],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.summary,
      images: [ogImageUrl],
    },
  }
}

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export default async function ArticlePage({
  params,
}: {
  // Next 15 ships params as a Promise — must be awaited before
  // touching its keys.
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const article = await loadArticleBySlug(slug)
  if (!article) {
    notFound()
  }

  // Mark the article as read on visit. We don't await any side-effect
  // beyond the action itself — the action revalidate-paths nothing
  // (the read flag is invisible on this page) so there's no cache
  // invalidation we need to flush before render.
  // Real-DB: gated to authenticated admins inside the action.
  // Mock-mode: the action mutates the in-process mock array.
  // We only call this when there IS something to update.
  if (!article.read) {
    // Fire-and-forget: we don't need the promise to resolve before
    // rendering. The action is admin-gated server-side, so a public
    // visit no-ops without throwing.
    void markRead(article.id)
  }

  // Public visitors can read but can't star. The button still renders
  // (so the visual anchor stays) but it goes inert.
  const session = MOCK_MODE ? { adminId: 'mock' } : await requireAdmin()
  const canInteract = !!session

  // Apply the fair-use cap to the deep-dive body.
  const bodyText = article.agentDeepDive ?? ''
  const { text: cappedBody, truncated } = applyFairUseCap(bodyText)

  const showRating = article.reasonablenessRating !== null

  // Filed date — when our system ingested this article. Shown as the
  // primary date pill in the header (replaces source-published date,
  // which moves to a supplementary line below the byline).
  const filedLabel = (() => {
    const d = article.createdAt
    const day = d.getUTCDate()
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(d)
    const year = d.getUTCFullYear()
    return `${day} ${month} ${year}`
  })()

  // Source-published date — supplementary "Originally published" line.
  // Null when the source didn't surface a date.
  const originallyPublishedLabel = (() => {
    const sp = article.sourcePublishedAt
    if (!sp) return null
    const prefix = article.publishedEstimated ? '~ ' : ''
    const d = new Date(sp)
    if (Number.isNaN(d.getTime())) return null
    const day = d.getUTCDate()
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(d)
    const year = d.getUTCFullYear()
    return `${prefix}${day} ${month} ${year}`
  })()

  return (
    <div className="min-h-screen bg-background">
      {/* Same chrome as the dashboard so the article reads as a
          magazine page within the same product. */}
      <TopNav />

      {/* Mark article as seen in localStorage on mount — drives the ✓ indicator
          on dashboard tiles. Renders nothing visible. */}
      <MarkSeenOnMount articleId={article.id} />

      {/* Mobile-polished article page.
          The article page is the canonical share-link target — most
          mobile traffic lands here, so polish matters. Px-4 on mobile
          tightens up the page edges; px-6 / md:px-18 picks back up at
          tablet+. */}
      <main className="px-4 pt-4 pb-20 sm:px-6 sm:pt-6 sm:pb-24 md:px-18">
        {/* Reading column — max-w-4xl per assignment spec; preserved
            narrower 640px inner column for prose readability. */}
        <div className="mx-auto max-w-4xl px-0">
          <article className="mx-auto w-full max-w-[640px]">
            {/* Header — topic badges.
                Back button moved to TopNav (rendered on /a/* routes).
                The filed date moved into the metadata grid below. */}
            <header className="flex flex-wrap items-center gap-3">
              {article.topicBadges.map((badge) => (
                <Badge key={badge} variant="secondary">
                  {badge}
                </Badge>
              ))}
            </header>

            {/* Title — <h1>. Placed above the hero so the article reads
                title-first, image-second. The summary that lived here is
                dropped — readers already saw it on the dashboard tile. */}
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              {article.title}
            </h1>

            {/* Creator credit — faint, close-set under the title. */}
            {article.creatorLabel ? (
              <p className="mt-1 text-sm text-muted-foreground">
                by{' '}
                {article.creatorSlug ? (
                  <Link
                    href={`/c/${article.creatorSlug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {article.creatorLabel}
                  </Link>
                ) : (
                  article.creatorLabel
                )}
              </p>
            ) : null}

            {/* Hero image — full-column-width, aspect-[2/1], rounded corners.
                Falls back to a muted-surface placeholder when null. */}
            <figure className="mt-8 aspect-[2/1] w-full overflow-hidden rounded-lg bg-muted">
              {article.heroImageUrl ? (
                // biome-ignore lint/performance/noImgElement: dev-only mock heroes / placeholder route
                <img
                  src={article.heroImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.12em] text-muted-foreground"
                >
                  No hero image
                </div>
              )}
            </figure>

            {/* Metadata strip — modern inline row with lucide icons, vertical
                Separators between segments, and the reasonableness scale taking
                the central available width. Stacks on mobile. */}
            <div className="mt-8 flex flex-col gap-y-3 border-b border-t border-border py-4 text-sm sm:flex-row sm:items-center sm:gap-x-5">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">Indexed</span>
                <span className="font-medium text-foreground">{filedLabel}</span>
              </div>

              {showRating ? (
                <>
                  <Separator orientation="vertical" className="hidden h-5 sm:block" />
                  <div
                    className="flex flex-1 items-center gap-3 min-w-0"
                    data-testid="article-rating"
                  >
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      Bearish
                    </span>
                    <div className="relative h-2 flex-1 rounded-full bg-foreground">
                      <div
                        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background shadow-sm"
                        style={{
                          left: `${((article.reasonablenessRating ?? 0) / 10) * 100}%`,
                        }}
                        role="img"
                        aria-label={`Rating ${article.reasonablenessRating} of 10`}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      Bullish
                    </span>
                  </div>
                </>
              ) : null}

              {originallyPublishedLabel ? (
                <>
                  <Separator orientation="vertical" className="hidden h-5 sm:block" />
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground">Originally</span>
                    <span className="font-medium text-foreground">{originallyPublishedLabel}</span>
                  </div>
                </>
              ) : null}
            </div>

            {/* Agent deep-dive — long-form body. No Tailwind Typography plugin
                installed, so plain text styling: text-base leading-relaxed.
                Whitespace-pre-wrap so paragraph breaks from the source survive
                the cap-trim. */}
            {cappedBody ? (
              <section className="mt-10">
                <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
                  {cappedBody}
                </p>
                {truncated ? (
                  <p className="mt-6 border-t border-border pt-4 text-sm uppercase tracking-[0.08em] text-muted-foreground">
                    Truncated for fair-use
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* Sources — original source + external citations. */}
            <SourcesSection citations={article.citations} />

            {/* Agent opinion — collapsible subjective take on the source.
                Positioned after Sources; always rendered (shows placeholder
                when null so the section is consistently discoverable). */}
            <AgentOpinionSection agentOpinion={article.agentOpinion} />

            {/* Cross-source list — shadcn Card with "Also covered by" header.
                Component renders nothing when N=0. */}
            <CrossSourceList entries={article.crossSource} />

            {/* Bottom interaction row — star + share. */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <StarButton
                articleId={article.id}
                slug={article.slug}
                initialStarred={article.starred}
                disabled={!canInteract}
                variant="labeled"
              />
              <ShareLinkButton url={`${getBaseUrl()}/a/${slug}`} />
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}
