'use client'

/**
 * HideArticleButton — admin-only hide action on tiles and article page (#69).
 *
 * Phase 4 rebuild: shadcn `<Button variant="ghost" size="icon">` with
 * lucide `<EyeOff>` icon. Wraps in `<AlertDialog>` confirm before
 * firing the hide server action — replaces the old `window.confirm()`.
 *
 * On confirm: fires `hideArticle` inside a React `startTransition` so
 * the server action's inline RSC diff is applied atomically — the same
 * pattern `StarButton` uses for `toggleStar`.
 *
 * `hideArticle` calls `revalidatePath('/')` before returning, so its HTTP
 * response already contains the re-rendered dashboard RSC tree (without the
 * hidden tile). Applying that diff is all that's needed — no `router.refresh()`
 * required, and adding one creates a competing transition that can race against
 * the action's own update and leave the tile visible.
 *
 * On the article detail page (`redirectOnHide=true`) we still navigate away with
 * `router.push('/')` because the article page 404s after hiding — but we wait
 * until the transition completes so the navigation and the DB write are in sync.
 *
 * `variant="labeled"` — used on the article detail page. Renders as a
 * polished outlined pill (icon + "Hide" label) to match the ShareLinkButton
 * visual treatment. Tiles use the default `"icon"` mode.
 */

import { EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { hideArticle } from '@/app/a/[slug]/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  articleId: string
  slug: string
  /**
   * `'icon'` (default) — ghost icon-only button, used on dashboard tiles.
   * `'labeled'` — outlined pill with icon + "Hide" label, used on the article
   *   detail page to match ShareLinkButton.
   */
  variant?: 'icon' | 'labeled'
  /**
   * When `true` (article detail page), navigate to `/` after hiding — the
   * article 404s on its next render so we must leave the page. When `false`
   * (default, dashboard tiles), no explicit navigation is needed: the server
   * action's inline RSC diff already re-renders the dashboard without the
   * hidden tile (hideArticle calls revalidatePath('/') before returning).
   */
  redirectOnHide?: boolean
}

export function HideArticleButton({
  articleId,
  slug,
  variant = 'icon',
  redirectOnHide = false,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleHide() {
    startTransition(async () => {
      await hideArticle(articleId, slug)
      if (redirectOnHide) {
        router.push('/')
      }
      // Dashboard tiles: no router.refresh() needed. hideArticle() calls
      // revalidatePath('/') before returning, so the server action's inline
      // RSC response already contains the updated dashboard without this tile.
      // Adding router.refresh() creates a competing transition that races
      // against the action's own RSC diff and can leave the tile visible.
    })
  }

  const dialogContent = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Hide this article?</AlertDialogTitle>
        <AlertDialogDescription>
          The article will disappear from the dashboard and share-link. You can restore it later in
          Settings &rarr; Hidden articles (Phase 7 #78).
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={handleHide}
          disabled={isPending}
        >
          {isPending ? 'Hiding…' : 'Hide article'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )

  if (variant === 'labeled') {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            aria-label="Hide article"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <EyeOff aria-hidden="true" />
            Hide
          </Button>
        </AlertDialogTrigger>
        {dialogContent}
      </AlertDialog>
    )
  }

  return (
    <Tooltip>
      <AlertDialog>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="border border-foreground"
              disabled={isPending}
              aria-label="Hide article"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              <EyeOff />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        {dialogContent}
      </AlertDialog>
      <TooltipContent>HIDE</TooltipContent>
    </Tooltip>
  )
}
