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
  /** Absolute URL of the article to share. */
  url: string
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

export function TileShareButton({ url }: Props) {
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
    let ok = false
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url)
        ok = true
      } catch {
        ok = copyViaTextarea(url)
      }
    } else {
      ok = copyViaTextarea(url)
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
