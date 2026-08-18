'use client'

/**
 * SeenIndicator — bottom-right card footer indicator.
 *
 * Renders a faint date string, optionally followed by a checkmark when
 * the user has visited the article's detail page. Uses localStorage via
 * `useSeenArticles` (hydrated on the client; empty during SSR so there
 * is no hydration mismatch).
 *
 * Props:
 *   articleId — used to check/update the seen set
 *   date      — the date to display (the article's createdAt).
 *               Accepts a Date, an ISO string, or null. Null renders nothing.
 */

import { Check } from 'lucide-react'
import { useSeenArticles } from '@/lib/use-seen-articles'

type Props = {
  articleId: string
  date: Date | string | null | undefined
}

function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
}

export function SeenIndicator({ articleId, date }: Props) {
  const { seen } = useSeenArticles()
  const isSeen = seen.has(articleId)
  const dateText = formatDate(date)

  if (!dateText) return null

  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-xs text-muted-foreground">{dateText}</span>
      {isSeen ? <Check className="ml-0.5 h-3 w-3 text-muted-foreground" /> : null}
    </span>
  )
}
