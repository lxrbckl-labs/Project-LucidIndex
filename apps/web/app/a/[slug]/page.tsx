/**
 * Standalone article page (#64 / #65 / #66).
 *
 * Phase 5 rebuild on shadcn primitives with neutral defaults.
 *
 * Route: `/a/<slug>` — the per-article home and the canonical share-link
 * target. Public by design (friends opening a share link must NOT hit a
 * login wall). Starring is a client-only localStorage preference, open to
 * everyone (no sign-in) — see `article-prefs.ts`.
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
 *     - Star toggle (client-only localStorage; open to all visitors)
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
import { sentimentToSliderPercent } from '@lucidindex/shared/article-view'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentOpinionSection } from '@/components/article/AgentOpinionSection'
import { MarkSeenOnMount } from '@/components/article/MarkSeenOnMount'
import { ShareLinkButton } from '@/components/article/ShareLinkButton'
import { SourcesSection } from '@/components/article/SourcesSection'
import { StarButton } from '@/components/article/StarButton'
import { TopicBadgeLink } from '@/components/article/TopicBadgeLink'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { markdownComponents } from '@/components/markdown/markdown-config'
import { Separator } from '@/components/ui/separator'
import { markRead } from './actions'
import { applyFairUseCap, loadArticleBySlug } from './loader'

// DB-backed (loadArticleBySlug, markRead) — never statically renderable.
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
  return process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:47892'
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

  // Apply the fair-use cap to the deep-dive body.
  const bodyText = article.agentDeepDive ?? ''
  const { text: cappedBody, truncated } = applyFairUseCap(bodyText)

  // Bearish/Bullish gauge is driven by the agent's `sentiment` (-5..+5) — the
  // literal bearish→bullish signal. Always shown on the meta row; when the
  // agent hasn't supplied a rating the marker rests at neutral center. (The
  // reasonableness rating is a separate "how credible" measure and is
  // intentionally not surfaced here.)
  const sentimentValue = article.sentiment ?? 0
  const sentimentUnrated = article.sentiment === null

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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
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
      <main className="flex-1 px-4 pt-4 pb-4 sm:px-6 sm:pt-6 sm:pb-6 md:px-18">
        {/* Reading column — max-w-4xl per assignment spec; preserved
            narrower 640px inner column for prose readability. */}
        <div className="mx-auto max-w-4xl px-0">
          <article className="mx-auto w-full max-w-[640px]">
            {/* Header — topic badges.
                Back button moved to TopNav (rendered on /a/* routes).
                The filed date moved into the metadata grid below. */}
            <header className="flex flex-wrap items-center gap-3">
              {article.topicBadges.map((badge) => (
                <TopicBadgeLink key={badge} badge={badge} />
              ))}
            </header>

            {/* Title — <h1>. Placed above the hero so the article reads
                title-first, image-second. The summary that lived here is
                dropped — readers already saw it on the dashboard tile. */}
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              {article.title}
            </h1>

            {/* Byline — faint, close-set under the title. Author and filed date
                share one row, divided by a middot. Either side may be absent. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {article.creatorLabel ? (
                <span>
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
                </span>
              ) : null}
              {article.creatorLabel ? (
                <span aria-hidden="true" className="text-muted-foreground/40">
                  ·
                </span>
              ) : null}
              <time dateTime={article.createdAt.toISOString()}>{filedLabel}</time>
            </p>

            {/* Hero image — full-column-width, aspect-[2/1], rounded corners.
                Omitted entirely when the article has no hero (no placeholder). */}
            {article.heroImageUrl ? (
              <figure className="mt-8 aspect-[2/1] w-full overflow-hidden rounded-lg bg-muted">
                {/* biome-ignore lint/performance/noImgElement: dev-only mock heroes / placeholder route */}
                <img
                  src={article.heroImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              </figure>
            ) : null}

            {/* Metadata strip — a single horizontal row: Star on the left,
                Share pinned right. The Bearish/Bullish scale (when present)
                sits inline in the middle on sm+, but wraps to its own
                The filed date moved up into the byline. Everything stays on one
                line at all widths — the gauge flexes to fill the middle. */}
            <div className="mt-8 flex items-center gap-x-3 border-b border-t border-border py-4 text-sm sm:gap-x-5">
              {/* Star — left end of the diagnostics row. Compact icon, sized to
                  match the Share button pinned to the right end. */}
              <StarButton
                articleId={article.id}
                variant="icon"
                className="h-8 w-8 shrink-0 border-input bg-background"
              />

              <Separator orientation="vertical" className="h-5 shrink-0" />
              <div
                className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
                data-testid="article-rating"
              >
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Bearish
                </span>
                <div className="relative h-4 flex-1">
                  {/* Thin baseline + bearish/neutral/bullish tick marks — keeps
                      the scale legible without a heavy filled bar. */}
                  <div
                    className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                  <div
                    className="absolute left-0 top-1/2 h-2 w-px -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                  <div
                    className="absolute left-1/2 top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                  <div
                    className="absolute right-0 top-1/2 h-2 w-px -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                  {/* Filled marker — solid dot at the sentiment position. */}
                  <div
                    className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ${
                      sentimentUnrated ? 'opacity-30' : ''
                    }`}
                    style={{
                      left: `${sentimentToSliderPercent(sentimentValue)}%`,
                    }}
                    role="img"
                    aria-label={
                      sentimentUnrated
                        ? 'Sentiment not yet rated (neutral)'
                        : `Sentiment ${article.sentiment} on a -5 (bearish) to +5 (bullish) scale`
                    }
                  />
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Bullish
                </span>
              </div>

              {/* Matching divider between the gauge and Share, mirroring the
                  Star/gauge separator. */}
              <Separator orientation="vertical" className="h-5 shrink-0" />

              {/* Share — right end of the diagnostics row. The flex-1 gauge fills
                  the middle, so Share sits snug after the divider. */}
              <div className="shrink-0">
                <ShareLinkButton url={`${getBaseUrl()}/a/${slug}`} />
              </div>
            </div>

            {/* Agent deep-dive — long-form body, rendered as markdown so
                authors can style with **bold** / *italic* / `code` / lists /
                headings / links / blockquotes / tables. Shares the exact
                component map with the forum post + reply bodies via
                markdown-config. `whitespace-pre-wrap` on the wrapper preserves
                the source's own line breaks, and `disallowedElements={['p']}
                unwrapDisallowed` keeps inline runs flowing within that pre-wrap
                (no injected paragraph blocks that would double the spacing) —
                the same posture the reply renderer uses. Block elements
                (headings, lists, tables) still render normally. */}
            {cappedBody ? (
              <section className="mt-8">
                <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground text-justify">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                    disallowedElements={['p']}
                    unwrapDisallowed
                  >
                    {cappedBody}
                  </ReactMarkdown>
                </div>
                {truncated ? (
                  <p className="mt-6 border-t border-border pt-4 text-sm uppercase tracking-[0.08em] text-muted-foreground">
                    Truncated for fair-use
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* Additional Resources — unified list of structured citations
                plus folded-in cross-source coverage. Renders nothing when
                there are no resources of either kind. */}
            <SourcesSection citations={article.citations} crossSource={article.crossSource} />

            {/* Agent opinion — collapsible subjective take on the source.
                Positioned after Sources; always rendered (shows placeholder
                when null so the section is consistently discoverable). */}
            <AgentOpinionSection agentOpinion={article.agentOpinion} />
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
