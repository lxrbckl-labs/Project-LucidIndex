'use client'

/**
 * RepliesPane — the right-hand pane that shows the flat reply thread for
 * a single forum post plus the inline composer. Owns its own local state
 * for `comments`, `draft`, and the in-flight submit guard.
 *
 * Rendering:
 *   - Header: "Replies (N)" + a close `<X>` icon (calls `onClose`)
 *   - List: oldest-first chronological thread. Each row is avatar +
 *     `@username` + optional agent badge + relative timestamp, with the
 *     body below as plain text (`whitespace-pre-wrap`). No markdown,
 *     no tokens — v1 replies are conversational text.
 *   - Empty state: "No replies yet — be the first." when the list is
 *     empty.
 *   - Form: 3-row textarea (resizable up), live char counter, Reply
 *     button. Disabled when empty / over cap / in-flight. Cmd/Ctrl+Enter
 *     submits.
 *
 * Submit:
 *   - POST `/api/forum/posts/[id]/comments` with `{ body }`
 *   - Optimistically appends a placeholder to the list keyed by a temp
 *     UUID; on success swaps it for the server row; on failure reverts
 *     and surfaces a toast.
 *   - Empties the textarea on success.
 *
 * No editing / deleting / reactions on comments in v1.
 */

import { X } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export type CommentRow = {
  id: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  authorHasAvatar: boolean
}

type Props = {
  postId: string
  comments: CommentRow[]
  onCommentsChange: (next: CommentRow[]) => void
  onClose: () => void
  /**
   * Configured reply-body character ceiling, read from
   * `forum_settings.max_reply_chars` server-side and threaded down via
   * `<RepliesShell>`. The counter and submit-disabled logic both key off
   * this value. Used to be a hardcoded 5000 inside this component;
   * migration 0025 made it admin-configurable.
   */
  maxReplyChars: number
}

/**
 * Render a comment's age relative to now. Mirrors the pattern used in
 * `CitationsSection` / the forum feed — single re-use site, not worth a
 * shared util.
 */
function relativeTime(d: Date): string {
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

export function RepliesPane({ postId, comments, onCommentsChange, onClose, maxReplyChars }: Props) {
  const [draft, setDraft] = useState('')
  const [inFlight, setInFlight] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const counterId = useId()

  const trimmedLength = draft.trim().length
  const overCap = draft.length > maxReplyChars
  const submitDisabled = inFlight || trimmedLength === 0 || overCap

  const submit = useCallback(async () => {
    if (submitDisabled) return
    const trimmed = draft.trim()
    if (trimmed.length === 0) return

    // Optimistic row keyed by a synthetic id we'll swap once the server
    // returns. `createdAt` is now() so it sorts last in the list.
    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: CommentRow = {
      id: tempId,
      body: trimmed,
      createdAt: new Date(),
      // Author info isn't critical for optimistic — the server response
      // overwrites it. Use placeholders that won't crash the row UI in
      // the unlikely revert path.
      authorUsername: 'you',
      authorIsAgent: false,
      authorHasAvatar: false,
    }

    const before = comments
    onCommentsChange([...comments, optimistic])
    setInFlight(true)

    try {
      const res = await fetch(`/api/forum/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        comment?: {
          id: string
          body: string
          createdAt: string
          authorUsername: string
          authorIsAgent: boolean
          authorHasAvatar: boolean
        }
      }
      if (!res.ok || !data.ok || !data.comment) {
        onCommentsChange(before)
        toast.error(data.error ?? "Couldn't post your reply.")
        return
      }
      const c = data.comment
      // Swap the optimistic row for the server row by id match.
      const next = [
        ...before,
        {
          id: c.id,
          body: c.body,
          createdAt: new Date(c.createdAt),
          authorUsername: c.authorUsername,
          authorIsAgent: c.authorIsAgent,
          authorHasAvatar: c.authorHasAvatar,
        },
      ]
      onCommentsChange(next)
      setDraft('')
    } catch {
      onCommentsChange(before)
      toast.error('Network error — please try again.')
    } finally {
      setInFlight(false)
    }
  }, [comments, draft, onCommentsChange, postId, submitDisabled])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter submits — matches the composer pattern.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="replies-pane">
      {/* Header — dividers span the full panel width via the outer
          container, the inner padding keeps content evenly inset.
          The pane's outer border-t sits exactly at the panel's own
          top edge (no inner padding offset). The parent <aside> in
          RepliesShell is `top-[68px]` so this rule lines up flush
          with the main content's `-mx-6 -mt-6 border-t` divider. */}
      <div className="border-t border-b">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Replies</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
            aria-label="Close replies"
            data-testid="replies-close-button"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="replies-empty-state">
            No replies yet — be the first.
          </p>
        ) : (
          <ul className="flex flex-col gap-5">
            {comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5" data-testid={`reply-row-${c.id}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar className="size-8">
                    {c.authorHasAvatar ? (
                      <AvatarImage src={`/api/forum/users/${c.authorUsername}/avatar`} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {c.authorUsername.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-foreground">@{c.authorUsername}</span>
                  {c.authorIsAgent && (
                    <Badge variant="secondary" className="font-normal">
                      agent
                    </Badge>
                  )}
                  <span aria-hidden="true">·</span>
                  <time dateTime={c.createdAt.toISOString()}>{relativeTime(c.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap break-words pl-10 text-sm leading-relaxed text-foreground">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composer */}
      <form
        className="flex flex-col gap-2 border-t p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a reply…"
          rows={3}
          className="resize-y"
          disabled={inFlight}
          aria-label="Write a reply"
          aria-describedby={counterId}
          data-testid="reply-textarea"
        />
        <div className="flex items-center justify-between">
          <span
            id={counterId}
            className={`text-xs ${overCap ? 'text-destructive' : 'text-muted-foreground'}`}
            data-testid="reply-char-counter"
          >
            {draft.length} / {maxReplyChars}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={submitDisabled}
            data-testid="reply-submit-button"
          >
            {inFlight ? 'Posting…' : 'Reply'}
          </Button>
        </div>
      </form>
    </div>
  )
}
