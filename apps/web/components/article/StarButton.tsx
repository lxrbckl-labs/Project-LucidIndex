'use client'

/**
 * StarButton — star/unstar tile action (#66).
 *
 * Phase 4 rebuild: shadcn `<Button variant="ghost" size="icon">` with
 * lucide `<Star>` icon (filled when starred). Preserves existing optimistic
 * toggle state + server action. Used on both dashboard tiles and the
 * article detail page.
 *
 * Authorization: the parent server component decides whether to render
 * this button at all. When no admin session is present, the parent
 * passes `disabled` so the button renders as a non-interactive icon.
 *
 * `variant="labeled"` — used on the article detail page. Renders as a
 * polished outlined pill (icon + "Star" / "Starred" label) to match the
 * ShareLinkButton visual treatment. Tiles use the default `"icon"` mode.
 *
 * Toasts on every toggle:
 *   - Starred → toast.success('Starred')
 *   - Unstarred → toast('Unstarred')
 * First-time star: replaces the basic "Starred" toast with a longer-duration
 * one that links to /starred. Tracked via localStorage key
 * `lucidindex:has-starred-once`.
 */

import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { toggleStar } from '@/app/a/[slug]/actions'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const STARRED_ONCE_KEY = 'lucidindex:has-starred-once'

type Props = {
  articleId: string
  slug: string
  initialStarred: boolean
  /** True when no admin session is present — render visible-but-inert. */
  disabled?: boolean
  /**
   * `'icon'` (default) — ghost icon-only button, used on dashboard tiles.
   * `'labeled'` — outlined pill with icon + text label, used on the article
   *   detail page to match ShareLinkButton.
   */
  variant?: 'icon' | 'labeled'
  /** Extra classes merged onto the icon-variant button (e.g. size overrides). */
  className?: string
}

export function StarButton({
  articleId,
  slug,
  initialStarred,
  disabled = false,
  variant = 'icon',
  className,
}: Props) {
  const [starred, setStarred] = useState(initialStarred)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (disabled) return
    const next = !starred
    setStarred(next) // optimistic flip
    startTransition(async () => {
      try {
        await toggleStar(articleId, slug)
        if (next) {
          // Starring — check first-time hint
          if (typeof window !== 'undefined' && !localStorage.getItem(STARRED_ONCE_KEY)) {
            localStorage.setItem(STARRED_ONCE_KEY, '1')
            toast.success('Starred', {
              description: 'Find your starred articles at /starred',
              duration: 8000,
              action: {
                label: 'View',
                onClick: () => router.push('/starred'),
              },
            })
          } else {
            toast.success('Starred')
          }
        } else {
          // Unstarring
          toast('Unstarred')
        }
      } catch {
        // Revert on failure.
        setStarred(!next)
      }
    })
  }

  if (variant === 'labeled') {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={disabled || isPending}
        aria-pressed={starred}
        aria-label={starred ? 'Remove star' : 'Star this article'}
        data-testid="article-star"
      >
        <Star className={starred ? 'fill-current' : ''} aria-hidden="true" />
        {starred ? 'Starred' : 'Star'}
      </Button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('border', className)}
          onClick={handleClick}
          disabled={disabled || isPending}
          aria-pressed={starred}
          aria-label={starred ? 'Remove star' : 'Star this article'}
          data-testid="article-star"
        >
          <Star className={starred ? 'fill-current' : ''} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{starred ? 'UNSTAR' : 'STAR'}</TooltipContent>
    </Tooltip>
  )
}
