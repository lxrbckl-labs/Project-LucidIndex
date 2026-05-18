'use client'

/**
 * RepliesShell — client wrapper that owns the toggle state for the
 * replies sidebar on `/forum/posts/[id]`.
 *
 * Layout strategy:
 *   - Closed: the post column is centered at 640px (the original
 *     pre-sidebar layout). The reply pane isn't in the DOM at all.
 *   - Open (lg and up): two-column grid with the post left + the pane
 *     right (`minmax(0,640px) minmax(0,400px)`). The post is no longer
 *     centered — it shifts to the left to make room. Both columns use
 *     `minmax(0, ...)` so they gracefully shrink in viewports that
 *     can't quite host both at full size (forum-sidebar steals ~256px
 *     of viewport before we even start).
 *   - Open (below lg): the pane renders as a shadcn `<Sheet>` overlay
 *     sliding in from the right. The post stays at its closed centered
 *     layout underneath. Cleaner UX on narrow screens than squeezing
 *     two columns into ~400px of viewport.
 *
 * The Sheet is gated on a matchMedia hook (`isLg`) so Radix doesn't
 * portal a dialog into the tree when we're using the inline grid —
 * avoids the "DialogContent requires a DialogTitle" accessibility
 * warning that fires for an unmounted-on-screen-but-still-portaled
 * SheetContent. Either the inline pane is in the tree, OR the Sheet,
 * never both.
 *
 * The shell renders `<PostView>` itself rather than children-as-props so
 * the metadata strip's Replies button can fire `onToggleReplies` and
 * read `repliesOpen` + `replyCount` straight off its own props — no
 * separate context, no prop-drilling.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { PostView, type PostViewProps } from './PostView'
import { type CommentRow, RepliesPane } from './RepliesPane'

type Props = Omit<PostViewProps, 'repliesOpen' | 'onToggleReplies' | 'replyCount'> & {
  initialComments: CommentRow[]
  /**
   * Configured reply-body character ceiling, read from
   * `forum_settings.max_reply_chars` in the parent RSC page and forwarded
   * to the `<RepliesPane>` below. The shell itself doesn't introspect
   * the value — it's a straight pass-through.
   */
  maxReplyChars: number
}

/**
 * Tailwind `lg` breakpoint = 1024px. Track viewport width via matchMedia
 * so the inline grid vs Sheet decision happens once per resize, not on
 * every render. SSR-safe — `undefined` window on the first paint, defaults
 * to "small" until hydration runs.
 */
function useIsLg(): boolean {
  const [isLg, setIsLg] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 1024px)')
    setIsLg(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsLg(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isLg
}

export function RepliesShell({ initialComments, maxReplyChars, ...postViewProps }: Props) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<CommentRow[]>(initialComments)
  const isLg = useIsLg()

  const toggle = useCallback(() => setOpen((v) => !v), [])
  const close = useCallback(() => setOpen(false), [])

  const replyCount = comments.length
  const postId = postViewProps.post.id
  const inlineOpen = open && isLg
  const sheetOpen = open && !isLg

  return (
    <>
      {/* Edge-to-edge top border. Pulled out of the main padding with
          -mx-6 -mt-6 so it extends flush with the sidebar rail on the
          left and the viewport edge on the right — same pattern as the
          heading bands on /forum. */}
      <div className="-mx-6 -mt-6 border-t" />

      {/* When the inline replies pane is open, we split <main> into two
          flex columns: a flexible centering wrapper for the post and a
          fixed-width spacer matching the pane (44rem). This way the post
          is *visually* centered between the forum sidebar's right edge
          and the replies pane's left edge — `mx-auto` alone fails because
          the parent SidebarInset's `p-6` creates an asymmetric 24px gutter
          on the right (panel side) vs left, so we also negate the parent
          padding (`-mx-6` style) when open so main spans the full visible
          width and the flex centering picks the geometric midpoint. When
          the pane is closed, main stays in its old centered-640px layout
          inside the parent's `p-6`. */}
      <main
        className="flex transition-[margin,padding] duration-200 ease-out"
        style={{
          marginLeft: inlineOpen ? '-1.5rem' : undefined,
          marginRight: inlineOpen ? '-1.5rem' : undefined,
        }}
      >
        <div className="flex flex-1 justify-center px-4 pt-4 pb-4 sm:px-6 sm:pt-6 sm:pb-6">
          <article className="w-full max-w-[640px]">
            <PostView
              {...postViewProps}
              repliesOpen={open}
              onToggleReplies={toggle}
              replyCount={replyCount}
            />
          </article>
        </div>
        {inlineOpen && <div aria-hidden="true" className="w-[44rem] shrink-0" />}
      </main>

      {/* Right-side designated sidebar — mirrors the left ForumSidebar's
          visual chrome (bg-sidebar background, border, full content
          height) but on the opposite edge. Always mounted at lg+ so the
          slide-in/out transition works in both directions; the
          translateX hides it off-screen when closed. Below lg we use the
          Sheet overlay further down, so the aside is hidden via the
          `hidden lg:block` modifier.

          `top-[68px]` is the rendered height of the sticky TopNav
          (`p-4` + `h-9` grid row + wordmark). Pinning the panel's top
          edge to that pixel lets its outer `border-t` (inside RepliesPane)
          land exactly on the same Y as main's `-mx-6 -mt-6 border-t`
          horizontal rule. Previously the panel was `top-0` with a
          `pt-[2.75rem]` (44px) inner pad, which mis-aligned the two
          rules by ~24px. */}
      <aside
        aria-label="Replies"
        aria-hidden={!inlineOpen}
        data-testid="replies-aside"
        data-state={inlineOpen ? 'open' : 'closed'}
        className="hidden lg:block fixed right-0 top-[68px] bottom-0 z-30 w-[44rem] border-l bg-sidebar text-sidebar-foreground overflow-hidden transition-transform duration-200 ease-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0"
      >
        <RepliesPane
          postId={postId}
          comments={comments}
          onCommentsChange={setComments}
          onClose={close}
          maxReplyChars={maxReplyChars}
        />
      </aside>

      {/* Mobile/tablet pane — Sheet overlay sliding in from the right.
          Only rendered when open AND viewport is below lg, so the lg
          inline grid above doesn't double up with a portaled dialog.
          A visually-hidden SheetTitle + SheetDescription satisfies
          Radix's a11y requirement without changing the pane's own
          header. */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetTitle className="sr-only">Replies</SheetTitle>
          <SheetDescription className="sr-only">
            View and post replies to this forum post.
          </SheetDescription>
          <RepliesPane
            postId={postId}
            comments={comments}
            onCommentsChange={setComments}
            onClose={close}
            maxReplyChars={maxReplyChars}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
