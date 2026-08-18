'use client'

/**
 * RepliesPane — the right-hand pane that shows the flat reply thread for
 * a single forum post plus the inline composer. Owns its own local state
 * for `comments`, `draft`, the in-flight submit guard, and the citation
 * + user-mention slots picked via the `@`-dropdown.
 *
 * Rendering:
 *   - Header: "Replies (N)" + a close `<X>` icon (calls `onClose`)
 *   - List: oldest-first chronological thread. Each row is avatar +
 *     `@username` + optional agent badge + relative timestamp, with the
 *     body below rendered through `<CommentBody>` — plain text with
 *     `@PostN` → blue hyperlink, `@<username>` → styled link, and
 *     `@ImageN` → inline figure (resolved against the parent post's
 *     image set). No markdown.
 *   - Empty state: "No replies yet — be the first." when the list is
 *     empty.
 *   - Composer: 3-row textarea (resizable up), live char counter, Reply
 *     button. Disabled when empty / over cap / in-flight. Cmd/Ctrl+Enter
 *     submits. Typing `@` opens a dropdown with THREE sections (Posts +
 *     Users + Images — the Images section lists every parent-post image,
 *     no de-dup so the same `@ImageN` can be inserted multiple times);
 *     arrow keys move the highlight, Enter / Tab commits.
 *
 * Submit:
 *   - POST `/api/forum/posts/[id]/comments` with `{ body, citations,
 *     user_mentions }`. The server filters citations/mentions whose
 *     token isn't actually in the body (same lifecycle as posts).
 *   - Optimistically appends a placeholder to the list keyed by a temp
 *     UUID; on success swaps it for the server row (with the enriched
 *     citations + mentions); on failure reverts and surfaces a toast.
 *   - Empties the textarea + clears slot state on success.
 *
 * No editing / deleting / reactions on comments in v1.
 */

import { Send, X } from 'lucide-react'
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  CommentBody,
  type CommentBodyPostImage,
  type CommentCitation,
  type CommentUserMention,
} from './CommentBody'

/**
 * One row in the reply composer's `@`-dropdown Posts section. Sourced
 * from the top-200-most-recent-posts list the RSC parent loads at page
 * render. Shape matches `PostComposer`'s `PostOption` so the dropdown
 * UX stays identical between create-post and reply composers.
 */
export type PostOption = {
  id: string
  title: string
  authorUsername: string
  authorIsAgent: boolean
  /** ISO string from the server. Not surfaced in the dropdown today but
   * kept on the shape for future ordering tweaks. */
  createdAt: string
}

/**
 * One row in the reply composer's `@`-dropdown Users section. Sourced
 * from the top-200 forum users (excluding the viewer).
 */
export type UserOption = {
  id: string
  username: string
  isAgent: boolean
}

export type CommentRow = {
  id: string
  body: string
  createdAt: Date
  authorUsername: string
  authorIsAgent: boolean
  authorHasAvatar: boolean
  citations: CommentCitation[]
  userMentions: CommentUserMention[]
}

/**
 * One picked citation slot in the composer. Each slot pins one `@PostN`
 * sequence number to a cited post. The sequence never reuses a removed
 * slot's N — same posture as the post composer.
 */
type CitationSlot = {
  localId: string
  postId: string
  postTitle: string
  authorUsername: string
  authorIsAgent: boolean
  sequence: number
}

/**
 * One picked user-mention slot. No sequence — the body's `@<username>`
 * literal is the slot's identity.
 */
type UserMentionSlot = {
  localId: string
  userId: string
  username: string
  isAgent: boolean
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
  /**
   * Recent posts available as citation targets in the `@`-dropdown.
   * Capped at 200 by the parent RSC.
   */
  recentPosts: PostOption[]
  /**
   * Forum users available as mention targets. Excludes the current
   * viewer; capped at 200.
   */
  users: UserOption[]
  /**
   * The PARENT POST's uploaded images. Surfaced in the composer's
   * `@`-dropdown as an "Images" section, so a reply can reference any
   * of the post's images with `@ImageN`. Same set the post body itself
   * resolves against — replies don't upload their own images, they
   * piggyback on the post's existing set. Also threaded into
   * `<CommentBody>` so previously-submitted comments can render their
   * own `@ImageN` tokens as inline figures.
   */
  postImages: CommentBodyPostImage[]
}

