'use client'

/**
 * ShareLinkButton — polished clipboard copy of the absolute article URL (#68).
 *
 * Phase 5 rebuild: shadcn `<Button variant="outline">` with lucide `<Share2>`
 * icon and "Share" text label. Preserves clipboard copy + "Copied!" affordance.
 *
 * Full UX:
 *   - "Share" → click → copies + shows "Copied!" affordance for ~1.5s.
 *   - Textarea fallback for non-secure contexts / older browsers that
 *     lack the Clipboard API.
 *   - Accepts an optional `url` prop so the dashboard tile can pass
 *     the article URL explicitly (tile renders server-side; it doesn't
 *     have `window.location`). When omitted, falls back to
 *     `window.location.href` (the article-page usage).
 */

import { Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  /** Explicit URL to copy. Falls back to `window.location.href` when omitted. */
  url?: string
}

/** execCommand fallback for environments without `navigator.clipboard`. */
function copyViaTextarea(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function ShareLinkButton({ url }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleClick = async () => {
    if (typeof window === 'undefined') return
    const target = url ?? window.location.href
    let ok = false
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(target)
        ok = true
      } catch {
        // clipboard API blocked — try execCommand fallback
        ok = copyViaTextarea(target)
      }
    } else {
      ok = copyViaTextarea(target)
    }
    if (ok) setCopied(true)
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} data-testid="article-share">
      <Share2 aria-hidden="true" />
      {copied ? 'Copied!' : 'Share'}
    </Button>
  )
}
