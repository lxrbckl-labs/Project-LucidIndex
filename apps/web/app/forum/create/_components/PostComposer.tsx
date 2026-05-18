'use client'

/**
 * PostComposer — client component owning the /forum/create UI.
 *
 * One form, four sections (title → body → topics → images), submit at
 * the bottom. All four configurable limits arrive from the RSC parent
 * as `limits`; the available topic_badges arrive as `topicBadges`. The
 * composer reads those once and never re-fetches.
 *
 * Image upload flow:
 *   - Each picked file (via picker / drag-drop / paste) POSTs to
 *     `/api/forum/upload-image` through one shared helper.
 *   - While in flight an "Uploading…" placeholder card holds the slot.
 *   - On success the slot becomes a real card with the server hash +
 *     `@ImageN` label + remove (X).
 *   - The `@ImageN` label is purely positional — it's the row's index
 *     in the current `images` array + 1. Removing a slot renumbers
 *     subsequent labels VISUALLY (no body-text rewrite — that would
 *     be presumptuous), and a small warning surfaces under the body
 *     reminding the author to update their `@ImageN` references.
 *
 * Submit gating:
 *   - Disabled when title is empty / over cap.
 *   - Disabled when body is empty / over cap.
 *   - Disabled when topics count is over cap (the picker also blocks
 *     selection past the cap, so this is belt-and-suspenders).
 *   - Disabled while any image upload is still in flight, or the post
 *     POST itself is in flight.
 *
 * Drafts:
 *   - Manual "Save Draft" button still flushes on click (toasts).
 *   - Debounced auto-save fires ~2.5s after the last edit to any draft-
 *     persisted field. Status indicator near the buttons surfaces
 *     "Saved Xs ago" / "Saving…" / "Unsaved changes". Auto-save
 *     suppresses the toast — the status is the feedback.
 *
 * Keyboard shortcuts (form-scoped, Mac-Cmd or Ctrl):
 *   - `Cmd/Ctrl+Enter` posts (if `canSubmit`)
 *   - `Cmd/Ctrl+S` saves the draft (if not already saving/uploading)
 *
 * Body drag-and-drop and paste:
 *   - Dropping image file(s) on the body textarea uploads them and
 *     inserts `@ImageN` at the caret.
 *   - Pasting an image (Cmd+V from clipboard) does the same.
 *   - Both routes share the picker's upload pipeline.
 *
 * Mention dropdown (`@`-trigger in the body) has three sections:
 *   - Images — pick `@ImageN` for one of the uploaded images
 *   - Posts  — cite another forum post (inserts `@PostN`)
 *   - Users  — mention a forum user (inserts `@<username>`)
 */

