'use client'

/**
 * TopicBadgeFilterRow — topic-badge filter (Phase 3 rebuild on shadcn).
 *
 * Rebuilt using shadcn `ToggleGroup` (single-select) instead of raw
 * <button> pills. All URL-writeback behaviour is preserved:
 *   - Active badge → ?badge=<name> in the URL (router.replace, no push).
 *   - Selecting the active item again → clears the filter ("All" selected).
 *   - Selecting "All" → clears the filter.
 *   - Deep-link / back-forward: active state derived from URL.
 *
 * The ToggleGroup `value` mirrors the URL's ?badge= param.  An empty
 * string represents "All selected" (no filter). Clicking the current
 * value fires onValueChange with "" (Radix deselects), which we
 * interpret as "clear" — same click-same-to-clear semantics as before.
 *
 * Mobile horizontal scroll: the outer <nav> still uses overflow-x-auto
 * with scrollbar-hide so the row scrolls on narrow viewports. The
 * ToggleGroup's `justify-center` default is overridden with
 * `justify-start` so pills left-align and the row scrolls correctly.
 *
 * Exports BADGE_PARAM and TopicBadgeOption for external consumers.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useTransition } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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

  // Active badge = current value of ?badge=… from the URL. Empty string
  // means "All" is selected — the URL has no badge param.
  const active = searchParams.get(BADGE_PARAM)?.trim() ?? ''

  // Build row items. "All" is always the first, synthetic entry.
  const items = useMemo(() => {
    const list: Array<{ key: string; label: string; value: string }> = [
      { key: '__all__', label: 'All', value: '' },
    ]
    for (const b of badges) {
      list.push({ key: b.name, label: b.name, value: b.name })
    }
    return list
  }, [badges])

  const handleValueChange = useCallback(
    (next: string) => {
      // Radix fires onValueChange with "" when the user clicks the
      // already-active item (deselect) OR when "All" is clicked.
      // Either way → clear the badge param.
      const params = new URLSearchParams(searchParams.toString())
      if (!next) {
        params.delete(BADGE_PARAM)
      } else {
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

  // Scroll the active ToggleGroupItem into view when `active` changes
  // (deep-link / back-forward). Queries by data-state="on".
  const navRef = useRef<HTMLElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger; the body reads from the DOM.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const activeEl = nav.querySelector<HTMLElement>('[data-state="on"]')
    if (!activeEl) return
    activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [active])

  return (
    <nav
      ref={navRef}
      aria-label="Topic filter"
      className="lucidindex-pill-row overflow-x-auto overscroll-x-contain py-1"
      data-pending={isPending ? '' : undefined}
    >
      <ToggleGroup
        type="single"
        value={active}
        onValueChange={handleValueChange}
        className="flex flex-nowrap items-center gap-2 justify-start"
      >
        {items.map((item) => (
          <ToggleGroupItem
            key={item.key}
            value={item.value}
            aria-label={item.label === 'All' ? 'Show all topics' : `Filter by ${item.label}`}
            variant="outline"
            size="sm"
            className="shrink-0 rounded-full px-4 text-xs uppercase tracking-[0.1em]"
          >
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </nav>
  )
}