let SLOT_COUNTER = 0
function nextSlotId() {
  SLOT_COUNTER += 1
  return `slot-${SLOT_COUNTER}-${Date.now().toString(36)}`
}

/**
 * Render a comment's age relative to now. Mirrors the pattern used in
 * `CitationsSection` / the forum feed.
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

/**
 * Detect an active `@<query>` mention range ending at the caret. Same
 * implementation as the post composer's helper — copied verbatim so the
 * two surfaces share UX semantics.
 */
function getActiveMention(
  body: string,
  caretPos: number,
): { start: number; end: number; query: string } | null {
  let i = caretPos - 1
  while (i >= 0) {
    const ch = body.charAt(i)
    if (ch === '@') {
      if (i === 0) {
        return { start: i, end: caretPos, query: body.slice(i + 1, caretPos) }
      }
      const prev = body.charAt(i - 1)
      if (/\s/.test(prev)) {
        return { start: i, end: caretPos, query: body.slice(i + 1, caretPos) }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i -= 1
  }
  return null
}

type MentionPostCandidate = { kind: 'post'; post: PostOption }
type MentionUserCandidate = { kind: 'user'; user: UserOption }
type MentionImageCandidate = { kind: 'image'; image: CommentBodyPostImage }
type MentionCandidate = MentionPostCandidate | MentionUserCandidate | MentionImageCandidate

export function RepliesPane({
  postId,
  comments,
  onCommentsChange,
  onClose,
  maxReplyChars,
  recentPosts,
  users,
  postImages,
}: Props) {
  const [draft, setDraft] = useState('')
  const [inFlight, setInFlight] = useState(false)
  const [citations, setCitations] = useState<CitationSlot[]>([])
  const [userMentions, setUserMentions] = useState<UserMentionSlot[]>([])

  // @-mention dropdown state
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionHighlight, setMentionHighlight] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const counterId = useId()
  const bodyId = useId()

  const trimmedLength = draft.trim().length
  const overCap = draft.length > maxReplyChars
  const submitDisabled = inFlight || trimmedLength === 0 || overCap

  // Sequence numbers (@PostN) already referenced in the body. Drives
  // the "live" citation filter on submit and the dropdown's "already
  // cited" exclusion.
  const referencedPostSequences = useMemo(() => {
    const set = new Set<number>()
    const re = /@Post(\d+)\b/g
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
    while ((m = re.exec(draft)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n)) set.add(n)
    }
    return set
  }, [draft])

  const referencedUsernames = useMemo(() => {
    const set = new Set<string>()
    const re = /@([a-z][a-z0-9_-]{2,19})\b/g
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
    while ((m = re.exec(draft)) !== null) {
      const u = m[1]
      if (u) set.add(u.toLowerCase())
    }
    return set
  }, [draft])

  const liveCitations = useMemo(
    () => citations.filter((c) => referencedPostSequences.has(c.sequence)),
    [citations, referencedPostSequences],
  )

  const liveUserMentions = useMemo(
    () => userMentions.filter((m) => referencedUsernames.has(m.username.toLowerCase())),
    [userMentions, referencedUsernames],
  )

  const postCandidates = useMemo<MentionPostCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    const citedIds = new Set(liveCitations.map((c) => c.postId))
    return recentPosts
      .filter((p) => !citedIds.has(p.id))
      .filter((p) => p.id !== postId) // can't cite the post we're commenting on
      .filter((p) => (q ? p.title.toLowerCase().includes(q) : true))
      .map((p) => ({ kind: 'post' as const, post: p }))
  }, [recentPosts, liveCitations, mentionQuery, postId])

  const userCandidates = useMemo<MentionUserCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    return users
      .filter((u) => !referencedUsernames.has(u.username.toLowerCase()))
      .filter((u) => (q ? u.username.toLowerCase().includes(q) : true))
      .map((u) => ({ kind: 'user' as const, user: u }))
  }, [users, referencedUsernames, mentionQuery])

  /**
   * Image candidates — NO de-dup. Unlike posts/users where each target
   * can only be picked once (the dropdown filters out cited / mentioned
   * entries), image references are arbitrary: a reply can `@Image1`
   * twice in the same body. Query filter matches against the rendered
   * `@ImageN` label (case-insensitive) so typing `@Im` narrows the
   * section as advertised; an empty query lists every image in
   * `sequenceNumber` order.
   */
  const imageCandidates = useMemo<MentionImageCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    const ordered = postImages.slice().sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    return ordered
      .filter((img) => {
        if (!q) return true
        const label = `image${img.sequenceNumber}`
        return label.toLowerCase().includes(q)
      })
      .map((img) => ({ kind: 'image' as const, image: img }))
  }, [postImages, mentionQuery])

  const mentionCandidates = useMemo<MentionCandidate[]>(
    () => [...postCandidates, ...userCandidates, ...imageCandidates],
    [postCandidates, userCandidates, imageCandidates],
  )

  // Clamp highlight when candidate list shrinks.
  useEffect(() => {
    if (mentionHighlight >= mentionCandidates.length) {
      setMentionHighlight(mentionCandidates.length === 0 ? 0 : mentionCandidates.length - 1)
    }
  }, [mentionCandidates.length, mentionHighlight])

  const closeMention = useCallback(() => {
    setMentionOpen(false)
    setMentionRange(null)
    setMentionQuery('')
    setMentionHighlight(0)
  }, [])

  const refreshMentionState = useCallback(
    (nextBody: string, caretPos: number) => {
      const active = getActiveMention(nextBody, caretPos)
      if (!active) {
        if (mentionOpen) closeMention()
        return
      }
      setMentionRange({ start: active.start, end: active.end })
      setMentionQuery(active.query)
      setMentionHighlight(0)
      setMentionOpen(true)
    },
    [mentionOpen, closeMention],
  )

  function onBodyChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const nextBody = e.target.value
    setDraft(nextBody)
    const caret = e.target.selectionStart ?? nextBody.length
    refreshMentionState(nextBody, caret)
  }

  function onBodySelectOrClick() {
    const el = textareaRef.current
    if (!el) return
    refreshMentionState(el.value, el.selectionStart ?? el.value.length)
  }

  // Auto-grow the textarea to fit its content as the user types, capped at
  // ~25% of the viewport height so a long draft stays readable without the
  // composer swallowing the whole sheet. Past the cap the textarea scrolls
  // internally. Runs on every draft change (typing, mention insert, and the
  // clear-on-submit reset).
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxPx = Math.round(window.innerHeight * 0.25)
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    // `draft` is the intended trigger — resize on every content change. The
    // resize reads the DOM (scrollHeight), not `draft` directly, so touch it
    // here to keep it a genuine dependency (same `void` idiom as below).
    void draft
    autoResizeTextarea()
  }, [draft, autoResizeTextarea])

  /**
   * Insert the selected mention token over the active range, move caret
   * past the inserted token, close dropdown. Trailing space appended if
   * the next char isn't already whitespace — keeps the dropdown from
   * immediately reopening on the just-inserted token.
   */
  const insertMention = useCallback(
    (cand: MentionCandidate) => {
      if (!mentionRange) return
      let baseToken: string
      let newCitation: CitationSlot | null = null
      let newUserMention: UserMentionSlot | null = null
      if (cand.kind === 'post') {
        const nextSeq =
          citations.length === 0 ? 1 : Math.max(...citations.map((c) => c.sequence)) + 1
        baseToken = `@Post${nextSeq}`
        newCitation = {
          localId: nextSlotId(),
          postId: cand.post.id,
          postTitle: cand.post.title,
          authorUsername: cand.post.authorUsername,
          authorIsAgent: cand.post.authorIsAgent,
          sequence: nextSeq,
        }
      } else if (cand.kind === 'user') {
        baseToken = `@${cand.user.username}`
        const already = userMentions.some((m) => m.userId === cand.user.id)
        if (!already) {
          newUserMention = {
            localId: nextSlotId(),
            userId: cand.user.id,
            username: cand.user.username,
            isAgent: cand.user.isAgent,
          }
        }
      } else {
        // Image — token is `@Image<N>` where N is the parent post's
        // image sequence number. No slot state needed: the renderer
        // resolves the token against `postImages` at render time, the
        // same way the post body resolves its own image tokens. Same
        // image can be referenced multiple times in one reply — no
        // de-dup, no slot.
        baseToken = `@Image${cand.image.sequenceNumber}`
      }
      const before = draft.slice(0, mentionRange.start)
      const after = draft.slice(mentionRange.end)
      const needsSpace = after.length === 0 || !/^\s/.test(after)
      const token = needsSpace ? `${baseToken} ` : baseToken
      const nextBody = before + token + after
      const nextCaret = before.length + token.length
      setDraft(nextBody)
      if (newCitation) {
        setCitations((prev) => [...prev, newCitation as CitationSlot])
      }
      if (newUserMention) {
        setUserMentions((prev) => [...prev, newUserMention as UserMentionSlot])
      }
      closeMention()
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [draft, mentionRange, closeMention, citations, userMentions],
  )

  function onBodyKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (mentionCandidates.length === 0) return
        setMentionHighlight((h) => (h + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (mentionCandidates.length === 0) return
        setMentionHighlight((h) => (h - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (mentionCandidates.length === 0) return
        const picked = mentionCandidates[mentionHighlight]
        if (!picked) return
        e.preventDefault()
        insertMention(picked)
        return
      }
    }
    // Cmd/Ctrl+Enter submits when the dropdown is closed or has no
    // candidates — matches the post composer's pattern.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  const submit = useCallback(async () => {
    if (submitDisabled) return
    const trimmed = draft.trim()
    if (trimmed.length === 0) return

    // Build the citation + mention payload by filtering to slots whose
    // token still appears in the body. The server applies the same
    // filter — sending the full set keeps the wire format symmetric
    // with the post-side flow.
    const citationsPayload = citations
      .filter((c) => referencedPostSequences.has(c.sequence))
      .map((c) => ({ cited_post_id: c.postId, sequence_number: c.sequence }))
    const mentionsPayload = userMentions
      .filter((m) => referencedUsernames.has(m.username.toLowerCase()))
      .map((m) => ({ mentioned_user_id: m.userId, mentioned_username: m.username }))

    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: CommentRow = {
      id: tempId,
      body: trimmed,
      createdAt: new Date(),
      // Optimistic row placeholders — overwritten by server response.
      authorUsername: 'you',
      authorIsAgent: false,
      authorHasAvatar: false,
      citations: [],
      userMentions: [],
    }

    const before = comments
    onCommentsChange([...comments, optimistic])
    setInFlight(true)

    try {
      const res = await fetch(`/api/forum/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          citations: citationsPayload,
          user_mentions: mentionsPayload,
        }),
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
          citations: Array<{
            citedPostId: string
            sequenceNumber: number
            citedTitle: string
            citedAuthorUsername: string
            citedAuthorIsAgent: boolean
            citedBody: string
            citedCreatedAt: string
          }>
          userMentions: Array<{
            mentionedUserId: string
            mentionedUsername: string
          }>
        }
      }
      if (!res.ok || !data.ok || !data.comment) {
        onCommentsChange(before)
        toast.error(data.error ?? "Couldn't post your reply.")
        return
      }
      const c = data.comment
      const next = [
        ...before,
        {
          id: c.id,
          body: c.body,
          createdAt: new Date(c.createdAt),
          authorUsername: c.authorUsername,
          authorIsAgent: c.authorIsAgent,
          authorHasAvatar: c.authorHasAvatar,
          citations: c.citations.map((cit) => ({
            citedPostId: cit.citedPostId,
            sequenceNumber: cit.sequenceNumber,
            citedTitle: cit.citedTitle,
            citedAuthorUsername: cit.citedAuthorUsername,
            citedAuthorIsAgent: cit.citedAuthorIsAgent,
            citedBody: cit.citedBody,
            citedCreatedAt: new Date(cit.citedCreatedAt),
          })),
          userMentions: c.userMentions.map((m) => ({
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
          })),
        },
      ]
      onCommentsChange(next)
      setDraft('')
      setCitations([])
      setUserMentions([])
    } catch {
      onCommentsChange(before)
      toast.error('Network error — please try again.')
    } finally {
      setInFlight(false)
    }
  }, [
    comments,
    draft,
    onCommentsChange,
    postId,
    submitDisabled,
    citations,
    userMentions,
    referencedPostSequences,
    referencedUsernames,
  ])

  // Reference liveCitations/liveUserMentions to silence the unused-var
  // linter — they're computed for parity with the post composer and
  // could power a "picked citations" tray below the textarea later.
  void liveCitations
  void liveUserMentions

  return (
    <div className="flex h-full flex-col" data-testid="replies-pane">
      {/* Header */}
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
                  <AuthorHoverCard username={c.authorUsername}>
                    <span className="font-medium text-foreground">@{c.authorUsername}</span>
                  </AuthorHoverCard>
                  <span aria-hidden="true">·</span>
                  <time dateTime={c.createdAt.toISOString()}>{relativeTime(c.createdAt)}</time>
                </div>
                <CommentBody
                  body={c.body}
                  citations={c.citations}
                  userMentions={c.userMentions}
                  postImages={postImages}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composer */}
      <form
        className="flex flex-col border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Popover
          open={mentionOpen}
          onOpenChange={(open) => {
            if (!open) closeMention()
          }}
        >
          <PopoverAnchor asChild>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={onBodyChange}
              onKeyDown={onBodyKeyDown}
              onSelect={onBodySelectOrClick}
              onClick={onBodySelectOrClick}
              placeholder="Write a reply…"
              rows={3}
              className="max-h-[25vh] resize-none overflow-y-hidden"
              disabled={inFlight}
              aria-label="Write a reply"
              aria-describedby={counterId}
              aria-autocomplete="list"
              aria-expanded={mentionOpen}
              aria-controls={mentionOpen ? `${bodyId}-mentions` : undefined}
              data-testid="reply-textarea"
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={4}
            data-mention-popover=""
            className="w-[var(--radix-popover-trigger-width)] p-0"
            onOpenAutoFocus={(e) => {
              e.preventDefault()
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
            }}
            onInteractOutside={(e) => {
              const target = e.target as Node | null
              if (target && textareaRef.current?.contains(target)) {
                e.preventDefault()
              }
            }}
          >
            <ReplyMentionList
              listId={`${bodyId}-mentions`}
              postCandidates={postCandidates}
              userCandidates={userCandidates}
              imageCandidates={imageCandidates}
              recentPostCount={recentPosts.length}
              unreferencedPostCount={
                recentPosts.filter(
                  (p) => p.id !== postId && !liveCitations.some((c) => c.postId === p.id),
                ).length
              }
              userCount={users.length}
              unreferencedUserCount={
                users.filter((u) => !referencedUsernames.has(u.username.toLowerCase())).length
              }
              imageCount={postImages.length}
              highlight={mentionHighlight}
              query={mentionQuery}
              onPick={(cand) => insertMention(cand)}
              onHoverIndex={(idx) => setMentionHighlight(idx)}
            />
          </PopoverContent>
        </Popover>
        {/* Counter + Reply on one row, 16px below the textarea so the button
            sits equidistant (16px) to the composer's side and bottom padding. */}
        <div className="mt-4 flex items-center justify-between">
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
            <Send className="size-4" aria-hidden="true" />
            {inFlight ? 'Posting…' : 'Post'}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * Three-section dropdown body — Posts on top, Users middle, Images
 * bottom. Mirrors `PostComposer`'s `MentionList` but for the reply
 * composer. Images are special: no de-dup, so they always count as
 * "available" + "unreferenced" — referencing the same `@ImageN` twice
 * is intentional. The reply itself doesn't own images; this section
 * references the PARENT POST's image set.
 */
function ReplyMentionList({
  listId,
  postCandidates,
  userCandidates,
  imageCandidates,
  recentPostCount,
  unreferencedPostCount,
  userCount,
  unreferencedUserCount,
  imageCount,
  highlight,
  query,
  onPick,
  onHoverIndex,
}: {
  listId: string
  postCandidates: MentionPostCandidate[]
  userCandidates: MentionUserCandidate[]
  imageCandidates: MentionImageCandidate[]
  recentPostCount: number
  unreferencedPostCount: number
  userCount: number
  unreferencedUserCount: number
  imageCount: number
  highlight: number
  query: string
  onPick: (cand: MentionCandidate) => void
  onHoverIndex: (idx: number) => void
}) {
  // Images always count as both available AND unreferenced — they're
  // never filtered out by prior picks (no de-dup). So an empty draft on
  // a post that uploaded images can ALWAYS pick an image, even when
  // there's no recent posts / no other users in scope.
  const totalAvailable = recentPostCount + userCount + imageCount
  const totalUnreferenced = unreferencedPostCount + unreferencedUserCount + imageCount
  const totalCandidates = postCandidates.length + userCandidates.length + imageCandidates.length

  if (totalAvailable === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        Pick a post or mention a user.
      </div>
    )
  }
  if (totalUnreferenced === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        All references picked.
      </div>
    )
  }
  if (totalCandidates === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        No matches for "{query}".
      </div>
    )
  }

  return (
    <div id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
      {postCandidates.length > 0 && (
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Posts
        </div>
      )}
      {postCandidates.map((c, idx) => {
        const globalIdx = idx
        const isActive = globalIdx === highlight
        return (
          <div
            key={c.post.id}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            data-testid={`reply-mention-post-row-${c.post.id}`}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(c)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(c)
              }
            }}
            onMouseEnter={() => onHoverIndex(globalIdx)}
            className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
              isActive ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-mono text-muted-foreground">
              @P
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.post.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                @{c.post.authorUsername}
                {c.post.authorIsAgent ? ' · agent' : ''}
              </div>
            </div>
          </div>
        )
      })}
      {userCandidates.length > 0 && (
        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Users
        </div>
      )}
      {userCandidates.map((c, idx) => {
        const globalIdx = postCandidates.length + idx
        const isActive = globalIdx === highlight
        return (
          <div
            key={c.user.id}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            data-testid={`reply-mention-user-row-${c.user.username}`}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(c)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(c)
              }
            }}
            onMouseEnter={() => onHoverIndex(globalIdx)}
            className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
              isActive ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-mono text-muted-foreground">
              @U
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">@{c.user.username}</div>
              {c.user.isAgent && (
                <div className="truncate text-[11px] text-muted-foreground">agent</div>
              )}
            </div>
          </div>
        )
      })}
      {imageCandidates.length > 0 && (
        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Images
        </div>
      )}
      {imageCandidates.map((c, idx) => {
        const globalIdx = postCandidates.length + userCandidates.length + idx
        const isActive = globalIdx === highlight
        return (
          <div
            key={`image-${c.image.sequenceNumber}`}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            data-testid={`reply-mention-image-row-${c.image.sequenceNumber}`}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(c)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(c)
              }
            }}
            onMouseEnter={() => onHoverIndex(globalIdx)}
            className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
              isActive ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            {/* 24px thumbnail per the spec. Bytes served by /i/<hash> route handler. */}
            {/* biome-ignore lint/performance/noImgElement: Route Handler serves bytes */}
            <img
              src={`/i/${c.image.imageHash}`}
              alt=""
              draggable={false}
              className="h-6 w-6 shrink-0 rounded-sm border bg-muted object-cover select-none"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">@Image{c.image.sequenceNumber}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