import { Check, ChevronsUpDown, ImagePlus, Loader2, Save, Send, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type ChangeEvent,
  type FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

export type PostComposerLimits = {
  maxTitleChars: number
  maxBodyChars: number
  maxTopicsPerPost: number
  maxImagesPerPost: number
}

export type TopicBadgeOption = {
  id: string
  name: string
}

/**
 * One row in the citation `@`-dropdown's Posts section. Sourced from the
 * top-200-most-recent-posts list the RSC parent loads at page render.
 */
export type PostOption = {
  id: string
  title: string
  authorUsername: string
  authorIsAgent: boolean
  /** ISO string from the server. We don't render the timestamp in the
   * dropdown today but keep it on the shape for future "recent posts"
   * sorting tweaks. */
  createdAt: string
}

/**
 * One row in the mention dropdown's Users section. Sourced from the
 * top-200-most-recent forum users (excluding the current author).
 */
export type UserOption = {
  id: string
  username: string
  isAgent: boolean
}

/**
 * Initial citation hydrated from a draft on `/forum/create?draft=<id>`.
 * Each entry carries the `@PostN` slot the draft assigned plus the
 * cited post's title + author username (resolved server-side so the
 * dropdown can render labels without a second round-trip).
 */
export type InitialCitation = {
  citedPostId: string
  sequenceNumber: number
  postTitle: string
  authorUsername: string
}

/**
 * Initial user mention hydrated from a draft. Carries the live username
 * (preferred over the persisted snapshot at hydrate time) plus the
 * `isAgent` flag so the dropdown badge renders consistently.
 */
export type InitialUserMention = {
  mentionedUserId: string
  mentionedUsername: string
  isAgent: boolean
}

/**
 * Shape used to hydrate the composer when it opens on
 * `/forum/create?draft=<id>`. Server-side the parent RSC fetches the
 * draft via `getDraftForUser` and forwards it here verbatim.
 */
export type PostComposerInitialDraft = {
  id: string
  title: string
  body: string
  topicBadgeIds: string[]
  images: Array<{ hash: string; mime: string }>
  citations: InitialCitation[]
  userMentions: InitialUserMention[]
}

/**
 * Shape used to hydrate the composer when it opens on
 * `/forum/posts/<id>/edit`. Same as `PostComposerInitialDraft` but
 * `id` is the post id (not a draft id) and the composer enters
 * "edit mode": Save Draft hidden, auto-save disabled, the Post button
 * becomes "Save changes" and PATCHes `/api/forum/posts/<id>` instead
 * of POSTing /api/forum/posts.
 */
export type PostComposerInitialPost = {
  id: string
  title: string
  body: string
  topicBadgeIds: string[]
  images: Array<{ hash: string; mime: string }>
  citations: InitialCitation[]
  userMentions: InitialUserMention[]
}

type ImageSlot =
  | { state: 'uploading'; localId: string; previewUrl: string }
  | { state: 'ready'; localId: string; hash: string; mime: string; previewUrl: string | null }
  | { state: 'error'; localId: string; error: string }

/**
 * One picked citation. Each slot carries the explicit `@PostN` sequence
 * number assigned at pick time — unlike images, citations need to
 * preserve their N across draft hydrate/save round-trips so body
 * references stay valid even if intermediate citations have been
 * dropped from the body (and thus from the persisted draft set). At
 * submit time the route handler filters out citations whose token
 * isn't present in the body, so the final stored set is exactly the
 * citations the author is currently referencing.
 *
 * The next slot's sequence number is computed as `max(existing) + 1`,
 * never reusing the slot of a removed citation — same posture as
 * images (no auto-renumber on remove).
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
 * One picked user mention. No sequence number — usernames are unique
 * and stable enough to address the slot directly. The body's literal
 * `@<username>` token round-trips with the slot at submit time; if
 * the user removes the token from the body, the slot is filtered out
 * server-side (same posture as citations).
 */
type UserMentionSlot = {
  localId: string
  userId: string
  username: string
  isAgent: boolean
}

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif'
const AUTO_SAVE_DEBOUNCE_MS = 2500
const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

let SLOT_COUNTER = 0
function nextSlotId() {
  SLOT_COUNTER += 1
  return `slot-${SLOT_COUNTER}-${Date.now().toString(36)}`
}

/**
 * Detect an active `@<query>` mention range ending at the caret.
 *
 * Walks backward from the caret. Returns the range only if:
 *   - we find an `@` before hitting whitespace or the beginning of body
 *   - the `@` itself is at a word boundary (preceded by whitespace, or it
 *     sits at the very start of the body)
 *   - the chars between `@` and the caret are all word-like (no spaces,
 *     newlines, or other token-breaking punctuation)
 *
 * `start` points at the `@`. `end` is the caret position. `query` is the
 * substring between them (excluding the `@`).
 */
function getActiveMention(
  body: string,
  caretPos: number,
): { start: number; end: number; query: string } | null {
  // Walk back from caretPos-1 looking for '@'. Stop on whitespace.
  // charAt returns '' for out-of-range, which never matches '@' or \s,
  // so the loop naturally terminates without a separate undefined check.
  let i = caretPos - 1
  while (i >= 0) {
    const ch = body.charAt(i)
    if (ch === '@') {
      // Word boundary before '@': either start-of-body, or whitespace.
      if (i === 0) {
        return { start: i, end: caretPos, query: body.slice(i + 1, caretPos) }
      }
      const prev = body.charAt(i - 1)
      if (/\s/.test(prev)) {
        return { start: i, end: caretPos, query: body.slice(i + 1, caretPos) }
      }
      return null
    }
    // Any whitespace or newline ends the search — no active mention.
    if (/\s/.test(ch)) return null
    i -= 1
  }
  return null
}

type Props = {
  limits: PostComposerLimits
  topicBadges: TopicBadgeOption[]
  /**
   * Recent posts available as citation targets. The RSC parent loads
   * the top-200-most-recent rows; the composer filters by title
   * substring client-side. If/when the forum scales beyond a few
   * hundred posts, a search endpoint replaces this — out of scope
   * for v1.
   */
  recentPosts: PostOption[]
  /**
   * Forum users available as mention targets. The RSC parent loads the
   * top-200 by `created_at DESC`, excluding the current authoring user.
   * Composer filters by username substring client-side.
   */
  users: UserOption[]
  /**
   * Optional draft to hydrate from. When set, the composer renders with
   * the draft's fields pre-populated and subsequent "Save draft" clicks
   * PATCH this draft id instead of creating a new row. Null/undefined
   * means a blank composer that POSTs on first save.
   */
  initialDraft?: PostComposerInitialDraft | null
  /**
   * Optional published post to edit. Mutually exclusive with
   * `initialDraft` — when both are present, `initialPost` wins and
   * the composer enters edit mode (no draft surface, no auto-save,
   * Save changes button PATCHes /api/forum/posts/<id>).
   */
  initialPost?: PostComposerInitialPost | null
}

export function PostComposer({
  limits,
  topicBadges,
  recentPosts,
  users,
  initialDraft = null,
  initialPost = null,
}: Props) {
  // Edit mode wins over draft mode when both are passed — `initialPost`
  // is the post being edited; `initialDraft` is irrelevant once we're
  // editing the published row.
  const editing = initialPost !== null
  // Pick the hydration source: edit mode uses `initialPost`, otherwise
  // we fall back to the existing draft hydration path. Renaming via
  // `const initialDraft = ...` would shadow the prop; using a separate
  // local keeps the diff small.
  const initialSource = initialPost ?? initialDraft
  const router = useRouter()
  const titleId = useId()
  const bodyId = useId()
  const topicsTriggerId = useId()

  // Hydrate the image grid from the source's images so the user picks
  // up exactly where they left off (draft hydrate) or starts from the
  // post's current state (edit hydrate). The previewUrl is null because
  // the bytes live on the server (served via /i/<hash>) — the grid
  // renders those images via the same `<img src={/i/${hash}}>` path it
  // uses for freshly-uploaded slots.
  const initialImages: ImageSlot[] = initialSource
    ? initialSource.images.map((img) => ({
        state: 'ready',
        localId: nextSlotId(),
        hash: img.hash,
        mime: img.mime,
        previewUrl: null,
      }))
    : []

  // Hydrate the citation list from the source. Drafts persist the exact
  // sequence number each `@PostN` token claims; the edit path pulls the
  // same shape from `forum_post_citations`. We enrich each entry with
  // its author's is_agent flag by looking it up in the recent-posts
  // list — that flag isn't on the persisted citation row, just the
  // dropdown source.
  const initialCitations: CitationSlot[] = initialSource
    ? initialSource.citations.map((c) => {
        const recent = recentPosts.find((p) => p.id === c.citedPostId)
        return {
          localId: nextSlotId(),
          postId: c.citedPostId,
          postTitle: c.postTitle,
          authorUsername: c.authorUsername,
          authorIsAgent: recent?.authorIsAgent ?? false,
          sequence: c.sequenceNumber,
        }
      })
    : []

  // Hydrate user mentions from the source.
  const initialUserMentions: UserMentionSlot[] = initialSource
    ? initialSource.userMentions.map((m) => ({
        localId: nextSlotId(),
        userId: m.mentionedUserId,
        username: m.mentionedUsername,
        isAgent: m.isAgent,
      }))
    : []

  const [title, setTitle] = useState(initialSource?.title ?? '')
  const [body, setBody] = useState(initialSource?.body ?? '')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(
    initialSource?.topicBadgeIds ?? [],
  )
  const [topicPickerOpen, setTopicPickerOpen] = useState(false)
  const [images, setImages] = useState<ImageSlot[]>(initialImages)
  const [citations, setCitations] = useState<CitationSlot[]>(initialCitations)
  const [userMentions, setUserMentions] = useState<UserMentionSlot[]>(initialUserMentions)
  const [imageRemovedWarning, setImageRemovedWarning] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Tracks the server-side draft row this composer is bound to. `null`
  // means "no row yet, first save creates one". After a successful
  // POST /api/forum/drafts we capture the new id here AND push the URL
  // to `?draft=<id>` via router.replace so reloads survive.
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null)
  const [savingDraft, setSavingDraft] = useState(false)
  // Auto-save status surface. `lastSavedAt` is the wall-clock at the
  // moment the most recent successful save (manual or auto) completed.
  // `dirty` flips true on any draft-persisted state change and back to
  // false once a save lands.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialDraft ? Date.now() : null)
  const [dirty, setDirty] = useState(false)
  // Drives the "Saved Xs ago" label refresh; one ticker per composer.
  const [, setTickCounter] = useState(0)
  // True while the body textarea is in a drag-over state (visual ring).
  const [bodyDragActive, setBodyDragActive] = useState(false)

  // @-mention dropdown state
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionHighlight, setMentionHighlight] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirror of the latest values for the auto-save scheduler — the
  // debounced timer callback reads from these refs so a long delay
  // doesn't capture stale state.
  const latestStateRef = useRef({
    title,
    body,
    selectedTopicIds,
    images,
    citations,
    userMentions,
  })

  const titleOver = title.length > limits.maxTitleChars
  const bodyOver = body.length > limits.maxBodyChars
  const topicsOver = selectedTopicIds.length > limits.maxTopicsPerPost
  const hasInFlightUpload = images.some((s) => s.state === 'uploading')

  const readyImages = useMemo(
    () => images.filter((s): s is Extract<ImageSlot, { state: 'ready' }> => s.state === 'ready'),
    [images],
  )

  // Sequence numbers (@Image<N>) already referenced in the body. The
  // dropdown filters these out so each image gets cited at most once via
  // the picker. Users can still type duplicates manually — by design.
  const referencedSequences = useMemo(() => {
    const set = new Set<number>()
    const re = /@Image(\d+)\b/g
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
    while ((m = re.exec(body)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n)) set.add(n)
    }
    return set
  }, [body])

  // Same parsing pass for @PostN tokens. Drives the "live" citation
  // set (citations whose `@PostN` token still appears in the body)
  // and feeds the submit-time filter so deleted-but-not-removed
  // citations don't land in the post.
  const referencedPostSequences = useMemo(() => {
    const set = new Set<number>()
    const re = /@Post(\d+)\b/g
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
    while ((m = re.exec(body)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n)) set.add(n)
    }
    return set
  }, [body])

  // Usernames currently referenced in the body via `@<username>` tokens.
  // Lower-cased (the schema's usernames are already lowercase, but we
  // normalize defensively). The dropdown filters out users already
  // mentioned; submit/save filter to "live" mentions whose token still
  // appears in the body.
  const referencedUsernames = useMemo(() => {
    const set = new Set<string>()
    const re = /@([a-z][a-z0-9_-]{2,19})\b/g
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
    while ((m = re.exec(body)) !== null) {
      const u = m[1]
      if (u) set.add(u.toLowerCase())
    }
    return set
  }, [body])

  /**
   * The author's "live" citation list: every picked citation whose
   * `@PostN` token still appears in the body. This is the set we
   * persist on draft saves and submit on post create — the dropdown
   * also uses it to filter out already-cited posts.
   */
  const liveCitations = useMemo(
    () => citations.filter((c) => referencedPostSequences.has(c.sequence)),
    [citations, referencedPostSequences],
  )

  /**
   * Author's "live" user mention list: picked mentions whose
   * `@<username>` token still appears in the body. Same lifecycle
   * policy as citations.
   */
  const liveUserMentions = useMemo(
    () => userMentions.filter((m) => referencedUsernames.has(m.username.toLowerCase())),
    [userMentions, referencedUsernames],
  )

  // Every ready image with its sequence label, then the subset that's
  // selectable in the dropdown (not yet referenced + matches the query).
  const readyImageOptions = useMemo(() => {
    // images.map preserves position; readyImages.indexOf gives index among
    // ready slots only. The label sequence is positional across ALL images
    // (matching the visible @ImageN tag in the grid).
    return images
      .map((slot, idx) => ({ slot, sequence: idx + 1 }))
      .filter(
        (entry): entry is { slot: Extract<ImageSlot, { state: 'ready' }>; sequence: number } =>
          entry.slot.state === 'ready',
      )
  }, [images])

  const imageCandidates = useMemo<MentionImageCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    return readyImageOptions
      .filter(({ sequence }) => !referencedSequences.has(sequence))
      .filter(({ sequence }) => {
        if (!q) return true
        return `image${sequence}`.includes(q)
      })
      .map(({ slot, sequence }) => ({ kind: 'image' as const, slot, sequence }))
  }, [readyImageOptions, referencedSequences, mentionQuery])

  /**
   * Post candidates for the dropdown's Posts section. A post is a
   * candidate iff:
   *   - it isn't already in the live citation set (post can be cited
   *     at most once per post)
   *   - its title contains the query substring (case-insensitive); an
   *     empty query passes everything through
   *
   * The set isn't pre-sorted by anything except the server-side
   * "most recent first" the RSC already applied.
   */
  const postCandidates = useMemo<MentionPostCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    const citedIds = new Set(liveCitations.map((c) => c.postId))
    return recentPosts
      .filter((p) => !citedIds.has(p.id))
      .filter((p) => (q ? p.title.toLowerCase().includes(q) : true))
      .map((p) => ({ kind: 'post' as const, post: p }))
  }, [recentPosts, liveCitations, mentionQuery])

  /**
   * User candidates for the dropdown's Users section. A user is a
   * candidate iff:
   *   - their `@<username>` token isn't already in the body
   *   - their username contains the query substring (case-insensitive)
   */
  const userCandidates = useMemo<MentionUserCandidate[]>(() => {
    const q = mentionQuery.toLowerCase()
    return users
      .filter((u) => !referencedUsernames.has(u.username.toLowerCase()))
      .filter((u) => (q ? u.username.toLowerCase().includes(q) : true))
      .map((u) => ({ kind: 'user' as const, user: u }))
  }, [users, referencedUsernames, mentionQuery])

  /**
   * Flat list of every candidate row in render order — used to map
   * the global highlight index back to a specific candidate. Image
   * rows come first, then post rows, then user rows.
   */
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () => [...imageCandidates, ...postCandidates, ...userCandidates],
    [imageCandidates, postCandidates, userCandidates],
  )

  // Clamp highlight when the candidate list shrinks.
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

  /**
   * Read the textarea's current selection + body and refresh mention
   * state. Called after any change (keystroke, click, paste, programmatic).
   */
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
    setBody(nextBody)
    const caret = e.target.selectionStart ?? nextBody.length
    refreshMentionState(nextBody, caret)
  }

  function onBodySelectOrClick() {
    const el = bodyRef.current
    if (!el) return
    refreshMentionState(el.value, el.selectionStart ?? el.value.length)
  }

  /**
   * Insert the selected mention token over the active range, move caret
   * to immediately after the inserted token, close dropdown.
   *
   * If the char following the mention range isn't already whitespace, we
   * append a trailing space and place the caret after it. This is both a
   * usability win (the user keeps typing the next word) and the
   * load-bearing piece that prevents `getActiveMention` from re-detecting
   * the just-inserted token as an "active mention" the moment the
   * `onSelect` handler fires after the caret move — without the space,
   * the dropdown would immediately reopen filtered to "Image<N>" or
   * "Post<N>" / `<username>`.
   *
   * Image candidates carry their existing sequence number; post
   * candidates get the next-unused @PostN slot computed off the current
   * citations array; user candidates use the literal `@<username>`.
   */
  const insertMention = useCallback(
    (cand: MentionCandidate) => {
      if (!mentionRange) return
      let baseToken: string
      let newCitation: CitationSlot | null = null
      let newUserMention: UserMentionSlot | null = null
      if (cand.kind === 'image') {
        baseToken = `@Image${cand.sequence}`
      } else if (cand.kind === 'post') {
        // Next unused @PostN = (max existing sequence) + 1, falling back
        // to 1 for an empty citation list. We compute against the full
        // `citations` array (not `liveCitations`) so deleted-from-body
        // slots stay "burned" — re-citing the same post later still gets
        // a fresh slot.
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
      } else {
        baseToken = `@${cand.user.username}`
        // Only add to the userMentions array if this user isn't already
        // tracked. Re-picking after a body-delete is fine — the array
        // serves as a "user picked this" log; the live filter at submit
        // time is what actually persists.
        const already = userMentions.some((m) => m.userId === cand.user.id)
        if (!already) {
          newUserMention = {
            localId: nextSlotId(),
            userId: cand.user.id,
            username: cand.user.username,
            isAgent: cand.user.isAgent,
          }
        }
      }
      const before = body.slice(0, mentionRange.start)
      const after = body.slice(mentionRange.end)
      const needsSpace = after.length === 0 || !/^\s/.test(after)
      const token = needsSpace ? `${baseToken} ` : baseToken
      const nextBody = before + token + after
      const nextCaret = before.length + token.length
      setBody(nextBody)
      if (newCitation) {
        setCitations((prev) => [...prev, newCitation as CitationSlot])
      }
      if (newUserMention) {
        setUserMentions((prev) => [...prev, newUserMention as UserMentionSlot])
      }
      closeMention()
      requestAnimationFrame(() => {
        const el = bodyRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [body, mentionRange, closeMention, citations, userMentions],
  )

  function onBodyKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionOpen) return
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
    if (e.key === 'Enter') {
      // Only intercept if there's a candidate to pick. Otherwise let the
      // user keep typing (e.g. pressing Enter to dismiss a "no match" list
      // and continue their thought).
      if (mentionCandidates.length === 0) return
      const picked = mentionCandidates[mentionHighlight]
      if (!picked) return
      e.preventDefault()
      insertMention(picked)
      return
    }
    if (e.key === 'Tab') {
      // Tab also commits, since it's the muscle-memory completion key.
      if (mentionCandidates.length === 0) return
      const picked = mentionCandidates[mentionHighlight]
      if (!picked) return
      e.preventDefault()
      insertMention(picked)
    }
  }

  const canSubmit =
    !submitting &&
    !hasInFlightUpload &&
    title.trim().length > 0 &&
    !titleOver &&
    body.trim().length > 0 &&
    !bodyOver &&
    !topicsOver

  const topicById = useMemo(() => {
    const m = new Map<string, TopicBadgeOption>()
    for (const t of topicBadges) m.set(t.id, t)
    return m
  }, [topicBadges])

  const selectedTopics = selectedTopicIds
    .map((id) => topicById.get(id))
    .filter((t): t is TopicBadgeOption => Boolean(t))

  function toggleTopic(id: string) {
    setSelectedTopicIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= limits.maxTopicsPerPost) {
        toast.error(`You can pick at most ${limits.maxTopicsPerPost} topics.`)
        return prev
      }
      return [...prev, id]
    })
  }

  function removeTopic(id: string) {
    setSelectedTopicIds((prev) => prev.filter((x) => x !== id))
  }

  /**
   * Shared upload pipeline. Picker / drop / paste all funnel here.
   *
   * Returns the inserted server hash on success (so the caller can
   * decide whether to insert `@ImageN` at the caret) or null on
   * failure (the toast is already raised inside).
   *
   * `onProgress.localId` is the slot id created by the caller; we
   * mutate that slot in place from `uploading` → `ready` / `error`.
   */
  async function uploadOne(file: File, localId: string): Promise<{ hash: string } | null> {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/forum/upload-image', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        hash?: string
        mime?: string
        reason?: string
      }
      if (!res.ok || !data.ok || !data.hash || !data.mime) {
        const reason = data.reason ?? 'upload_failed'
        const msg =
          reason === 'too_large'
            ? 'Image is over the 10 MB limit.'
            : reason === 'invalid_type'
              ? 'Only PNG, JPEG, WebP, or GIF are accepted.'
              : reason === 'unauthorized'
                ? 'Your session expired. Please sign in again.'
                : "Couldn't upload that image."
        setImages((prev) =>
          prev.map((s) => (s.localId === localId ? { state: 'error', localId, error: msg } : s)),
        )
        toast.error(msg)
        return null
      }
      setImages((prev) =>
        prev.map((s) => {
          if (s.localId !== localId) return s
          const preview = s.state === 'uploading' ? s.previewUrl : null
          return {
            state: 'ready',
            localId,
            hash: data.hash as string,
            mime: data.mime as string,
            previewUrl: preview,
          }
        }),
      )
      return { hash: data.hash }
    } catch {
      const msg = 'Network error while uploading.'
      setImages((prev) =>
        prev.map((s) => (s.localId === localId ? { state: 'error', localId, error: msg } : s)),
      )
      toast.error(msg)
      return null
    }
  }

  /**
   * Filter incoming files down to (accepted, rejected) based on MIME
   * and the remaining image cap. Surfaces a toast per rejection.
   *
   * Returns the accepted slice plus the count actually queued — the
   * caller uses that to know how many `@ImageN` slot ids it should
   * reserve for sequenced insertion.
   */
  function acceptFiles(rawFiles: File[]): { accepted: File[] } {
    const remaining = limits.maxImagesPerPost - images.length
    if (remaining <= 0) {
      toast.error(`Image cap reached — at most ${limits.maxImagesPerPost} per post.`)
      return { accepted: [] }
    }
    const accepted: File[] = []
    for (const file of rawFiles) {
      if (!ALLOWED_MIME.has(file.type)) {
        toast.error(`${file.name || 'file'}: only PNG, JPEG, WebP, or GIF are accepted.`)
        continue
      }
      if (accepted.length >= remaining) {
        toast.error(`Image cap reached — at most ${limits.maxImagesPerPost} per post.`)
        break
      }
      accepted.push(file)
    }
    return { accepted }
  }

  /**
   * Reserve a slot per file (in array order), kick off uploads in
   * parallel, and on success insert `@ImageN` at the current caret
   * for THIS upload. Caret insertion happens sequentially so multi-drop
   * sees `@Image3 @Image4 @Image5` instead of `@Image3@Image3@Image3`.
   *
   * The sequence number IS the eventual ImageN label (images grid is
   * 1-indexed by position), computed from the post-insert images
   * array length so it matches what the UI will render.
   */
  async function queueAndInsert(files: File[]) {
    const { accepted } = acceptFiles(files)
    if (accepted.length === 0) return

    // Compute the sequence numbers the new slots will land at. They
    // depend on the current images array length at queue time —
    // multi-drop is sequenced so the first dropped file becomes
    // (images.length + 1), the second (images.length + 2), etc.
    let baseIndex = images.length
    const slotIds: string[] = []
    const previews: string[] = []
    setImages((prev) => {
      let next = prev
      baseIndex = prev.length
      for (const file of accepted) {
        const localId = nextSlotId()
        const previewUrl = URL.createObjectURL(file)
        slotIds.push(localId)
        previews.push(previewUrl)
        next = [...next, { state: 'uploading', localId, previewUrl }]
      }
      return next
    })

    for (let i = 0; i < accepted.length; i += 1) {
      const file = accepted[i] as File
      const localId = slotIds[i] as string
      const sequence = baseIndex + i + 1
      const result = await uploadOne(file, localId)
      if (!result) continue
      insertTokenAtCaret(`@Image${sequence}`)
    }
  }

  /**
   * Insert a bare token (e.g. `@Image3`) at the textarea's current caret,
   * appending a trailing space if needed. Mirrors the `insertMention`
   * trailing-space behavior so the dropdown doesn't pop right back open.
   */
  function insertTokenAtCaret(token: string) {
    const el = bodyRef.current
    if (!el) {
      // Fallback: append to body if no ref yet.
      setBody((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${token} `)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const before = body.slice(0, start)
    const after = body.slice(end)
    const needsSpace = after.length === 0 || !/^\s/.test(after)
    const insertion = needsSpace ? `${token} ` : token
    const nextBody = before + insertion + after
    const nextCaret = before.length + insertion.length
    setBody(nextBody)
    requestAnimationFrame(() => {
      const el2 = bodyRef.current
      if (!el2) return
      el2.focus()
      el2.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files
    if (!picked) return
    void queueAndInsert(Array.from(picked))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeImage(localId: string) {
    setImages((prev) => {
      const target = prev.find((s) => s.localId === localId)
      if (target && 'previewUrl' in target && target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
      }
      const next = prev.filter((s) => s.localId !== localId)
      // Only show the warning when we removed something from the middle
      // (i.e. there were items after this one), because that's when the
      // @ImageN labels shift on screen and any body references go stale.
      const removedIndex = prev.findIndex((s) => s.localId === localId)
      if (removedIndex >= 0 && removedIndex < prev.length - 1) {
        setImageRemovedWarning(true)
      }
      return next
    })
  }

  /**
   * Drag-and-drop handlers for the body wrapper. `onDragOver` MUST
   * preventDefault to enable `onDrop`. We only acknowledge drags
   * carrying files (the standard "Files" data type) so a drag from
   * within the page (e.g. dragging the topic badges) doesn't paint
   * the ring or capture a meaningless drop.
   */
  function isFileDrag(e: ReactDragEvent<HTMLDivElement>): boolean {
    const types = e.dataTransfer?.types
    if (!types) return false
    // types is a DOMStringList in some browsers; use includes via Array.from.
    return Array.from(types).includes('Files')
  }

  function onBodyDragOver(e: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    if (!bodyDragActive) setBodyDragActive(true)
  }

  function onBodyDragLeave(e: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return
    // Only clear the ring when leaving the wrapper itself (not a child).
    if (e.currentTarget === e.target) {
      setBodyDragActive(false)
    }
  }

  function onBodyDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    setBodyDragActive(false)
    const dropped = e.dataTransfer?.files
    if (!dropped || dropped.length === 0) return
    void queueAndInsert(Array.from(dropped))
  }

  /**
   * Clipboard paste — pull image files out of the paste event and
   * funnel them through the same upload+insert pipeline. We only
   * intercept the paste when at least one image item is present; if
   * there's also text in the clipboard, we let the textarea handle
   * the text portion natively (the image path won't `preventDefault`
   * unless an image item is consumed).
   */
  function onBodyPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length === 0) return
    e.preventDefault()
    void queueAndInsert(imageFiles)
  }

  /**
   * Compose the payload sent to /api/forum/drafts. Pure derivation —
   * no I/O. Manual save and auto-save both go through this.
   */
  const buildDraftPayload = useCallback(() => {
    const state = latestStateRef.current
    return {
      title: state.title,
      body: state.body,
      topic_badge_ids: state.selectedTopicIds,
      images: state.images
        .filter((s): s is Extract<ImageSlot, { state: 'ready' }> => s.state === 'ready')
        .map((img) => ({ hash: img.hash, mime: img.mime })),
      // Persist only the citations actually referenced in the body —
      // matches the policy applied at submit time so the draft round-
      // trip is symmetric with the eventual post create. We pass the
      // explicit sequence_number (not idx+1) so reload of the draft
      // restores the same `@PostN` mapping the body refers to.
      citations: state.citations
        .filter((c) => {
          const re = new RegExp(`@Post${c.sequence}\\b`)
          return re.test(state.body)
        })
        .map((c) => ({
          cited_post_id: c.postId,
          sequence_number: c.sequence,
        })),
      // Same lifecycle policy for user mentions — keep only those whose
      // `@<username>` token still appears in the body.
      user_mentions: state.userMentions
        .filter((m) => {
          const escaped = m.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          return new RegExp(`\\B@${escaped}\\b`).test(state.body)
        })
        .map((m) => ({
          mentioned_user_id: m.userId,
          mentioned_username: m.username,
        })),
    }
  }, [])

  // Mirror of the in-flight / blocking flags for performSave. The
  // useCallback for performSave is held stable across renders — without
  // this, including these flags as deps would cause performSave's
  // identity to flip every save, which re-runs the auto-save effect
  // (and re-marks the composer dirty immediately after each successful
  // save). The fetch trigger itself doesn't care which render captured
  // these values, only what they were at call time.
  const saveBlockingRef = useRef({
    savingDraft,
    submitting,
    hasInFlightUpload,
    draftId,
  })
  useEffect(() => {
    saveBlockingRef.current = { savingDraft, submitting, hasInFlightUpload, draftId }
  }, [savingDraft, submitting, hasInFlightUpload, draftId])

  /**
   * Shared save core. `silent: true` suppresses the success toast (used
   * by auto-save); manual save sets `silent: false` and toasts.
   *
   * Returns true on success, false on failure (caller can react to it
   * — auto-save retries on the next tick; manual save surfaces the
   * error in the destructive Alert).
   *
   * The blocking flags + draftId are read through `saveBlockingRef` so
   * this callback can be stable across renders — see the ref's comment
   * for why that matters for the auto-save effect.
   */
  const performSave = useCallback(
    async (silent: boolean): Promise<boolean> => {
      const blocking = saveBlockingRef.current
      if (blocking.savingDraft || blocking.submitting || blocking.hasInFlightUpload) return false
      setSavingDraft(true)
      setSubmitError(null)
      try {
        const payload = buildDraftPayload()
        const currentDraftId = blocking.draftId
        const url = currentDraftId ? `/api/forum/drafts/${currentDraftId}` : '/api/forum/drafts'
        const method = currentDraftId ? 'PATCH' : 'POST'
        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          draft_id?: string
          error?: string
        }
        if (!res.ok || !data.ok) {
          const msg = data.error ?? "Couldn't save the draft."
          if (!silent) setSubmitError(msg)
          return false
        }
        if (!currentDraftId && data.draft_id) {
          setDraftId(data.draft_id)
          router.replace(`/forum/create?draft=${data.draft_id}`, { scroll: false })
        }
        setLastSavedAt(Date.now())
        setDirty(false)
        if (!silent) toast.success('Draft saved.')
        // Refresh the route so the layout's sidebar re-fetches the
        // drafts list with the new/updated row reflected.
        router.refresh()
        return true
      } catch {
        if (!silent) setSubmitError('Network error — please try again.')
        return false
      } finally {
        setSavingDraft(false)
      }
    },
    [router, buildDraftPayload],
  )

  /**
   * Mark dirty + schedule a debounced auto-save. The timer reads from
   * `latestStateRef` so we don't trip the React stale-closure issue
   * with a multi-second delay.
   *
   * A composer that starts blank shouldn't auto-save — there's nothing
   * worth persisting and we'd spam empty drafts. We treat "no draft id,
   * blank everything" as the suppressed case and skip the schedule.
   */
  const isBlank = useCallback(() => {
    const s = latestStateRef.current
    if (s.title.length > 0) return false
    if (s.body.length > 0) return false
    if (s.selectedTopicIds.length > 0) return false
    if (s.images.length > 0) return false
    if (s.citations.length > 0) return false
    if (s.userMentions.length > 0) return false
    return true
  }, [])

  // Keep the latestStateRef synchronized.
  useEffect(() => {
    latestStateRef.current = { title, body, selectedTopicIds, images, citations, userMentions }
  }, [title, body, selectedTopicIds, images, citations, userMentions])

  // Suppress the initial-render effect run so a fresh-loaded composer
  // doesn't flash "Unsaved changes" and schedule a no-op auto-save
  // against the hydrated values. The first user edit flips the ref and
  // the effect starts running normally.
  const autoSaveSkipRef = useRef(true)

  // Auto-save scheduler: re-arm on every relevant state change. The
  // initial render's effect run is what makes "Unsaved changes" first
  // appear after the user types — when nothing has changed yet, we
  // skip and stay idle.
  //
  // Edit mode (`editing === true`) bypasses auto-save entirely — there's
  // no draft row associated with an edit; the "Save changes" button is
  // the only path that hits the server.
  //
  // We deliberately include the state values that should trigger the
  // debounce; performSave + isBlank are stable callbacks. The state
  // values aren't read inside the effect body (they reach performSave
  // through latestStateRef), so biome flags them as "unnecessary" —
  // but they're load-bearing as the trigger. Suppression is the right
  // call here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: title/body/etc are the explicit debounce triggers; performSave reads them via latestStateRef
  useEffect(() => {
    if (editing) return
    if (autoSaveSkipRef.current) {
      autoSaveSkipRef.current = false
      return
    }
    // Don't auto-save when blank and there's no existing draft to PATCH.
    if (isBlank() && !draftId) return
    // Don't schedule while submitting / uploading; we'll re-arm when
    // those flags clear.
    if (submitting || hasInFlightUpload) return

    setDirty(true)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      void performSave(true)
    }, AUTO_SAVE_DEBOUNCE_MS)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [
    title,
    body,
    selectedTopicIds,
    images,
    citations,
    userMentions,
    draftId,
    submitting,
    hasInFlightUpload,
    editing,
    performSave,
    isBlank,
  ])

  // Cheap ticker so "Saved Xs ago" updates without a per-second
  // re-render. Fires every 15s while there's a lastSavedAt value.
  useEffect(() => {
    if (lastSavedAt === null) return
    const interval = setInterval(() => {
      setTickCounter((n) => n + 1)
    }, 15_000)
    return () => clearInterval(interval)
  }, [lastSavedAt])

  /**
   * Form-scoped keyboard shortcuts:
   *   - Cmd/Ctrl+Enter → submit (if canSubmit)
   *   - Cmd/Ctrl+S     → save draft
   *
   * Mac uses `event.metaKey`; everywhere else `event.ctrlKey`. We treat
   * both as "the command modifier" to match the shadcn ecosystem
   * convention.
   */
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    function onKey(ev: KeyboardEvent) {
      const cmd = ev.metaKey || ev.ctrlKey
      if (!cmd) return
      if (ev.key === 'Enter') {
        // Always intercept to prevent the textarea's native newline
        // behavior under Cmd+Enter (some browsers don't bubble through).
        if (canSubmit) {
          ev.preventDefault()
          // Trigger native form submit so onSubmit runs.
          form?.requestSubmit()
        }
        return
      }
    }
    form.addEventListener('keydown', onKey)
    return () => form.removeEventListener('keydown', onKey)
  }, [canSubmit])

  /**
   * Manual save handler bound to the button.
   */
  async function onSaveDraft() {
    await performSave(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload: {
        title: string
        body: string
        topic_badge_ids: string[]
        images: Array<{ hash: string; mime: string }>
        citations: Array<{ cited_post_id: string; sequence_number: number }>
        user_mentions: Array<{ mentioned_user_id: string; mentioned_username: string }>
        draft_id?: string
      } = {
        title: title.trim(),
        body,
        topic_badge_ids: selectedTopicIds,
        images: readyImages.map((img) => ({ hash: img.hash, mime: img.mime })),
        // Same lifecycle policy as drafts: only send citations whose
        // `@PostN` token still appears in the body. The server applies
        // the same filter as a second guard.
        citations: liveCitations.map((c) => ({
          cited_post_id: c.postId,
          sequence_number: c.sequence,
        })),
        user_mentions: liveUserMentions.map((m) => ({
          mentioned_user_id: m.userId,
          mentioned_username: m.username,
        })),
      }
      // Edit-mode path: PATCH /api/forum/posts/<id> and redirect to the
      // post view on success. No draft cleanup (none was created), no
      // post_id in the response (we already have it from `initialPost`).
      if (editing && initialPost) {
        const res = await fetch(`/api/forum/posts/${initialPost.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          reason?: string
          error?: string
        }
        if (!res.ok || !data.ok) {
          const msg = data.error ?? "Couldn't save the changes."
          setSubmitError(msg)
          return
        }
        toast.success('Changes saved.')
        for (const s of images) {
          if ('previewUrl' in s && s.previewUrl) URL.revokeObjectURL(s.previewUrl)
        }
        router.push(`/forum/posts/${initialPost.id}`)
        router.refresh()
        return
      }
      if (draftId) {
        // Server-side cleanup: the POST handler deletes this draft
        // in the same transaction as the post insert.
        payload.draft_id = draftId
      }
      const res = await fetch('/api/forum/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        post_id?: string
        reason?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        const msg = data.error ?? "Couldn't create the post."
        setSubmitError(msg)
        return
      }
      toast.success('Post created.')
      // Reset to a clean composer in case the next page push 404s and
      // the user backs into this page — they shouldn't see stale state.
      for (const s of images) {
        if ('previewUrl' in s && s.previewUrl) URL.revokeObjectURL(s.previewUrl)
      }
      // Redirect to the new post's view page so the user sees what they
      // just published. Fall back to /forum if the API failed to return
      // a post_id for some reason (shouldn't happen — defensive).
      if (data.post_id) {
        router.push(`/forum/posts/${data.post_id}`)
      } else {
        router.push('/forum')
      }
      router.refresh()
    } catch {
      setSubmitError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Status indicator label. Priority:
  //   1. saving in flight → "Saving…"
  //   2. dirty (timer pending) → "Unsaved changes"
  //   3. saved at least once → "Saved Xs ago"
  //   4. nothing yet → no label
  const savedAgoLabel = (() => {
    if (savingDraft) return 'Saving…'
    if (dirty) return 'Unsaved changes'
    if (lastSavedAt === null) return null
    const seconds = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000))
    if (seconds < 5) return 'Saved just now'
    if (seconds < 60) return `Saved ${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes === 1) return 'Saved 1 minute ago'
    return `Saved ${minutes} minutes ago`
  })()

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {submitError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={titleId}>Title</Label>
          <span
            className={`text-xs tabular-nums ${
              titleOver ? 'text-destructive' : 'text-muted-foreground'
            }`}
            aria-live="polite"
          >
            {title.length} / {limits.maxTitleChars}
          </span>
        </div>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A short, scannable headline"
          disabled={submitting}
          aria-invalid={titleOver || undefined}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={bodyId}>Body</Label>
          <span
            className={`text-xs tabular-nums ${
              bodyOver ? 'text-destructive' : 'text-muted-foreground'
            }`}
            aria-live="polite"
          >
            {body.length} / {limits.maxBodyChars}
          </span>
        </div>
        <Popover
          open={mentionOpen}
          onOpenChange={(open) => {
            if (!open) closeMention()
          }}
        >
          <PopoverAnchor asChild>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper handles file drag-and-drop only; the interactive textarea is the child */}
            <div
              className={`relative rounded-md transition-shadow ${
                bodyDragActive ? 'ring-2 ring-primary ring-offset-2' : ''
              }`}
              onDragOver={onBodyDragOver}
              onDragEnter={onBodyDragOver}
              onDragLeave={onBodyDragLeave}
              onDrop={onBodyDrop}
              data-testid="post-body-wrapper"
            >
              <Textarea
                id={bodyId}
                ref={bodyRef}
                value={body}
                onChange={onBodyChange}
                onKeyDown={onBodyKeyDown}
                onSelect={onBodySelectOrClick}
                onClick={onBodySelectOrClick}
                onPaste={onBodyPaste}
                placeholder="What's on your mind?"
                disabled={submitting}
                aria-invalid={bodyOver || undefined}
                aria-autocomplete="list"
                aria-expanded={mentionOpen}
                aria-controls={mentionOpen ? `${bodyId}-mentions` : undefined}
                className="min-h-[18rem] resize-y"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={4}
            data-mention-popover=""
            className="w-[var(--radix-popover-trigger-width)] p-0"
            onOpenAutoFocus={(e) => {
              // Keep focus on the textarea so typing continues to filter
              // the dropdown rather than landing inside the popover.
              e.preventDefault()
            }}
            onCloseAutoFocus={(e) => {
              // Don't yank focus back to anything after close — caller
              // sets focus deliberately (e.g. after insertMention).
              e.preventDefault()
            }}
            onInteractOutside={(e) => {
              // Clicks back into the textarea shouldn't dismiss the
              // dropdown — the textarea's own select/click handlers
              // refresh mention state.
              const target = e.target as Node | null
              if (target && bodyRef.current?.contains(target)) {
                e.preventDefault()
              }
            }}
          >
            <MentionList
              listId={`${bodyId}-mentions`}
              imageCandidates={imageCandidates}
              postCandidates={postCandidates}
              userCandidates={userCandidates}
              readyImageCount={readyImageOptions.length}
              unreferencedImageCount={
                readyImageOptions.filter(({ sequence }) => !referencedSequences.has(sequence))
                  .length
              }
              recentPostCount={recentPosts.length}
              unreferencedPostCount={
                recentPosts.filter((p) => !liveCitations.some((c) => c.postId === p.id)).length
              }
              userCount={users.length}
              unreferencedUserCount={
                users.filter((u) => !referencedUsernames.has(u.username.toLowerCase())).length
              }
              highlight={mentionHighlight}
              query={mentionQuery}
              onPick={(cand) => insertMention(cand)}
              onHoverIndex={(idx) => setMentionHighlight(idx)}
            />
          </PopoverContent>
        </Popover>
        <p className="text-[11px] text-muted-foreground">
          Type <code className="font-mono">@</code> for a picker — reference an uploaded image as{' '}
          <code className="font-mono">@Image1</code>, cite another post as{' '}
          <code className="font-mono">@Post1</code>, or mention a user as{' '}
          <code className="font-mono">@username</code>. Drop or paste images into the body to attach
          them inline.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Supports markdown: <code className="font-mono">**bold**</code>,{' '}
          <code className="font-mono">*italic*</code>, lists, code, links.
        </p>
        {imageRemovedWarning && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Image removed — update any <code className="font-mono">@ImageN</code> references in your
            post if needed.
          </p>
        )}
      </div>

      {/* Topics */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={topicsTriggerId}>Topics</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {selectedTopicIds.length} / {limits.maxTopicsPerPost}
          </span>
        </div>

        {selectedTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedTopics.map((t, idx) => (
              <Badge
                key={t.id}
                variant="secondary"
                className="flex items-center gap-1 pr-1.5 font-normal"
              >
                <span>{t.name}</span>
                <button
                  type="button"
                  onClick={() => removeTopic(t.id)}
                  disabled={submitting}
                  aria-label={`Remove topic ${t.name}`}
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
                {/* index 0 is conceptually the first; key on id+idx so React
                    is happy if the user happens to re-add a removed topic */}
                <span className="sr-only">{idx + 1}</span>
              </Badge>
            ))}
          </div>
        )}

        <Popover open={topicPickerOpen} onOpenChange={setTopicPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              id={topicsTriggerId}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={topicPickerOpen}
              disabled={submitting || topicBadges.length === 0}
              className="w-full justify-between font-normal"
            >
              {topicBadges.length === 0
                ? 'No topics available'
                : selectedTopicIds.length === 0
                  ? 'Add topics…'
                  : `${selectedTopicIds.length} topic${selectedTopicIds.length === 1 ? '' : 's'} selected`}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search topics…" />
              <CommandList className="max-h-64 overflow-y-auto">
                <CommandEmpty>No topic found.</CommandEmpty>
                <CommandGroup>
                  {topicBadges.map((t) => {
                    const checked = selectedTopicIds.includes(t.id)
                    const blocked = !checked && selectedTopicIds.length >= limits.maxTopicsPerPost
                    return (
                      <CommandItem
                        key={t.id}
                        value={t.name}
                        disabled={blocked}
                        onSelect={() => toggleTopic(t.id)}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${checked ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {t.name}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Images */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>Images</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {images.length} / {limits.maxImagesPerPost}
          </span>
        </div>

        <DropZone
          atCap={images.length >= limits.maxImagesPerPost}
          maxImages={limits.maxImagesPerPost}
          disabled={submitting}
          inputRef={fileInputRef}
          onPick={onPickFiles}
        />

        <p className="text-[11px] text-muted-foreground">
          Images not referenced in the body show as a gallery below your published post.
        </p>

        {images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((slot, idx) => {
              const label = `@Image${idx + 1}`
              return (
                <li
                  key={slot.localId}
                  className="relative flex flex-col gap-2 rounded-md border bg-card p-2"
                >
                  {slot.state === 'uploading' && (
                    <>
                      <div className="aspect-square w-full overflow-hidden rounded-sm bg-muted">
                        {/* biome-ignore lint/performance/noImgElement: blob URL */}
                        <img
                          src={slot.previewUrl}
                          alt=""
                          className="h-full w-full object-cover opacity-60"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        <span>Uploading…</span>
                      </div>
                    </>
                  )}
                  {slot.state === 'ready' && (
                    <>
                      <div className="aspect-square w-full overflow-hidden rounded-sm bg-muted">
                        {/* biome-ignore lint/performance/noImgElement: Route Handler serves bytes */}
                        <img
                          src={`/i/${slot.hash}`}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="text-xs">
                        <code className="font-mono text-muted-foreground">{label}</code>
                      </div>
                    </>
                  )}
                  {slot.state === 'error' && (
                    <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-destructive/10 p-3 text-center text-xs text-destructive">
                      {slot.error}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(slot.localId)}
                    disabled={submitting}
                    aria-label="Remove image"
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-sm bg-background/80 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Separator />
      <div className="flex flex-col gap-2">
        <div className={`flex items-center gap-2 ${editing ? 'justify-end' : 'justify-between'}`}>
          {!editing && (
            <Button
              type="button"
              variant="outline"
              onClick={onSaveDraft}
              disabled={savingDraft || submitting || hasInFlightUpload}
            >
              {savingDraft ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {savingDraft ? 'Saving…' : 'Save Draft'}
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit} data-testid="post-submit">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {submitting ? (editing ? 'Saving…' : 'Posting…') : editing ? 'Save changes' : 'Post'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span data-testid="autosave-status" aria-live="polite">
            {editing ? '' : (savedAgoLabel ?? '')}
          </span>
        </div>
      </div>
    </form>
  )
}

function DropZone({
  atCap,
  maxImages,
  disabled,
  inputRef,
  onPick,
}: {
  atCap: boolean
  maxImages: number
  disabled: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  const dropZoneId = useId()

  if (atCap) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
        Maximum {maxImages} image{maxImages === 1 ? '' : 's'} reached.
      </div>
    )
  }

  return (
    <>
      <label
        htmlFor={dropZoneId}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background px-4 py-8 text-center transition-colors hover:bg-muted/40 ${
          disabled ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-foreground">Click to add an image</span>
        <span className="text-[11px] text-muted-foreground">
          PNG, JPEG, WebP, or GIF · up to 10 MB · up to {maxImages} per post
        </span>
      </label>
      <input
        id={dropZoneId}
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        disabled={disabled}
        onChange={onPick}
        className="sr-only"
      />
    </>
  )
}

type MentionImageCandidate = {
  kind: 'image'
  slot: Extract<ImageSlot, { state: 'ready' }>
  sequence: number
}
type MentionPostCandidate = {
  kind: 'post'
  post: PostOption
}
type MentionUserCandidate = {
  kind: 'user'
  user: UserOption
}
type MentionCandidate = MentionImageCandidate | MentionPostCandidate | MentionUserCandidate

function MentionList({
  listId,
  imageCandidates,
  postCandidates,
  userCandidates,
  readyImageCount,
  unreferencedImageCount,
  recentPostCount,
  unreferencedPostCount,
  userCount,
  unreferencedUserCount,
  highlight,
  query,
  onPick,
  onHoverIndex,
}: {
  listId: string
  imageCandidates: MentionImageCandidate[]
  postCandidates: MentionPostCandidate[]
  userCandidates: MentionUserCandidate[]
  readyImageCount: number
  unreferencedImageCount: number
  recentPostCount: number
  unreferencedPostCount: number
  userCount: number
  unreferencedUserCount: number
  highlight: number
  query: string
  onPick: (cand: MentionCandidate) => void
  onHoverIndex: (idx: number) => void
}) {
  // Empty-state priority across three sections:
  //   1. Nothing exists anywhere → "Upload an image, pick a post, or mention a user."
  //   2. Everything that exists is already referenced → "All references picked."
  //   3. Query filtered all sections to nothing → "No matches for "<q>"."
  const totalAvailable = readyImageCount + recentPostCount + userCount
  const totalUnreferenced = unreferencedImageCount + unreferencedPostCount + unreferencedUserCount
  const totalCandidates = imageCandidates.length + postCandidates.length + userCandidates.length

  if (totalAvailable === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        Upload an image, pick a post, or mention a user.
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

  // Render order: image rows, then post rows, then user rows.
  return (
    <div id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
      {imageCandidates.length > 0 && (
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Images
        </div>
      )}
      {imageCandidates.map((c, idx) => {
        const globalIdx = idx
        const label = `@Image${c.sequence}`
        const isActive = globalIdx === highlight
        return (
          <div
            key={c.slot.localId}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            onMouseDown={(e) => {
              // mousedown (not click) so the textarea doesn't lose focus
              // and reposition the caret before we insert.
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
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
              {/* biome-ignore lint/performance/noImgElement: Route Handler serves bytes */}
              <img src={`/i/${c.slot.hash}`} alt="" className="h-full w-full object-cover" />
            </div>
            <code className="font-mono text-xs">{label}</code>
          </div>
        )
      })}
      {postCandidates.length > 0 && (
        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Posts
        </div>
      )}
      {postCandidates.map((c, idx) => {
        const globalIdx = imageCandidates.length + idx
        const isActive = globalIdx === highlight
        return (
          <div
            key={c.post.id}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
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
        const globalIdx = imageCandidates.length + postCandidates.length + idx
        const isActive = globalIdx === highlight
        return (
          <div
            key={c.user.id}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            data-testid={`mention-user-row-${c.user.username}`}
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
    </div>
  )
}

// Suppress an unused-import warning on USERNAME_RE — we keep the constant
// for any future call site (the regex is replicated in
// `getActiveMention`-adjacent code paths). Biome's tree-shaking doesn't
// need the export, but the linter sometimes flags it on a rewrite.
void USERNAME_RE
