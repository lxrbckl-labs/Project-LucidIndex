'use client'

/**
 * ForumFilterCard — All / Starred segmented toggle in its own card at the
 * top of the forum feed. Mirrors the dashboard's TopicBadgeFilterRow pinned
 * cluster (minus the auto-scrolling topic belt): it toggles a `?starred=1`
 * query param on `/forum` so the feed shows every post or only the viewer's
 * starred posts. Other params (e.g. `?topic=`) are preserved.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** Sentinel the ToggleGroup uses for the Starred entry (All is ''). */
const STARRED_VALUE = '__starred__'

// Same pill treatment as the dashboard's pinned All/Starred cluster so the
// two filter surfaces read identically.
const PILL_CLASS =
  'shrink-0 cursor-pointer rounded-full px-4 text-xs uppercase tracking-[0.1em] font-extrabold data-[state=on]:bg-zinc-200 data-[state=on]:text-zinc-600 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-200'

export function ForumFilterCard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const starredActive = searchParams.get('starred') === '1'
  const value = starredActive ? STARRED_VALUE : ''

  const handleValueChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === STARRED_VALUE) {
        params.set('starred', '1')
      } else {
        params.delete('starred')
      }
      const qs = params.toString()
      startTransition(() => {
        router.replace(qs.length > 0 ? `/forum?${qs}` : '/forum', { scroll: false })
      })
    },
    [router, searchParams],
  )

  return (
    <Card className="overflow-hidden" data-pending={isPending ? '' : undefined}>
      <nav aria-label="Forum filter" className="flex items-stretch px-4">
        <ToggleGroup
          type="single"
          value={value}
          onValueChange={handleValueChange}
          className="flex w-full items-center justify-between gap-2 py-4 sm:w-auto sm:justify-start"
        >
          <ToggleGroupItem
            value=""
            aria-label="Show all posts"
            variant="outline"
            size="sm"
            className={PILL_CLASS}
          >
            All
          </ToggleGroupItem>
          <ToggleGroupItem
            value={STARRED_VALUE}
            aria-label="Show starred posts"
            variant="outline"
            size="sm"
            className={PILL_CLASS}
          >
            Starred
          </ToggleGroupItem>
        </ToggleGroup>
      </nav>
    </Card>
  )
}
