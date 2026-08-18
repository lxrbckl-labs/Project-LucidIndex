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

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useRepliesPaneVisibility } from '@/lib/replies-pane-visibility'
import { PostView, type PostViewProps } from './PostView'
import { type CommentRow, type PostOption, RepliesPane, type UserOption } from './RepliesPane'

type Props = Omit<PostViewProps, 'repliesOpen' | 'onToggleReplies' | 'replyCount'> & {
  initialComments: CommentRow[]
  /**
   * Configured reply-body character ceiling, read from
   * `forum_settings.max_reply_chars` in the parent RSC page and forwarded
   * to the `<RepliesPane>` below. The shell itself doesn't introspect
   * the value — it's a straight pass-through.
   */
  maxReplyChars: number
  /**
   * Top-200 most-recent posts (joined with author info) the reply
   * composer's `@`-dropdown surfaces in its Posts section. Same shape
   * as the create-page composer payload so the dropdown UI stays
   * identical.
   */
  recentPosts: PostOption[]
  /**
   * Top-200 forum users (excluding the viewer) the reply composer's
   * `@`-dropdown surfaces in its Users section.
   */
  users: UserOption[]
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

export function RepliesShell({
  initialComments,
  maxReplyChars,
  recentPosts,
  users,
  ...postViewProps
}: Props) {
  // The parent-post's image set is already part of `postViewProps`
  // (PostView consumes it to render inline figures + the gallery
  // accordion). We forward it to RepliesPane unchanged so the reply
  // composer's `@`-dropdown can offer them as `@ImageN` insertions
  // and so submitted comments render image tokens as inline figures.
  const postImages = postViewProps.images
  // Replies open/close state is owned by the shared hook so the TopNav
  // button and the X icon in the pane stay in sync across renders. The
  // hook defaults to visible=true and persists to localStorage.
  const { visible: open, toggle } = useRepliesPaneVisibility()
  const [comments, setComments] = useState<CommentRow[]>(initialComments)
  const isLg = useIsLg()

  // `close` is just toggle when the pane is open. Both callsites (the X
  // button inside RepliesPane and the Sheet onOpenChange handler) only
  // fire when the pane is already open, so toggle() always closes here.
  const close = toggle

  const replyCount = comments.length
  const postId = postViewProps.post.id
  const inlineOpen = open && isLg
  const sheetOpen = open && !isLg

  return (
    <>
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
        className="flex overflow-x-clip transition-[margin] duration-200 ease-linear"
        style={{
          marginTop: '-1.5rem',
          marginLeft: '-1.5rem',
          marginRight: '-1.5rem',
        }}
      >
        <div className="flex min-w-0 flex-1 justify-center px-4 pt-4 pb-4 sm:pt-6 sm:pb-6">
          <article className="w-full min-w-0 lg:max-w-[640px]">
            <PostView
              {...postViewProps}
              repliesOpen={open}
              onToggleReplies={toggle}
              replyCount={replyCount}
            />
          </article>
        </div>
        <div
          aria-hidden="true"
          className="hidden lg:block shrink-0 transition-[width] duration-200 ease-linear"
          style={{ width: inlineOpen ? '44rem' : '0px' }}
        />
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
        className="hidden lg:block fixed right-0 top-[68px] bottom-0 z-30 w-[44rem] border-l bg-sidebar text-sidebar-foreground overflow-hidden transition-transform duration-200 ease-linear data-[state=closed]:translate-x-full data-[state=open]:translate-x-0"
      >
        <RepliesPane
          postId={postId}
          comments={comments}
          onCommentsChange={setComments}
          onClose={close}
          maxReplyChars={maxReplyChars}
          recentPosts={recentPosts}
          users={users}
          postImages={postImages}
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
        <SheetContent side="right" hideClose className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
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
            recentPosts={recentPosts}
            users={users}
            postImages={postImages}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
