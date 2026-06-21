'use client'

/**
 * TopicBadgeFilterRow — sub-card with pinned All/Starred + infinite-scroll belt.
 *
 * Layout:
 *   <Card>
 *     [All] [Starred]  │  ╱ auto-scrolling belt of topic pills ╱
 *   </Card>
 *
 * The pinned cluster (All + Starred) sits in a non-scrolling flex slot
 * on the left so users can always click them. The belt fills the
 * remaining width and auto-scrolls right-to-left via a main-thread
 * requestAnimationFrame loop (see the rAF effect below).
 *
 * Topics are rendered three times in the track ([copy0][copy1][copy2])
 * to give the impression of an infinite belt without ballooning the DOM.
 * After translating one copy width the loop wraps back to 0 seamlessly
 * because the visible window now contains [copy1][copy2] in the same
 * screen positions copy0 and copy1 occupied at start.
 *
 * Hover pauses the scroll (a CSS animation paused on hover snaps backward
 * as the compositor reconciles to the main thread — the rAF loop commits
 * the transform on the main thread every frame, so the pause is jolt-free).
 * Touch / coarse-pointer / reduced-motion get a non-animated, native
 * horizontal-scroll variant with duplicates hidden. See `globals.css`
 * `.lucidindex-belt-*`.
 *
 * URL writeback (unchanged): Active badge → ?badge=<name>;
 * starred → ?starred=1; All → params cleared.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useTransition } from 'react'
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
  'shrink-0 cursor-pointer inline-flex items-center justify-center h-9 rounded-full px-4 text-xs uppercase tracking-[0.1em] border bg-transparent ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-200'

const PINNED_PILL_CLASS =
  'shrink-0 cursor-pointer rounded-full px-4 text-xs uppercase tracking-[0.1em] font-extrabold data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-200'

export function TopicBadgeFilterRow({ badges }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const { starred } = useTopicPrefs()

  // The belt is driven by a main-thread rAF loop rather than a CSS keyframe
  // animation. A compositor-run CSS animation paused on hover snaps backward —
  // the pause reconciles the compositor's few-frame lead back to the main
  // thread. Writing the transform on the main thread every frame keeps the
  // displayed position equal to the committed position, so hover-pause is
  // jolt-free. `pausedRef` is a ref (not state) so toggling it on hover never
  // re-renders the 3×N belt.
  const trackRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    // Touch / coarse-pointer / reduced-motion get the native horizontal-scroll
    // variant (CSS media query); the JS loop stays out of their way.
    const mq = window.matchMedia(
      '(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse)',
    )

    let raf = 0
    let lastTs = 0
    let offset = 0
    let period = 0

    // One copy width = the seamless wrap distance (three identical copies).
    const measure = () => {
      period = track.scrollWidth / 3
    }

    const step = (ts: number) => {
      if (period > 0 && lastTs !== 0 && !pausedRef.current) {
        // Match the prior cadence: one copy width per 35s.
        offset -= (period / 35_000) * (ts - lastTs)
        if (-offset >= period) offset += period
        track.style.transform = `translate3d(${offset}px, 0, 0)`
      }
      lastTs = ts
      raf = requestAnimationFrame(step)
    }

    const startLoop = () => {
      if (mq.matches) {
        track.style.transform = ''
        return
      }
      measure()
      lastTs = 0
      raf = requestAnimationFrame(step)
    }

    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    startLoop()

    // Hover-pause, attached natively (not via JSX) so it stays a pure
    // pointer-only visual nicety with no a11y semantics on the wrapper. The
    // mask is the track's parent.
    const mask = track.parentElement
    const pause = () => {
      pausedRef.current = true
    }
    const resume = () => {
      pausedRef.current = false
    }
    mask?.addEventListener('mouseenter', pause)
    mask?.addEventListener('mouseleave', resume)

    // Recompute the wrap distance when the belt's width changes (font load,
    // viewport resize, badge list changes).
    const ro = new ResizeObserver(() => {
      if (!mq.matches) measure()
    })
    ro.observe(track)

    // Re-evaluate if the user switches pointer/motion mode mid-session.
    const onModeChange = () => {
      stopLoop()
      offset = 0
      track.style.transform = ''
      startLoop()
    }
    mq.addEventListener('change', onModeChange)

    return () => {
      stopLoop()
      ro.disconnect()
      mask?.removeEventListener('mouseenter', pause)
      mask?.removeEventListener('mouseleave', resume)
      mq.removeEventListener('change', onModeChange)
    }
  }, [])

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
    <Card className="overflow-hidden" data-pending={isPending ? '' : undefined}>
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

        <div className="self-stretch w-px bg-border shrink-0 ml-3" aria-hidden="true" />

        {/* Auto-scrolling belt — three copies for seamless looping.
            Hover-pause listeners are attached natively in the rAF effect. */}
        <div className="lucidindex-belt-mask flex-1 min-w-0 py-4">
          <div
            ref={trackRef}
            className="lucidindex-belt-track flex flex-nowrap items-center gap-2 w-max"
          >
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
