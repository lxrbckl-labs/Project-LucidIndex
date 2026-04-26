'use client'

/**
 * TopicBadgeFilterRow — interactive topic-badge filter pills (#55, #61).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * (the "Filter pill row" section is binding) and `Design/main.jpg`.
 *
 * Behavior (#61):
 *
 *   - "All" pill is always first, selected by default on first paint.
 *   - Single-select — only one badge filter active at a time.
 *   - Click the active pill → clears the filter (URL drops the param,
 *     "All" goes back to selected).
 *   - Filter state lives in the URL via `?badge=<name>` so bookmarks +
 *     back/forward navigation all behave correctly. The masonry below
 *     reads the same param server-side and filters the article list.
 *
 * Layout decision:
 *
 *   The pill row is NOT sticky — Visual Identity.md doesn't pin this,
 *   and Fyrre print magazines put filters above-the-fold without
 *   following the reader. Non-sticky reads more editorial and is
 *   simpler to implement (no z-index / blur backdrop dance). Document
 *   here so future changes are deliberate.
 *
 * Visual:
 *
 *   - Each pill is hairline-bordered, text-only, pill-radius (the only
 *     rounded element on the dashboard per spec).
 *   - Active pill = filled background (`bg-ink`) + paper text.
 *   - Inactive pill = paper background + ink border + ink text.
 *   - Smooth ~150ms color transition on hover and on selection change.
 *
 * Phase 8 #82 — mobile horizontal scroll:
 *
 *   - Below the lg breakpoint (≤1023px), the row scrolls horizontally
 *     when its pills overflow. `overflow-x-auto` + iOS momentum scroll
 *     keep the touch feel native. The scrollbar is hidden visually
 *     (`scrollbar-width: none` for Firefox, `::-webkit-scrollbar
 *     { display: none }` for WebKit) — the row remains scrollable, the
 *     visual chrome stays editorial.
 *   - When the user picks a pill, we scroll the active element into
 *     view via `Element.scrollIntoView({ inline: 'nearest', behavior:
 *     'smooth' })` so it stays visible after a tap on a clipped pill.
 *
 * Why client-side: the pill click needs to update the URL via
 * `router.replace()` AND surface the active state immediately. We
 * derive `active` from the URL search params on every render so the
 * pill state and the URL never drift.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useTransition } from 'react'

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

export function TopicBadgeFilterRow({ badges }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Active badge = current value of `?badge=...` from the URL. Empty / null
  // means "All" is selected. We never store this in client state — the URL
  // is the source of truth so deep links and back-button work cleanly.
  const active = searchParams.get(BADGE_PARAM)?.trim() ?? ''

  // Build the row in render order. "All" is always the first cell and is
  // synthetic — it doesn't appear in `topic_badges`.
  const items = useMemo(() => {
    const list: Array<{ key: string; label: string; value: string | null }> = [
      { key: '__all__', label: 'All', value: null },
    ]
    for (const b of badges) {
      list.push({ key: b.name, label: b.name, value: b.name })
    }
    return list
  }, [badges])

  const handleClick = useCallback(
    (value: string | null, target: HTMLElement) => {
      // Clone the existing search params so any non-badge filters (future
      // additions like `?starred=1`) survive a pill click.
      const next = new URLSearchParams(searchParams.toString())

      // "All" always clears the param. Clicking the active pill toggles off
      // (single-select with click-same-to-clear). Otherwise set it.
      const shouldClear = value === null || value === active
      if (shouldClear) {
        next.delete(BADGE_PARAM)
      } else {
        next.set(BADGE_PARAM, value)
      }

      const qs = next.toString()
      const url = qs.length > 0 ? `/?${qs}` : '/'

      // `replace` (not `push`) — the filter is a view filter, not a
      // navigation step. Avoids piling history entries when the admin
      // scrubs through pills.
      startTransition(() => {
        router.replace(url, { scroll: false })
      })

      // Phase 8 #82 — scroll the just-tapped pill into view on mobile,
      // so a tap on a clipped pill at the row's edge isn't lost behind
      // the overflow boundary. `inline: 'nearest'` only scrolls when
      // the pill isn't already fully visible; `block: 'nearest'`
      // prevents the page from jumping vertically.
      target.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
    },
    [active, router, searchParams],
  )

  // Phase 8 #82 — when the active filter changes (e.g. via deep-link or
  // back/forward), scroll the active pill into view so the user sees
  // which one is selected. Runs on mount + on `active` change.
  // The effect doesn't read `active` directly — it queries the DOM for
  // the element carrying `data-active` — but we still depend on `active`
  // so the effect re-runs whenever the URL-derived selection changes.
  const navRef = useRef<HTMLElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger; the body reads from the DOM.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const activeEl = nav.querySelector<HTMLElement>('button[data-active]')
    if (!activeEl) return
    activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [active])

  return (
    <nav
      ref={navRef}
      aria-label="Topic filter"
      // Phase 8 #82 — `flex-nowrap` keeps pills on a single line on
      // mobile so the horizontal-scroll behavior actually triggers
      // (with `flex-wrap`, pills would wrap to a second line and the
      // overflow rule would never fire). The custom class
      // `lucidindex-pill-row` carries the scrollbar-hide rules from
      // globals.css.
      className="lucidindex-pill-row flex flex-nowrap items-center gap-3 overflow-x-auto py-1"
      // Keep the scrollbar invisible on macOS-style trackpads but still
      // scrollable. `overscroll-behavior` keeps horizontal flicks from
      // pulling the page along.
      style={{
        overscrollBehaviorX: 'contain',
        // iOS momentum scroll for natural touch feel.
        WebkitOverflowScrolling: 'touch',
      }}
      data-pending={isPending ? '' : undefined}
    >
      {items.map((item) => {
        const isActive = item.value === null ? active === '' : item.value === active
        return (
          <button
            key={item.key}
            type="button"
            onClick={(e) => handleClick(item.value, e.currentTarget)}
            aria-pressed={isActive}
            data-active={isActive ? '' : undefined}
            className={[
              'inline-flex shrink-0 items-center justify-center border px-4 py-1.5',
              'text-[0.7rem] uppercase tracking-[0.1em] transition-colors duration-150',
              'cursor-pointer',
              // Phase 8 #85 — focus ring. The pill already carries a
              // hairline border so the global :focus-visible 1px outline
              // would double up; we use an inset box-shadow instead so
              // the focus indicator reads as a thickened border without
              // extending past the pill silhouette.
              'focus:outline-none focus-visible:outline-none',
              'focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-ink)]',
              isActive
                ? 'border-ink bg-ink text-paper'
                : 'border-ink bg-paper text-ink hover:bg-ink hover:text-paper',
            ].join(' ')}
            style={{ borderRadius: 'var(--radius-pill)' }}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
