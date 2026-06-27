'use client'

/**
 * TileShareButton — share button on dashboard tiles (#68).
 *
 * Phase 4 rebuild: shadcn `<Button variant="ghost" size="icon">` with
 * lucide `<Share2>` icon. Preserves existing onClick (clipboard copy) +
 * stopPropagation guard + sonner toast on success.
 *
 * Copied state: after a successful copy, the icon swaps from <Share2> to
 * <Check> and the button is disabled for ~2 seconds, then reverts.
 *
 * MUST NOT trigger the tile's <Link> navigation.
 */

import { Check, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const COPIED_DURATION_MS = 2000

type Props = {
  /**
   * Article slug. The shareable URL is built CLIENT-SIDE from the current
   * origin (`window.location.origin`) at click time, so it matches the address
   * bar the visitor is on — not the server's baked-in `WEBAUTHN_ORIGIN` (which
   * is `localhost:47892` in the container image). Mirrors what the article-page
   * share does via `window.location.href`.
   */
  slug: string
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

export function TileShareButton({ slug }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_DURATION_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const handleClick = async (e: React.MouseEvent) => {
    // Stop the event bubbling up to the parent <Link> so clicking Share
    // does not navigate to the article page.
    e.stopPropagation()
    e.preventDefault()

    if (typeof window === 'undefined') return
    // Build from the live origin so the copied link matches where the visitor
    // actually is (prod domain, LAN IP, localhost — whatever's in the bar).
    const target = `${window.location.origin}/a/${slug}`
    let ok = false
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(target)
        ok = true
      } catch {
        ok = copyViaTextarea(target)
      }
    } else {
      ok = copyViaTextarea(target)
    }
    if (ok) {
      setCopied(true)
      toast.success('Link copied')
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="border"
          onClick={handleClick}
          disabled={copied}
          aria-label="Copy share link"
          data-testid="tile-share"
        >
          {copied ? <Check /> : <Share2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'COPIED' : 'SHARE'}</TooltipContent>
    </Tooltip>
  )
}
