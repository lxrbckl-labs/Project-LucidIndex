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
 *
 * Phase 8 #84 / #85 — keyboard nav + focus state:
 *   - Tile carries a `data-masonry-tile` attribute so the dashboard's
 *     client-side keyboard handler can enumerate it. See ArticleCard
 *     for context.
 *   - Focus ring is a hairline ink outline (replaces rounded-blue
 *     browser default).
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
  /** When true, render the small "NEW" pill (#79). See ArticleCard for context. */
  isNew?: boolean
}

export function LargeArticleCard({ article, isNew = false }: Props) {
  const datePrefix = article.publishedEstimated ? '~ ' : ''
  const primaryBadge = article.topicBadges[0]

  return (
    <Link
      href={`/a/${article.slug}`}
      // Hairline ink focus ring (#85) — replaces rounded-blue default.
      className="block h-full no-underline focus:outline-none focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ink"
      style={{ borderRadius: 'var(--radius-card)' }}
      data-masonry-tile=""
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
          they read against any image. The NEW pill (when shown) sits
          next to the date so the two read as a single eyebrow group. */}
        <header className="relative z-10 flex items-start justify-between gap-3 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center border border-paper/80 bg-paper/90 px-3 py-1 text-[var(--text-meta)] text-ink"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              {datePrefix}
              {article.publishedLabel}
            </span>
            {isNew ? <NewBadge variant="light" /> : null}
          </div>
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
        <div className="relative z-10 bg-gradient-to-t from-ink/85 via-ink/50 to-transparent p-5 pt-20 sm:p-6 sm:pt-24">
          <h2
            className="font-display text-[length:var(--text-display-lg)] font-black leading-[0.95] tracking-tight text-paper"
            style={{ letterSpacing: '-0.02em' }}
          >
            {article.title}
          </h2>
          {/* Creator + duration + share. Creator links to `/c/<slug>` (#71).
              TileCreatorLink guards against the outer <Link> tile nav. */}
          <div className="mt-4 flex items-baseline justify-between gap-6 text-[var(--text-meta)] text-paper/90">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              {article.creatorLabel ? (
                <span className="flex items-baseline gap-2">
                  <span className="uppercase tracking-[0.08em] text-paper/70">From</span>
                  <TileCreatorLink
                    creatorLabel={article.creatorLabel}
                    creatorSlug={article.creatorSlug}
                    className="text-paper"
                  />
                </span>
              ) : (
                <span className="flex items-baseline gap-2">
                  <span className="uppercase tracking-[0.08em] text-paper/70">Text</span>
                  <span>{article.agentLabel}</span>
                </span>
              )}
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
