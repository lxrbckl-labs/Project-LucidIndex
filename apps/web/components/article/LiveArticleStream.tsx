'use client'

/**
 * LiveArticleStream — SSE-driven new-arrival strip (#60 / Phase 4).
 *
 * All SSE wiring (`/api/events`, `EventSource`, auto-reconnect, de-dup)
 * is preserved from Phase 3. Only the rendered tile UI changes:
 *
 *   - New arrivals render as shadcn Card tiles.
 *   - Each tile mounts with a Tailwind `animate-in fade-in slide-in-from-top-2
 *     duration-300` entry animation.
 *   - The strip is a horizontal scroll: `<ScrollArea>` wrapping
 *     `<div className="flex gap-3">` so a growing tile count doesn't
 *     break the layout.
 *
 * SSE design notes (unchanged from Phase 3):
 *   - `EventSource` auto-reconnects with built-in backoff — no manual retry.
 *   - `source.close()` on unmount so disconnected pages don't leak listeners.
 *   - De-dup on `article.id` guards against replay across tabs/reconnects.
 */

import { useEffect, useState } from 'react'
import type { MockArticle } from '@/app/_mock/articles'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ArticleNewPayload } from '@/lib/sse/article-bus'
import { ArticleCard } from './ArticleCard'
import { LargeArticleCard } from './LargeArticleCard'

type LiveArticle = MockArticle & {
  /** Stable mount marker — drives the fade-in transition's initial state. */
  receivedAt: number
}

function payloadToArticle(payload: ArticleNewPayload): LiveArticle {
  const now = new Date()
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
    publishedAt: now.toISOString(),
    createdAt: now,
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
    const source = new EventSource('/api/events')

    const onArticleNew = (e: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(e.data) as ArticleNewPayload
        setLive((prev) => {
          if (prev.some((a) => a.id === payload.id)) return prev
          return [payloadToArticle(payload), ...prev]
        })
      } catch {
        // Malformed payload — ignore.
      }
    }

    source.addEventListener('article:new', onArticleNew)

    return () => {
      source.removeEventListener('article:new', onArticleNew)
      source.close()
    }
  }, [])

  // Apply the same view filter the static masonry uses.
  const filtered = badgeFilter ? live.filter((a) => a.topicBadges.includes(badgeFilter)) : live

  if (filtered.length === 0) return null

  return (
    <section aria-label="Newly filed" data-testid="live-article-stream">
      <ScrollArea className="w-full">
        <div className="flex gap-3 pb-3">
          {filtered.map((article) => (
            <LiveTile key={`${article.id}-${article.receivedAt}`} article={article} />
          ))}
        </div>
      </ScrollArea>
    </section>
  )
}

/**
 * A single live-arrival tile. Mounts with Tailwind `animate-in` entry
 * animation. The tile is narrow (w-72) so the horizontal scroll stays
 * manageable. Large-significance tiles get a slightly wider slot (w-96).
 */
function LiveTile({ article }: { article: LiveArticle }) {
  const isLarge = article.significance === 'large'

  return (
    <div
      data-testid="live-article-tile"
      data-significance={article.significance}
      className={`shrink-0 animate-in fade-in slide-in-from-top-2 duration-300 ${
        isLarge ? 'w-96' : 'w-72'
      }`}
    >
      {isLarge ? <LargeArticleCard article={article} /> : <ArticleCard article={article} />}
    </div>
  )
}
