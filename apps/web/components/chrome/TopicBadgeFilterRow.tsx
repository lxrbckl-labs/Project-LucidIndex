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
 *   - Horizontal scroll on overflow (small viewports) — no wrap, no
 *     truncate; the row is meant to be scannable side-to-side.
 *
 * Why client-side: the pill click needs to update the URL via
 * `router.replace()` AND surface the active state immediately. We
 * derive `active` from the URL search params on every render so the
 * pill state and the URL never drift.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useTransition } from 'react'

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
    (value: string | null) => {
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
    },
    [active, router, searchParams],
  )

  return (
    <nav
      aria-label="Topic filter"
      className="flex items-center gap-3 overflow-x-auto py-1"
      // Keep the scrollbar invisible on macOS-style trackpads but still
      // scrollable. `overscroll-behavior` keeps horizontal flicks from
      // pulling the page along.
      style={{ overscrollBehaviorX: 'contain' }}
      data-pending={isPending ? '' : undefined}
    >
      {items.map((item) => {
        const isActive = item.value === null ? active === '' : item.value === active
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => handleClick(item.value)}
            aria-pressed={isActive}
            data-active={isActive ? '' : undefined}
            className={[
              'inline-flex shrink-0 items-center justify-center border px-4 py-1.5',
              'text-[0.7rem] uppercase tracking-[0.1em] transition-colors duration-150',
              'cursor-pointer',
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
