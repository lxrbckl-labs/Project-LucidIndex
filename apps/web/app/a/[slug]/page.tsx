/**
 * Standalone article page (#64 / #65 / #66).
 *
 * Route: `/a/<slug>` — the per-article home and the canonical share-link
 * target. Public by design (friends opening a share link must NOT hit a
 * login wall); admin-only interactions (star toggle) gate themselves.
 *
 * Anatomy (rendered top-to-bottom inside a single 820px column):
 *
 *   Page chrome:
 *     - <TopNav>   ← Settings + Account links (matches dashboard)
 *     - <Wordmark> ← page-spanning LUCIDINDEX wordmark
 *     - hairline rule
 *
 *   Article header:
 *     - Date pill ("~"-prefixed when source date was estimated)
 *     - Topic-badge pills (every badge, not just the primary)
 *
 *   Body (single 720-820px column, generous editorial whitespace):
 *     - Hero image (in-frame, object-cover; placeholder when null)
 *     - Title (display, condensed, bold — Bebas Neue from #54)
 *     - Summary (italic standfirst paragraph)
 *     - Byline + read time ("Analysis by <agent.label>" + N min)
 *     - Agent deep-dive (server-capped at 2000 words for fair-use)
 *     - Reasonableness rating (hidden when null)
 *
 *   Cross-source list (hidden when N=0):
 *     - "Other coverage" hairline-bordered text list
 *
 *   Bottom interactions:
 *     - Star toggle (admin-gated; renders disabled for public visitors)
 *     - "Copy share link" skeleton (full UX in #68)
 *
 * Read-state: this page calls `markRead(article.id)` server-side on
 * every render. The action is a no-op when the row is already read,
 * so revisits don't issue a write — the visit-marks-read semantics
 * cost one update per *unread* visit, not per visit.
 *
 * 404 handling: the loader returns null for missing OR `hidden` slugs.
 * The page calls Next.js `notFound()` in both cases. The friendly 404
 * page (#70) is a separate ticket; standard Next.js 404 UI is fine
 * for this PR.
 */

