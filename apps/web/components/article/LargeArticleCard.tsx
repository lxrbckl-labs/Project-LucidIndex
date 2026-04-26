/**
 * LargeArticleCard — `large`-significance variant (#59).
 *
 * The Visual Identity spec carves out exactly one survival of the
 * earlier "image-as-background tile, text overlay" pattern:
 * `large`-significance tiles get a full-bleed hero image with the
 * title overlaid on a darkened gradient.
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * (Tile sizing in masonry — "MAY use a more dramatic image treatment").
 *
 * Anatomy:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ <date>                          (BADGE)  │   ← date + badge pinned to corners,
 *   │                                          │      backed by hairline-bordered chips
 *   │                                          │
 *   │              FULL-BLEED HERO             │
 *   │                                          │
 *   │                                          │
 *   │  ┌─────── gradient ───────────────────┐  │
 *   │  │  Big display title                  │  │  ← title overlay near bottom-left
 *   │  │  Text  <agent>   Duration  9 Min    │  │  ← byline visible
 *   │  └─────────────────────────────────────┘  │
 *   └──────────────────────────────────────────┘
 *
 * Decisions documented per spec:
 *   - Summary is COLLAPSED on the large variant (the Fyrre cover
 *     reference shows overlay-text-only). The byline DOES stay
 *     visible — it's a magazine credit, not noise.
 *   - The frame still uses a hairline border to keep the card
 *     anchored in the masonry grid; the spec's "no shadow" rule holds.
 */

import Link from 'next/link'
import type { MockArticle } from '@/app/_mock/articles'
import { TileShareButton } from './TileShareButton'

const BASE_URL =
  process.env.WEBAUTHN_ORIGIN ?? process.env.LUCIDINDEX_BASE_URL ?? 'http://localhost:3000'

type Props = {
  article: MockArticle
}

export function LargeArticleCard({ article }: Props) {
  const datePrefix = article.publishedEstimated ? '~ ' : ''
  const primaryBadge = article.topicBadges[0]

  return (
    <Link
      href={`/a/${article.slug}`}
      className="block h-full no-underline focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <article
        className="group relative flex h-full flex-col overflow-hidden border border-[var(--color-card-border)] bg-ink transition-colors duration-150 hover:border-ink"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        {/* Full-bleed hero — object-cover fills the entire tile */}
        {/* biome-ignore lint/performance/noImgElement: dev-only mock heroes */}
        <img
          src={article.heroImageUrl}
          alt={article.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />

        {/* Top corners — date + badge pills, on a translucent backdrop so
          they read against any image. */}
        <header className="relative z-10 flex items-start justify-between gap-3 p-5">
          <span
            className="inline-flex items-center border border-paper/80 bg-paper/90 px-3 py-1 text-[var(--text-meta)] text-ink"
            style={{ borderRadius: 'var(--radius-pill)' }}
          >
            {datePrefix}
            {article.publishedLabel}
          </span>
          {primaryBadge ? (
            <span
              className="inline-flex items-center justify-center border border-paper/80 bg-paper/90 px-3 py-1 text-[0.65rem] uppercase tracking-[0.08em] text-ink"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              {primaryBadge}
            </span>
          ) : null}
        </header>

        {/* Spacer pushes the title-overlay block to the bottom */}
        <div className="flex-1" />

        {/* Bottom overlay — gradient + title + byline */}
        <div className="relative z-10 bg-gradient-to-t from-ink/85 via-ink/50 to-transparent p-6 pt-24">
          <h2
            className="font-display text-[length:var(--text-display-lg)] font-black leading-[0.95] tracking-tight text-paper"
            style={{ letterSpacing: '-0.02em' }}
          >
            {article.title}
          </h2>
          <div className="mt-4 flex items-baseline justify-between gap-6 text-[var(--text-meta)] text-paper/90">
            <div className="flex items-baseline gap-6">
              <span className="flex items-baseline gap-2">
                <span className="uppercase tracking-[0.08em] text-paper/70">Text</span>
                <span>{article.agentLabel}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="uppercase tracking-[0.08em] text-paper/70">Duration</span>
                <span>{article.readMinutes} Min</span>
              </span>
            </div>
            {/* Share — small, unobtrusive. Uses stopPropagation to avoid
              navigating; see TileShareButton for the full event-guard.
              "dark" variant uses paper-toned border/text for the
              image-overlay background. */}
            <TileShareButton url={`${BASE_URL}/a/${article.slug}`} variant="dark" />
          </div>
        </div>
      </article>
    </Link>
  )
}
