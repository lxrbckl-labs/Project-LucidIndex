'use client'

/**
 * LiveArticleStream — client-side SSE consumer that renders newly-filed
 * articles above the static masonry without disturbing it (#60).
 *
 * Design choice — why a dedicated strip, not a prepend into the existing
 * masonry:
 *
 *   The static `<ArticleMasonry>` lays articles into hand-curated 6-tile
 *   panels with explicit `grid-template-areas`. Inserting a new article
 *   into an existing panel would shift every subsequent panel — exactly
 *   the "whole-grid reflow" the spec forbids. Instead, brand-new
 *   articles arrive in this strip directly above the static masonry.
 *
 *   The strip is itself a small grid (one tile per row of new arrivals),
 *   appended-to in reverse-chronological order. Each new tile mounts
 *   with `opacity: 0` and transitions to `opacity: 1` over ~400ms, so
 *   the visual sensation is "fresh ink hitting the page" without any
 *   layout the eye has to re-parse.
 *
 *   When the admin reloads the page, the live arrivals are already part
 *   of the server-rendered masonry below (the next page load will pick
 *   them up from the DB). So the strip is intentionally ephemeral —
 *   it's a "since you've been here" surface, not a persistent buffer.
 *
 * SSE plumbing:
 *
 *   - Subscribes to `/api/events` via the browser-native `EventSource`.
 *   - `EventSource` auto-reconnects on connection drop with an
 *     exponential backoff baked into the platform — we don't need to
 *     wire our own retry logic.
 *   - On unmount we call `eventSource.close()` so disconnected pages
 *     don't keep the stream alive (that would also leak server-side
 *     bus listeners until the browser GC'd the request).
 */

import { useEffect, useState } from 'react'
import type { MockArticle } from '@/app/_mock/articles'
import type { ArticleNewPayload } from '@/lib/sse/article-bus'
import { ArticleCard } from './ArticleCard'
import { LargeArticleCard } from './LargeArticleCard'

type LiveArticle = MockArticle & {
  /** Stable mount marker — drives the fade-in transition's initial state. */
  receivedAt: number
}

function payloadToArticle(payload: ArticleNewPayload): LiveArticle {
  return {
    id: payload.id,
    slug: payload.slug,
    title: payload.title,
    summary: payload.summary,
    topicBadges: payload.topicBadges,
    significance: payload.significance,
    publishedLabel: payload.publishedLabel,
    publishedEstimated: payload.publishedEstimated,
    heroImageUrl: payload.heroImageUrl,
    agentLabel: payload.agentLabel,
    readMinutes: payload.readMinutes,
    // The SSE payload (Phase 5 #60) doesn't carry the per-article-page
    // fields (deep-dive body, cross-source list, source URL). The
    // dashboard tile that wraps this LiveArticle only reads the
    // dashboard-relevant subset, so the article-page fields stay
    // empty/now until the user clicks through to `/a/<slug>`, at
    // which point the article-page route loads the full record.
    publishedAt: new Date().toISOString(),
    reasonablenessRating: null,
    crossSource: [],
    sourceUrl: '',
    receivedAt: Date.now(),
  }
}

type Props = {
  /**
   * Optional badge filter that's currently selected on the dashboard.
   * When set, incoming articles whose `topicBadges` don't include the
   * filter are dropped so the strip respects the same view-filter as
   * the static masonry.
   */
  badgeFilter?: string | null
}

export function LiveArticleStream({ badgeFilter }: Props) {
  const [live, setLive] = useState<LiveArticle[]>([])

  useEffect(() => {
    // EventSource is browser-native; SSR will never reach this branch
    // because the parent component is `'use client'`.
    const source = new EventSource('/api/events')

    const onArticleNew = (e: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(e.data) as ArticleNewPayload
        setLive((prev) => {
          // Defensive de-dup: ignore an article we've already prepended.
          // Multiple tabs + reconnects can replay the same event.
          if (prev.some((a) => a.id === payload.id)) return prev
          return [payloadToArticle(payload), ...prev]
        })
      } catch {
        // Malformed payload — ignore. The server controls this surface
        // so a runtime parse error would already be a server-side bug.
      }
    }

    source.addEventListener('article:new', onArticleNew)

    return () => {
      source.removeEventListener('article:new', onArticleNew)
      source.close()
    }
  }, [])

  // Apply the same view filter the static masonry uses, so toggling a
  // badge filter doesn't surface stream events from other topics.
  const filtered = badgeFilter ? live.filter((a) => a.topicBadges.includes(badgeFilter)) : live

  if (filtered.length === 0) return null

  return (
    <section
      aria-label="Newly filed"
      className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6"
      data-testid="live-article-stream"
    >
      {filtered.map((article) => (
        <LiveTile key={`${article.id}-${article.receivedAt}`} article={article} />
      ))}
    </section>
  )
}

/**
 * A single live-arrival tile. Mounts with `opacity: 0` then transitions
 * to `opacity: 1` over ~400ms. The transition kicks off via a state
 * flip on first paint — using `useEffect` runs AFTER the initial render
 * so the browser commits the `opacity: 0` frame first and then animates
 * to the visible frame.
 *
 * The tile spans 2 columns when its significance is `large` so the size
 * still maps to importance even outside the masonry's panel grids.
 */
function LiveTile({ article }: { article: LiveArticle }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // requestAnimationFrame guarantees we land on a fresh paint frame
    // before flipping opacity — without it Chrome elides the
    // transition because layout + style commit happens in the same
    // tick as the state flip.
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const isLarge = article.significance === 'large'

  return (
    <div
      data-testid="live-article-tile"
      data-significance={article.significance}
      className={`min-h-0 transition-opacity duration-[400ms] ease-out ${
        isLarge ? 'col-span-2 md:col-span-2' : ''
      }`}
      style={{ opacity: visible ? 1 : 0 }}
    >
      {isLarge ? <LargeArticleCard article={article} /> : <ArticleCard article={article} />}
    </div>
  )
}
