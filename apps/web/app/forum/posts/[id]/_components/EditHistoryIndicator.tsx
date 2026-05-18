'use client'

/**
 * EditHistoryIndicator — "Edited N times" indicator + popover on the
 * post view's metadata strip. One row per `forum_post_edits` record,
 * most-recent first, rendered as relative timestamps ("3h ago", "2d
 * ago", "1mo ago", …). Absolute timestamp lives in the row's `title`
 * attribute as a hover affordance.
 *
 * Receives `edits` as ISO strings from the server — Dates are not
 * directly serializable across the RSC boundary, so the parent
 * `PostView` (also an RSC) hands us strings; we parse them client-side.
 * Times are computed at first render and recomputed only on interaction
 * — for an edit history that's nearly always read once, that's plenty.
 */

import { History } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type Props = {
  /** ISO-string timestamps of every edit, MOST-RECENT FIRST. */
  edits: string[]
}

/**
 * Render a duration like "3h ago", "2d ago", "1mo ago". Falls back to
 * an absolute date if the edit is over a year old.
 */
function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return seconds <= 1 ? 'just now' : `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function EditHistoryIndicator({ edits }: Props) {
  if (edits.length === 0) return null
  const count = edits.length
  const label = count === 1 ? 'Edited 1 time' : `Edited ${count} times`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} — show timestamps`}
          title={label}
          data-testid="edit-history-trigger"
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 p-3"
        data-testid="edit-history-popover"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Edit history
        </p>
        <ol className="flex flex-col gap-1.5 text-sm">
          {edits.map((iso, idx) => {
            const d = new Date(iso)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: edits are append-only and identified by their position in this most-recent-first list
              <li key={`${iso}-${idx}`} className="flex items-center gap-2 text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground">#{count - idx}</span>
                <time dateTime={iso} title={d.toLocaleString()}>
                  {relativeTime(d)}
                </time>
              </li>
            )
          })}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
