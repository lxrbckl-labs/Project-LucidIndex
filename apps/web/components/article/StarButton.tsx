'use client'

/**
 * StarButton — star/unstar an article.
 *
 * Stars are a CLIENT-ONLY, guest-friendly preference stored in localStorage
 * (`article-prefs.ts`) — no sign-in required, mirroring starred topics/
 * creators. There is no admin gate and the button is never disabled. Used on
 * dashboard tiles (`variant="icon"`) and the article detail page
 * (`variant="labeled"`).
 *
 * First-time star shows a longer toast linking to /starred, tracked via
 * `lucidindex:has-starred-once`.
 */

import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isArticleStarred, toggleStarredArticle } from '@/lib/article-prefs'
import { cn } from '@/lib/utils'

const STARRED_ONCE_KEY = 'lucidindex:has-starred-once'

type Props = {
  articleId: string
  /**
   * `'icon'` (default) — ghost icon-only button, used on dashboard tiles.
   * `'labeled'` — outlined pill with icon + text, used on the article page.
   */
  variant?: 'icon' | 'labeled'
  /** Extra classes merged onto the icon-variant button (e.g. size overrides). */
  className?: string
}

export function StarButton({ articleId, variant = 'icon', className }: Props) {
  const [starred, setStarred] = useState(false)
  const router = useRouter()

  // Hydrate from localStorage after mount (client-only; avoids SSR mismatch).
  useEffect(() => {
    setStarred(isArticleStarred(articleId))
  }, [articleId])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const next = toggleStarredArticle(articleId)
    setStarred(next)
    if (next) {
      if (typeof window !== 'undefined' && !localStorage.getItem(STARRED_ONCE_KEY)) {
        localStorage.setItem(STARRED_ONCE_KEY, '1')
        toast.success('Starred', {
          description: 'Find your starred articles at /starred',
          duration: 8000,
          action: { label: 'View', onClick: () => router.push('/starred') },
        })
      } else {
        toast.success('Starred')
      }
    } else {
      toast('Unstarred')
    }
  }

  if (variant === 'labeled') {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
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
