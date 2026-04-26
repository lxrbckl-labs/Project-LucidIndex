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
 * Server component — pure render, no client interactivity (the star
 * toggle, hover-to-fade-summary, and click-to-article behaviors land
 * in subsequent Phase 5 tickets).
 */

import Link from 'next/link'
import type { MockArticle } from '@/app/_mock/articles'
import { TileShareButton } from './TileShareButton'

const BASE_URL =
  process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'

type Props = {
  article: MockArticle
}

export function ArticleCard({ article }: Props) {
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
      className="block h-full no-underline focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <article
        className="group flex h-full flex-col border border-[var(--color-card-border)] bg-paper p-5 transition-colors duration-150 hover:border-ink"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        {/* Top row — date pill (left) + badge pill (right) */}
        <header className="flex items-center justify-between gap-3">
          <time className="text-[var(--text-meta)] text-[var(--color-muted-700)] tracking-tight">
            {datePrefix}
            {article.publishedLabel}
          </time>
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

        {/* Footer — byline + duration, label-value pairs + share affordance.
          Pushed to the bottom of the flex column. The share button sits
          at the trailing edge and must NOT trigger the <Link> navigation —
          TileShareButton calls stopPropagation + preventDefault on click. */}
        <footer className="mt-auto flex items-baseline justify-between gap-6 pt-6 text-[var(--text-meta)]">
          <div className="flex items-baseline gap-6">
            <span className="flex items-baseline gap-2">
              <span className="uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
                Text
              </span>
              <span className="text-ink">{article.agentLabel}</span>
            </span>
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
