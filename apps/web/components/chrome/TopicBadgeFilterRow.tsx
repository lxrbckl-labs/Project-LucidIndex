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
/** Sentinel value used by the ToggleGroup for the "Starred" virtual entry. */
const STARRED_VALUE = '__starred__'

export function TopicBadgeFilterRow({ badges }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const { starred } = useTopicPrefs()

  // Active value: starred → STARRED_VALUE; badge param → that badge name;
  // otherwise "" (= All).
  const starredActive = searchParams.get(STARRED_PARAM) === '1'
  const badgeActive = searchParams.get(BADGE_PARAM)?.trim() ?? ''
  const active = starredActive ? STARRED_VALUE : badgeActive

  // Build row items. "All" first, "Starred" second (virtual), then badges.
  const items = useMemo(() => {
    const list: Array<{ key: string; label: string; value: string }> = [
      { key: '__all__', label: 'All', value: '' },
      { key: '__starred__', label: 'Starred', value: STARRED_VALUE },
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
      const params = new URLSearchParams(searchParams.toString())
      // Reset both filter params; selection sets exactly one.
      params.delete(BADGE_PARAM)
      params.delete(STARRED_PARAM)
      if (next === STARRED_VALUE) {
        params.set(STARRED_PARAM, '1')
      } else if (next) {
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
        {items.map((item) => {
          const isSentinel = item.value === '' || item.value === STARRED_VALUE
          const isStarredTopic = !isSentinel && starred.has(item.value)
          const bold = isSentinel || isStarredTopic
          return (
            <ToggleGroupItem
              key={item.key}
              value={item.value}
              aria-label={item.label === 'All' ? 'Show all topics' : `Filter by ${item.label}`}
              variant="outline"
              size="sm"
              className={`shrink-0 rounded-full px-4 text-xs uppercase tracking-[0.1em] data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 ${
                bold ? 'font-extrabold' : ''
              }`}
            >
              {item.label}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </nav>
  )
}