import { requireAdmin } from '@lucidindex/auth'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CrossSourceList } from '@/components/article/CrossSourceList'
import { HideArticleButton } from '@/components/article/HideArticleButton'
import { NewBadge } from '@/components/article/NewBadge'
import { ShareLinkButton } from '@/components/article/ShareLinkButton'
import { StarButton } from '@/components/article/StarButton'
import { TopNav } from '@/components/chrome/TopNav'
import { Wordmark } from '@/components/chrome/Wordmark'
import { getNewBadgeHours, isNew } from '@/lib/new-badge'
import { markRead } from './actions'
import { applyFairUseCap, estimateReadMinutes, loadArticleBySlug } from './loader'

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
  const readMinutes = estimateReadMinutes(article.summary, bodyText)

  const datePrefix = article.publishedEstimated ? '~ ' : ''
  const showRating = article.reasonablenessRating !== null

  // "NEW" pill (#79) — hours window read from settings (60s cache).
  // The badge is measured from agent-insertion time, NOT source publish.
  const newBadgeHours = await getNewBadgeHours()
  const showNewBadge = isNew(article.createdAt, newBadgeHours)

  return (
    <div className="min-h-screen bg-paper">
      {/* Same chrome as the dashboard so the article reads as a
          magazine page within the same product. */}
      <TopNav />

      <main className="px-6 pt-12 pb-24 md:px-18">
        <div className="py-6 md:py-10">
          <Wordmark />
        </div>

        {/* Hairline rule under the wordmark, page-width — matches the
            dashboard's editorial separator. */}
        <div className="mt-6 mb-12 h-px w-full bg-[var(--color-card-border)]" />

        {/* Single-column reading width — 820px max, centered. */}
        <article className="mx-auto w-full max-w-[820px]">
          {/* Header — date pill + NEW pill (when applicable) + every
              topic-badge pill. */}
          <header className="flex flex-wrap items-center gap-3">
            {article.publishedLabel ? (
              <time
                className="inline-flex items-center border border-[var(--color-card-border)] bg-paper px-3 py-1 text-[var(--text-meta)] uppercase tracking-[0.08em] text-[var(--color-muted-700)]"
                style={{ borderRadius: 'var(--radius-pill)' }}
                dateTime={article.publishedAtIso ?? undefined}
              >
                {datePrefix}
                {article.publishedLabel}
              </time>
            ) : null}
            {showNewBadge ? <NewBadge /> : null}
            {article.topicBadges.map((badge) => (
              <span
                key={badge}
                className="inline-flex items-center justify-center border border-ink px-3 py-1 text-[0.65rem] uppercase tracking-[0.08em] text-ink"
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                {badge}
              </span>
            ))}
          </header>

          {/* Hero image — full-column-width, in-frame, object-cover.
              Falls back to a muted-surface placeholder when null. The
              placeholder is intentionally simple — Phase 7 #74 lands
              the image-serve route, after which `heroImageUrl` is
              always populated for real articles. */}
          <figure className="mt-10 aspect-[16/9] w-full overflow-hidden bg-[var(--color-muted-300)]">
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
                className="flex h-full w-full items-center justify-center text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-500)]"
              >
                No hero image
              </div>
            )}
          </figure>

          {/* Title — display sans, condensed, bold. */}
          <h1
            className="font-display mt-10 text-[length:var(--text-display-lg)] font-black leading-[0.95] tracking-tight text-ink"
            style={{ letterSpacing: '-0.02em' }}
          >
            {article.title}
          </h1>

          {/* Summary — italicized standfirst-style intro. */}
          <p className="mt-6 text-[length:var(--text-body)] italic leading-relaxed text-[var(--color-muted-700)]">
            {article.summary}
          </p>

          {/* Byline + read time — magazine-credit style label/value pairs.
              The "From" credit links to the creator page when a slug is
              available. Click the creator's name to see all articles
              from that source at `/c/<slug>`. */}
          <div className="mt-8 flex flex-wrap items-baseline gap-6 border-t border-[var(--color-card-border)] pt-6 text-[var(--text-meta)]">
            {article.creatorLabel ? (
              <span className="flex items-baseline gap-2">
                <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                  From
                </span>
                {article.creatorSlug ? (
                  <Link
                    href={`/c/${article.creatorSlug}`}
                    className="text-ink underline-offset-4 hover:underline"
                  >
                    {article.creatorLabel}
                  </Link>
                ) : (
                  <span className="text-ink">{article.creatorLabel}</span>
                )}
              </span>
            ) : null}
            <span className="flex items-baseline gap-2">
              <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                Analysis by
              </span>
              <span className="text-ink">{article.agentLabel}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                Duration
              </span>
              <span className="text-ink">{readMinutes} Min</span>
            </span>
          </div>

          {/* Agent deep-dive — long-form body. Whitespace-pre-wrap so
              paragraph breaks from the source survive the cap-trim. */}
          {cappedBody ? (
            <section className="mt-10">
              <p className="whitespace-pre-wrap text-[length:var(--text-body)] leading-[1.7] text-ink">
                {cappedBody}
              </p>
              {truncated ? (
                <p className="mt-6 border-t border-[var(--color-card-border)] pt-4 text-[var(--text-meta)] uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                  Truncated for fair-use
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Reasonableness rating — small, subtle, hidden when null. */}
          {showRating ? (
            <section
              className="mt-10 border-t border-[var(--color-card-border)] pt-6"
              data-testid="article-rating"
            >
              <span className="flex items-baseline gap-2 text-[var(--text-meta)]">
                <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                  Reasonableness
                </span>
                <span className="text-ink">{article.reasonablenessRating}/10</span>
              </span>
            </section>
          ) : null}

          {/* Cross-source list — hairline-bordered text list under the
              deep-dive (#80). Component renders nothing when N=0. */}
          <CrossSourceList entries={article.crossSource} />

          {/* Bottom interaction row — star + share + hide (admin-only).
              The hide affordance is intentionally quiet — hairline text
              only, no destructive red coloring. It belongs at the end
              of the row so it can't be accidentally tapped. */}
          <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-[var(--color-card-border)] pt-8">
            <StarButton
              articleId={article.id}
              slug={article.slug}
              initialStarred={article.starred}
              disabled={!canInteract}
            />
            <ShareLinkButton url={`${getBaseUrl()}/a/${slug}`} />
            {canInteract ? <HideArticleButton articleId={article.id} slug={article.slug} /> : null}
          </div>
        </article>
      </main>
    </div>
  )
}
