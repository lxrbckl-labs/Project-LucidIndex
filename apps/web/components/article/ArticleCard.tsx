/**
 * ArticleCard — Fyrre-style framed card for `small` and `medium`
 * significance tiles (#58).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * (the "Card anatomy — Fyrre-derived" section is binding) and
 * `Design/main.jpg`.
 *
 * Anatomy:
 *
 *   ┌────────────────────────────────┐
 *   │ <date pill>          (BADGE)   │   ← date pill (top-left), topic-badge pill (top-right)
 *   │                                │
 *   │   ┌─────── HERO ──────────┐    │   ← image IN-FRAME (object-cover), not background
 *   │   │                       │    │
 *   │   └───────────────────────┘    │
 *   │                                │
 *   │   <Title — display sans>       │   ← line-clamp 2
 *   │                                │
 *   │   <Summary — body, muted>      │   ← line-clamp 3
 *   │                                │
 *   │ Text  <agent>   Duration  3M   │   ← byline + duration footer
 *   └────────────────────────────────┘
 *
 * Hard rules from the spec:
 *   - Hairline border, no shadow, rectangle (no radius on the frame).
 *   - Pills are the only rounded element.
 *   - Image clipped via `object-cover` to the per-significance aspect.
 *   - Estimated dates render with a `~` prefix.
 *
 * Phase 8 #84 / #85:
 *   - Tile carries a `data-masonry-tile` attribute so the dashboard's
 *     client-side keyboard handler (MasonryKeyboardNav) can enumerate
 *     tiles via `document.querySelectorAll` and walk arrow keys across
 *     them. The card itself stays a server component — no client JS.
 *   - Focus state on the tile is a hairline ink ring (not the rounded
 *     blue browser default). The global :focus-visible rule in
 *     globals.css already lays down a 1px ink outline on every focusable
 *     element; the per-tile class below adds the offset to clear the
 *     hairline frame so the focus ring reads at a glance.
 */

import Link from 'next/link'
import type { MockArticle } from '@/app/_mock/articles'
import { NewBadge } from './NewBadge'
import { TileCreatorLink } from './TileCreatorLink'
import { TileShareButton } from './TileShareButton'

const BASE_URL =
  process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'

type Props = {
  article: MockArticle
  /**
   * When true, render the small "NEW" pill (#79). Computed in the parent
   * (the dashboard) by comparing `article.created_at` to the configured
   * `settings.new_article_badge_hours` window — keeps this component
   * pure and avoids hammering the DB once per card.
   */
  isNew?: boolean
}

export function ArticleCard({ article, isNew = false }: Props) {
  const datePrefix = article.publishedEstimated ? '~ ' : ''
  // First badge wins on the card; the article page shows the full set.
  const primaryBadge = article.topicBadges[0]

  // Image aspect: small tiles get a near-square hero, medium tiles get
  // a taller portrait so the masonry rhythm reads correctly.
  const heroAspect = article.significance === 'medium' ? 'aspect-[4/5]' : 'aspect-[5/4]'

  return (
    <Link
      href={`/a/${article.slug}`}
      // The whole tile is the click target — the article page is the
      // per-article home, not just a "read more" affordance.
      // Focus ring (#85): a hairline 1.5px ink outline with offset to
      // clear the frame border. Replaces the rounded-blue browser
      // default; matches the magazine vibe.
      className="block h-full no-underline focus:outline-none focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ink"
      style={{ borderRadius: 'var(--radius-card)' }}
      data-masonry-tile=""
    >
      <article
        className="group flex h-full flex-col border border-[var(--color-card-border)] bg-paper p-4 transition-colors duration-150 hover:border-ink sm:p-5"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        {/* Top row — date pill (left) + badge pill (right). The NEW pill
          (when shown) sits between the date and the topic badge so the
          two-pill rhythm reads cleanly. */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <time className="text-[var(--text-meta)] text-[var(--color-muted-700)] tracking-tight">
              {datePrefix}
              {article.publishedLabel}
            </time>
            {isNew ? <NewBadge /> : null}
          </div>
          {primaryBadge ? (
            <span
              className="inline-flex items-center justify-center border border-ink px-3 py-1 text-[0.65rem] uppercase tracking-[0.08em] text-ink"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              {primaryBadge}
            </span>
          ) : null}
        </header>

        {/* Hero — in-frame, object-cover. Falls back to muted surface if
          the image fails to load (no broken-image icon per spec). */}
        <figure className={`mt-5 w-full overflow-hidden bg-[var(--color-muted-300)] ${heroAspect}`}>
          {/* Plain <img> — Next/Image needs domain config + the picsum URLs
            are dev-only mock content. Real article hero images will
            switch to next/image once the Phase 5 backend wiring lands. */}
          {/* biome-ignore lint/performance/noImgElement: dev-only mock heroes */}
          <img
            src={article.heroImageUrl}
            alt={article.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </figure>

        {/* Title — bold display sans, 2-line clamp */}
        <h2
          className="font-display mt-5 line-clamp-2 text-[length:var(--text-display-md)] font-bold leading-tight tracking-tight text-ink"
          style={{ letterSpacing: '-0.01em' }}
        >
          {article.title}
        </h2>

        {/* Summary — muted body, 3-line clamp */}
        <p className="mt-3 line-clamp-3 text-[length:var(--text-body-sm)] leading-relaxed text-[var(--color-muted-700)]">
          {article.summary}
        </p>

        {/* Footer — creator + duration + share. Pushed to the bottom of the
          flex column. Creator name links to `/c/<slug>` (#71). Share and
          creator buttons must NOT trigger the <Link> navigation — both
          use client components that call stopPropagation + preventDefault. */}
        <footer className="mt-auto flex items-baseline justify-between gap-6 pt-6 text-[var(--text-meta)]">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            {article.creatorLabel ? (
              <span className="flex items-baseline gap-2">
                <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                  From
                </span>
                <TileCreatorLink
                  creatorLabel={article.creatorLabel}
                  creatorSlug={article.creatorSlug}
                  className="text-ink"
                />
              </span>
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                  Text
                </span>
                <span className="text-ink">{article.agentLabel}</span>
              </span>
            )}
            <span className="flex items-baseline gap-2">
              <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                Duration
              </span>
              <span className="text-ink">{article.readMinutes} Min</span>
            </span>
          </div>
          {/* Share — small, unobtrusive. Uses stopPropagation to avoid
            navigating; see TileShareButton for the full event-guard. */}
          <TileShareButton url={`${BASE_URL}/a/${article.slug}`} />
        </footer>
      </article>
    </Link>
  )
}
