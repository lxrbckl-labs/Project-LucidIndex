'use client'

/**
 * Notifications panel — client component for the Settings →
 * Notifications page. Renders the list of notifications (server-fetched
 * for the first page, fetched lazily for subsequent pages via
 * `next_cursor`) and handles three interactions:
 *
 *   1. Click on a row body → mark-read + navigate to the source post
 *      (with `#comment-<id>` anchor when present). Row STAYS visible
 *      after click; only the "new" tint disappears once read_at is
 *      mirrored locally.
 *   2. Per-row trash icon → delete that single row.
 *   3. "Clear all" button at top-right → confirm + DELETE every row
 *      belonging to the user.
 *
 * All mutations go through the `/api/forum/notifications/*` endpoints,
 * which scope on the auth'd recipient. Optimistic UI: we mark/delete
 * locally first; if the request fails we surface a toast and roll back.
 *
 * Empty state mirrors the project's convention ("You're all caught
 * up.") with a centered dashed-border card.
 */

import { Bell, Loader2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NotificationListItem } from '../_lib/notifications-repo'

type Props = {
  initialItems: NotificationListItem[]
  initialCursor: string | null
}

/** Relative-time helper — mirrors the forum feed's helper of the same
 *  name. Kept duplicated rather than shared so each component stays
 *  self-contained; if a third caller wants it we'll lift it. */
function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

function targetHref(item: NotificationListItem): string {
  if (item.comment_id) {
    return `/forum/posts/${item.post_id}#comment-${item.comment_id}`
  }
  return `/forum/posts/${item.post_id}`
}

function describeKind(item: NotificationListItem): React.ReactNode {
  const actor = (
    <span className="font-semibold text-foreground">
      @{item.actor_username}
      {item.actor_is_agent ? (
        <span className="ml-1 text-xs text-muted-foreground">(agent)</span>
      ) : null}
    </span>
  )
  const title = <span className="font-semibold text-foreground">{item.post_title}</span>
  switch (item.kind) {
    case 'mentioned_in_post':
      return (
        <>
          {actor} mentioned you in their post {title}
        </>
      )
    case 'mentioned_in_comment':
      return (
        <>
          {actor} mentioned you in a comment on {title}
        </>
      )
    case 'reply_to_my_post':
      return (
        <>
          {actor} replied to your post {title}
        </>
      )
  }
}

export function NotificationsPanel({ initialItems, initialCursor }: Props) {
  const [items, setItems] = useState(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  // useTransition keeps the mark-read POST off the navigation critical
  // path — the link still navigates immediately while the network
  // round-trip happens in the background.
  const [, startTransition] = useTransition()

  async function handleRowClick(item: NotificationListItem) {
    if (item.read_at) return
    // Optimistic: tint the row as read immediately.
    const optimistic = new Date().toISOString()
    setItems((prev) =>
      prev.map((row) => (row.id === item.id ? { ...row, read_at: optimistic } : row)),
    )
    startTransition(() => {
      void fetch(`/api/forum/notifications/${item.id}/read`, { method: 'POST' }).then((res) => {
        if (!res.ok) {
          // Roll back the optimistic tint so the user sees that the
          // server rejected the mark-read.
          setItems((prev) =>
            prev.map((row) => (row.id === item.id ? { ...row, read_at: null } : row)),
          )
          toast.error("Couldn't mark that notification read.")
        }
      })
    })
  }

  async function handleDelete(item: NotificationListItem, evt: React.MouseEvent) {
    evt.preventDefault()
    evt.stopPropagation()
    // Optimistic remove — restore on failure.
    const removedAt = items.indexOf(item)
    setItems((prev) => prev.filter((row) => row.id !== item.id))
    const res = await fetch(`/api/forum/notifications/${item.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setItems((prev) => {
        const copy = [...prev]
        copy.splice(removedAt, 0, item)
        return copy
      })
      toast.error("Couldn't delete that notification.")
    }
  }

  async function handleLoadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const url = new URL('/api/forum/notifications', window.location.origin)
      url.searchParams.set('cursor', cursor)
      const res = await fetch(url.toString())
      if (!res.ok) {
        toast.error("Couldn't load more notifications.")
        return
      }
      const json = (await res.json()) as {
        items: NotificationListItem[]
        next_cursor: string | null
      }
      setItems((prev) => [...prev, ...json.items])
      setCursor(json.next_cursor)
    } catch {
      toast.error('Network error while loading more.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleClearAll() {
    setClearing(true)
    const previous = items
    const previousCursor = cursor
    // Optimistic — drop the list immediately; restore on failure.
    setItems([])
    setCursor(null)
    const res = await fetch('/api/forum/notifications', { method: 'DELETE' })
    setClearing(false)
    setConfirmClearOpen(false)
    if (!res.ok) {
      setItems(previous)
      setCursor(previousCursor)
      toast.error("Couldn't clear notifications.")
      return
    }
    toast.success('Notifications cleared.')
  }

  return (
    <div className="max-w-[840px] flex flex-col gap-6">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Mentions of you, and replies to your posts.
            </p>
          </div>
          {items.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClearOpen(true)}
              disabled={clearing}
            >
              Clear all
            </Button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Bell className="mx-auto mb-3 size-6 text-muted-foreground/60" aria-hidden="true" />
          You&rsquo;re all caught up.
        </div>
      ) : (
        <ul className="divide-y border-y" data-testid="notification-list">
          {items.map((item) => {
            const unread = item.read_at === null
            return (
              <li
                key={item.id}
                className={cn(
                  'group relative flex items-start gap-3 py-3 px-3 transition-colors hover:bg-accent/50',
                  unread && 'bg-primary/5',
                )}
                data-testid="notification-row"
                data-unread={unread ? 'true' : 'false'}
              >
                {/* Avatar */}
                <div className="size-8 shrink-0 overflow-hidden rounded-full border bg-background">
                  {/* biome-ignore lint/performance/noImgElement: bytea route */}
                  <img
                    src={`/api/forum/users/${item.actor_username}/avatar`}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      // Avatar may 404 for users who never set one — hide
                      // the broken-image glyph; the initials-on-color
                      // treatment from the forum doesn't exist on the
                      // settings surface so a blank background is fine.
                      e.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                </div>

                {/* Row body — wrapped in a Link so the WHOLE area is the
                    click target, and the link triggers mark-read +
                    navigates in one go. */}
                <Link
                  href={targetHref(item)}
                  prefetch={false}
                  onClick={() => void handleRowClick(item)}
                  className="flex-1 min-w-0 text-sm leading-relaxed text-muted-foreground hover:text-foreground"
                >
                  <div className="flex items-center gap-2">
                    {unread ? (
                      <span
                        className="size-2 shrink-0 rounded-full bg-primary"
                        role="img"
                        aria-label="Unread"
                      />
                    ) : null}
                    <span className="truncate">{describeKind(item)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {relativeTime(item.created_at)}
                  </div>
                </Link>

                {/* Per-row delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete notification"
                  className="size-8 shrink-0 opacity-60 hover:opacity-100"
                  onClick={(e) => void handleDelete(item, e)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={confirmClearOpen}
        onOpenChange={(open) => {
          if (!clearing) setConfirmClearOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every notification in your list. You can&rsquo;t recover them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              onClick={(e) => {
                e.preventDefault()
                void handleClearAll()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearing ? 'Clearing…' : 'Clear all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
