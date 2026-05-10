'use client'

/**
 * TopicBadgeFilterRow — sub-card with pinned All/Starred + infinite-scroll belt.
 *
 * Layout:
 *   <Card border-foreground>
 *     [All] [Starred]  │  ╱ auto-scrolling belt of topic pills ╱
 *   </Card>
 *
 * The pinned cluster (All + Starred) sits in a non-scrolling flex slot
 * on the left so users can always click them. The belt fills the
 * remaining width and auto-scrolls right-to-left via CSS keyframes.
 *
 * Topics are rendered three times in the track ([copy0][copy1][copy2])
 * to give the impression of an infinite belt without ballooning the DOM.
 * At translateX(-33.33%) (one copy width) the loop wraps back to 0
 * seamlessly because the visible window now contains [copy1][copy2] in
 * the same screen positions copy0 and copy1 occupied at start.
 *
 * Hover pauses the scroll. Touch / coarse-pointer / reduced-motion get a
 * non-animated, native horizontal-scroll variant with duplicates hidden.
 * See `globals.css` `.lucidindex-belt-*`.
 *
 * URL writeback (unchanged): Active badge → ?badge=<name>;
 * starred → ?starred=1; All → params cleared.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTopicPrefs } from '@/lib/topic-prefs'

export type TopicBadgeOption = {
  /** The canonical badge name as stored in `topic_badges.name`. */
  name: string
}

type Props = {
  /** Curated badges from `topic_badges`, ordered by `display_order`. */
  badges: TopicBadgeOption[]
}

/** URL search-param key carrying the selected badge name. */
export const BADGE_PARAM = 'badge'
/** URL search-param key for the "Starred" virtual filter. */
export const STARRED_PARAM = 'starred'
/** Sentinel value used by the pinned ToggleGroup for the Starred entry. */
const STARRED_VALUE = '__starred__'
/**
 * Sentinel for `pinnedValue` when the active filter is a topic badge —
 * matches no pinned item, so neither All nor Starred renders pressed.
 */
const PINNED_NONE = '__no_pinned__'

// One shared class string for belt buttons. Mirrors what
// ToggleGroupItem variant=outline size=sm produces, since rendering 3
// copies through Radix would collide on duplicate values.
const BELT_PILL_CLASS =
  'shrink-0 cursor-pointer inline-flex items-center justify-center h-9 rounded-full px-4 text-xs uppercase tracking-[0.1em] border border-foreground bg-transparent ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-200'

const PINNED_PILL_CLASS =
  'shrink-0 cursor-pointer rounded-full px-4 text-xs uppercase tracking-[0.1em] font-extrabold data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-200'

export function TopicBadgeFilterRow({ badges }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const { starred } = useTopicPrefs()

  const starredActive = searchParams.get(STARRED_PARAM) === '1'
  const badgeActive = searchParams.get(BADGE_PARAM)?.trim() ?? ''
  const active = starredActive ? STARRED_VALUE : badgeActive

  // Pinned ToggleGroup mirrors only the All/Starred state. When a topic
  // is active, point at PINNED_NONE so neither pinned item is pressed.
  const pinnedValue = active === '' ? '' : active === STARRED_VALUE ? STARRED_VALUE : PINNED_NONE

  const handleValueChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.delete(BADGE_PARAM)
      params.delete(STARRED_PARAM)
      if (next === STARRED_VALUE) {
        params.set(STARRED_PARAM, '1')
      } else if (next && next !== PINNED_NONE) {
        params.set(BADGE_PARAM, next)
      }
      const qs = params.toString()
      const url = qs.length > 0 ? `/?${qs}` : '/'
      startTransition(() => {
        router.replace(url, { scroll: false })
      })
    },
    [router, searchParams],
  )

  return (
    <Card className="border-foreground overflow-hidden" data-pending={isPending ? '' : undefined}>
      <nav aria-label="Topic filter" className="flex items-stretch pl-4">
        {/* Pinned cluster — always visible, never scrolls. */}
        <ToggleGroup
          type="single"
          value={pinnedValue}
          onValueChange={handleValueChange}
          className="flex items-center gap-2 shrink-0 py-4"
        >
          <ToggleGroupItem
            value=""
            aria-label="Show all topics"
            variant="outline"
            size="sm"
            className={PINNED_PILL_CLASS}
          >
            All
          </ToggleGroupItem>
          <ToggleGroupItem
            value={STARRED_VALUE}
            aria-label="Filter by Starred"
            variant="outline"
            size="sm"
            className={PINNED_PILL_CLASS}
          >
            Starred
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="self-stretch w-px bg-foreground shrink-0 ml-3" aria-hidden="true" />

        {/* Auto-scrolling belt — three copies for seamless looping. */}
        <div className="lucidindex-belt-mask flex-1 min-w-0 py-4">
          <div className="lucidindex-belt-track flex flex-nowrap items-center gap-2 w-max">
            {[0, 1, 2].map((copyIdx) =>
              badges.map((b) => {
                const isActive = active === b.name
                const isStarred = starred.has(b.name)
                const isCopy = copyIdx > 0
                return (
                  <button
                    key={`copy-${copyIdx}-${b.name}`}
                    type="button"
                    onClick={() => handleValueChange(isActive ? '' : b.name)}
                    data-state={isActive ? 'on' : 'off'}
                    data-belt-copy={isCopy ? 'duplicate' : 'primary'}
                    aria-hidden={isCopy ? true : undefined}
                    tabIndex={isCopy ? -1 : 0}
                    aria-label={isCopy ? undefined : `Filter by ${b.name}`}
                    aria-pressed={isCopy ? undefined : isActive}
                    className={`${BELT_PILL_CLASS} ${isStarred ? 'font-extrabold' : ''}`}
                  >
                    {b.name}
                  </button>
                )
              }),
            )}
          </div>
        </div>
      </nav>
    </Card>
  )
}
