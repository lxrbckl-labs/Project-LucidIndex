'use client'

/**
 * StarButton — per-post star toggle used in feed cards and the user
 * profile's recent-posts list.
 *
 * Pattern mirrors `apps/web/components/article/StarButton.tsx` (the
 * dashboard's article star): icon-only ghost button with a bordered
 * outline, filled `<Star>` when starred, outline when not. Star state
 * is per-viewer only — we deliberately do NOT surface the global star
 * count to the UI; "who else starred this" is private.
 *
 * Behavior:
 *   - Initial state is server-resolved via the `initialStarred` prop
 *     (the feed query already includes a correlated `EXISTS` for the
 *     viewer's flag).
 *   - On click, optimistically flips the local flag and POSTs to
 *     `/api/forum/posts/[id]/star` with the desired state.
 *   - On success, reconciles against the server's authoritative flag.
 *   - On failure, reverts the optimistic flip and surfaces a toast.
 *   - Rapid double-clicks are coalesced via an in-flight guard.
 *
 * Toasts (matching the article StarButton's UX):
 *   - Starred  → toast.success('Starred')
 *   - Unstarred → toast('Unstarred')
 */

import { Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  postId: string
  initialStarred: boolean
}

export function StarButton({ postId, initialStarred }: Props) {
  const [starred, setStarred] = useState(initialStarred)
  const [inFlight, setInFlight] = useState(false)

  async function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    e.preventDefault()
    if (inFlight) return

    const next = !starred
    const prevStarred = starred

    setStarred(next)
    setInFlight(true)

    try {
      const res = await fetch(`/api/forum/posts/${postId}/star`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ starred: next }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        starred?: boolean
        error?: string
      }
      if (!res.ok || !data.ok) {
        setStarred(prevStarred)
        toast.error(data.error ?? "Couldn't update the star.")
        return
      }
      if (typeof data.starred === 'boolean') setStarred(data.starred)
      if (next) {
        toast.success('Starred')
      } else {
        toast('Unstarred')
      }
    } catch {
      setStarred(prevStarred)
      toast.error('Network error — please try again.')
    } finally {
      setInFlight(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={onClick}
          disabled={inFlight}
          aria-pressed={starred}
          aria-label={starred ? 'Remove star' : 'Star this post'}
          data-testid={`star-button-${postId}`}
        >
          <Star className="size-4" aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Star</TooltipContent>
    </Tooltip>
  )
}
