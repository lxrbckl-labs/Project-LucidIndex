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
 *   - Each picked file POSTs immediately to `/api/forum/upload-image`.
 *   - While in flight an "Uploading…" placeholder card holds the slot.
 *   - On success the slot becomes a real card with the server hash +
 *     `@ImageN` label + Copy button + remove (X).
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
 * Drafts are NOT persisted across page reloads (out of scope for v1).
 */

import { Check, ChevronsUpDown, ImagePlus, Loader2, Save, Send, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type ChangeEvent,
  type FormEvent,
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
}

type ImageSlot =
  | { state: 'uploading'; localId: string; previewUrl: string }
  | { state: 'ready'; localId: string; hash: string; mime: string; previewUrl: string | null }
  | { state: 'error'; localId: string; error: string }

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif'

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
   * Optional draft to hydrate from. When set, the composer renders with
   * the draft's fields pre-populated and subsequent "Save draft" clicks
   * PATCH this draft id instead of creating a new row. Null/undefined
   * means a blank composer that POSTs on first save.
   */
  initialDraft?: PostComposerInitialDraft | null
}

export function PostComposer({ limits, topicBadges, initialDraft = null }: Props) {
  const router = useRouter()
  const titleId = useId()
  const bodyId = useId()
  const topicsTriggerId = useId()

  // Hydrate the image grid from the draft's images so the user picks up
  // exactly where they left off. The previewUrl is null because the
  // bytes live on the server (served via /i/<hash>) — the grid renders
  // those images via the same `<img src={/i/${hash}}>` path it uses for
  // freshly-uploaded slots.
  const initialImages: ImageSlot[] = initialDraft
    ? initialDraft.images.map((img) => ({
        state: 'ready',
        localId: nextSlotId(),
        hash: img.hash,
        mime: img.mime,
        previewUrl: null,
      }))
    : []

  const [title, setTitle] = useState(initialDraft?.title ?? '')
  const [body, setBody] = useState(initialDraft?.body ?? '')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(
    initialDraft?.topicBadgeIds ?? [],
  )
  const [topicPickerOpen, setTopicPickerOpen] = useState(false)
  const [images, setImages] = useState<ImageSlot[]>(initialImages)
  const [imageRemovedWarning, setImageRemovedWarning] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Tracks the server-side draft row this composer is bound to. `null`
  // means "no row yet, first save creates one". After a successful
  // POST /api/forum/drafts we capture the new id here AND push the URL
  // to `?draft=<id>` via router.replace so reloads survive.
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null)
  const [savingDraft, setSavingDraft] = useState(false)

  // @-mention dropdown state
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionHighlight, setMentionHighlight] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

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

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase()
    return readyImageOptions
      .filter(({ sequence }) => !referencedSequences.has(sequence))
      .filter(({ sequence }) => {
        if (!q) return true
        return `image${sequence}`.includes(q)
      })
  }, [readyImageOptions, referencedSequences, mentionQuery])

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
   * Insert `@Image<sequence>` over the active mention range, move caret
   * to immediately after the inserted token, close dropdown.
   *
   * If the char following the mention range isn't already whitespace, we
   * append a trailing space and place the caret after it. This is both a
   * usability win (the user keeps typing the next word) and the
   * load-bearing piece that prevents `getActiveMention` from re-detecting
   * the just-inserted token as an "active mention" the moment the
   * `onSelect` handler fires after the caret move — without the space,
   * the dropdown would immediately reopen filtered to "Image<N>".
   */
  const insertMention = useCallback(
    (sequence: number) => {
      if (!mentionRange) return
      const baseToken = `@Image${sequence}`
      const before = body.slice(0, mentionRange.start)
      const after = body.slice(mentionRange.end)
      const needsSpace = after.length === 0 || !/^\s/.test(after)
      const token = needsSpace ? `${baseToken} ` : baseToken
      const nextBody = before + token + after
      const nextCaret = before.length + token.length
      setBody(nextBody)
      closeMention()
      requestAnimationFrame(() => {
        const el = bodyRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [body, mentionRange, closeMention],
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
      insertMention(picked.sequence)
      return
    }
    if (e.key === 'Tab') {
      // Tab also commits, since it's the muscle-memory completion key.
      if (mentionCandidates.length === 0) return
      const picked = mentionCandidates[mentionHighlight]
      if (!picked) return
      e.preventDefault()
      insertMention(picked.sequence)
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

  async function uploadOne(file: File, localId: string) {
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
        return
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
    } catch {
      const msg = 'Network error while uploading.'
      setImages((prev) =>
        prev.map((s) => (s.localId === localId ? { state: 'error', localId, error: msg } : s)),
      )
      toast.error(msg)
    }
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files
    if (!picked) return
    const remaining = limits.maxImagesPerPost - images.length
    if (remaining <= 0) {
      toast.error(`You can attach at most ${limits.maxImagesPerPost} images.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const accepted: File[] = []
    for (const file of Array.from(picked)) {
      if (!ALLOWED_MIME.has(file.type)) {
        toast.error(`${file.name}: only PNG, JPEG, WebP, or GIF are accepted.`)
        continue
      }
      if (accepted.length >= remaining) {
        toast.error(`You can attach at most ${limits.maxImagesPerPost} images.`)
        break
      }
      accepted.push(file)
    }

    for (const file of accepted) {
      const localId = nextSlotId()
      const previewUrl = URL.createObjectURL(file)
      setImages((prev) => [...prev, { state: 'uploading', localId, previewUrl }])
      void uploadOne(file, localId)
    }

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
   * Persist current composer state as a draft.
   *
   * - First save (draftId === null) → POST /api/forum/drafts. On
   *   success, capture the new id and push the URL to
   *   `?draft=<id>` via router.replace so subsequent saves PATCH and
   *   a reload picks up the same draft.
   * - Subsequent saves → PATCH /api/forum/drafts/<id>. Sidebar refresh
   *   updates the row's updatedAt ordering.
   *
   * Drafts are intentionally permissive — no length checks here. The
   * only client-side gate is "no in-flight image uploads" so we don't
   * race the upload's hash back into the body payload.
   */
  async function onSaveDraft() {
    if (savingDraft || submitting || hasInFlightUpload) return
    setSavingDraft(true)
    setSubmitError(null)
    try {
      const payload = {
        title,
        body,
        topic_badge_ids: selectedTopicIds,
        images: readyImages.map((img) => ({ hash: img.hash, mime: img.mime })),
      }
      const url = draftId ? `/api/forum/drafts/${draftId}` : '/api/forum/drafts'
      const method = draftId ? 'PATCH' : 'POST'
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
        setSubmitError(msg)
        return
      }
      if (!draftId && data.draft_id) {
        setDraftId(data.draft_id)
        router.replace(`/forum/create?draft=${data.draft_id}`, { scroll: false })
      }
      toast.success('Draft saved.')
      // Refresh the route so the layout's sidebar re-fetches the
      // drafts list with the new/updated row reflected.
      router.refresh()
    } catch {
      setSubmitError('Network error — please try again.')
    } finally {
      setSavingDraft(false)
    }
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
        draft_id?: string
      } = {
        title: title.trim(),
        body,
        topic_badge_ids: selectedTopicIds,
        images: readyImages.map((img) => ({ hash: img.hash, mime: img.mime })),
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
      router.push('/forum')
      router.refresh()
    } catch {
      setSubmitError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
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
            <div className="relative">
              <Textarea
                id={bodyId}
                ref={bodyRef}
                value={body}
                onChange={onBodyChange}
                onKeyDown={onBodyKeyDown}
                onSelect={onBodySelectOrClick}
                onClick={onBodySelectOrClick}
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
              readyCount={readyImageOptions.length}
              unreferencedCount={
                readyImageOptions.filter(({ sequence }) => !referencedSequences.has(sequence))
                  .length
              }
              candidates={mentionCandidates}
              highlight={mentionHighlight}
              query={mentionQuery}
              onPick={(seq) => insertMention(seq)}
              onHoverIndex={(idx) => setMentionHighlight(idx)}
            />
          </PopoverContent>
        </Popover>
        <p className="text-[11px] text-muted-foreground">
          Reference uploaded images in your post with <code className="font-mono">@Image1</code>,{' '}
          <code className="font-mono">@Image2</code>, etc.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Type <code className="font-mono">@</code> for a picker. Images you don't reference will
          appear as a gallery below your post.
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
            {selectedTopicIds.length} / {limits.maxTopicsPerPost} max
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
      <div className="flex items-center justify-between gap-2">
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
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {submitting ? 'Posting…' : 'Post'}
        </Button>
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

type MentionCandidate = {
  slot: Extract<ImageSlot, { state: 'ready' }>
  sequence: number
}

function MentionList({
  listId,
  readyCount,
  unreferencedCount,
  candidates,
  highlight,
  query,
  onPick,
  onHoverIndex,
}: {
  listId: string
  readyCount: number
  unreferencedCount: number
  candidates: MentionCandidate[]
  highlight: number
  query: string
  onPick: (sequence: number) => void
  onHoverIndex: (idx: number) => void
}) {
  // Empty-state priority:
  //   1. No ready images uploaded yet            → "Upload an image first."
  //   2. All ready images already referenced     → "All images referenced."
  //   3. Query filtered everything out (no match)→ "No matches for "<q>"."
  if (readyCount === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        Upload an image first.
      </div>
    )
  }

  if (unreferencedCount === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        All images referenced.
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div id={listId} role="listbox" className="p-3 text-center text-xs text-muted-foreground">
        No matches for "{query}".
      </div>
    )
  }

  return (
    <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
      {candidates.map((c, idx) => {
        const label = `@Image${c.sequence}`
        const isActive = idx === highlight
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
              onPick(c.sequence)
            }}
            onKeyDown={(e) => {
              // Keyboard nav for the picker lives on the textarea (since
              // that's where focus stays). This handler is here purely to
              // satisfy a11y lint — Enter/Space here delegate to the same
              // pick action in case focus ever lands on a row (e.g. via
              // assistive tech).
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(c.sequence)
              }
            }}
            onMouseEnter={() => onHoverIndex(idx)}
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
    </div>
  )
}
