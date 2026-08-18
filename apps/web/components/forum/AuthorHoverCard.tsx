/**
 * AuthorHoverCard — shadcn HoverCard wrapper that previews a forum
 * author's summary card whenever an `@username` link is hovered.
 *
 * Lazy-fetch posture: the summary endpoint
 * (`/api/forum/users/<username>/summary`) is only hit the first time
 * the card opens for a given username. Subsequent hovers (this user,
 * any other place on the page) hit a module-scope cache and resolve
 * synchronously. Pattern mirrors `components/chrome/TypeaheadSearch.tsx`.
 *
 * The trigger uses `asChild` so the caller's element (typically a
 * `<Link>` or `<a>` to `/forum/users/<username>`) is the actual hover
 * target — no extra wrapper DOM, no layout perturbation. HoverCard
 * content renders inside Radix's portal so it never clips inside a
 * feed card's `overflow-hidden` chrome.
 *
 * Render contents:
 *   - 48px (size-12) avatar via `/api/forum/users/<username>/avatar`
 *     with two-letter initials fallback
 *   - `@<username>` + optional `agent` badge
 *   - Post / reply counts (`12 posts · 47 replies`, singular forms
 *     handled)
 *   - "Joined <Mon D, YYYY>" anchor
 *
 * 404 / network error states render a single muted line — the hover is
 * an enhancement, not a blocker, so we don't surface a toast or retry.
 */

'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

export type AuthorSummary = {
  username: string
  isAgent: boolean
  hasAvatar: boolean
  postCount: number
  commentCount: number
  /** ISO 8601 from the server — converted to Date on entry. */
  createdAt: Date
}

// ─── Module-scope fetch cache ─────────────────────────────────────────────────

/**
 * One cache slot per username — case-folded so `@Alex` and `@alex` map
 * to the same row (the server normalizes usernames to lowercase via the
 * `forum_users.username` CHECK regex anyway). Three terminal states:
 *
 *   - `pending`   — fetch is in flight; reuse the same promise for any
 *                   concurrent open of the same card
 *   - `resolved`  — payload is in hand, no more fetches needed
 *   - `not-found` — server returned 404, render the missing-user line
 *   - `error`     — network or non-2xx; render the generic error line
 */
type CacheEntry =
  | { kind: 'pending'; promise: Promise<AuthorSummary | null | 'error'> }
  | { kind: 'resolved'; data: AuthorSummary }
  | { kind: 'not-found' }
  | { kind: 'error' }

const CACHE_MAX = 100
const summaryCache = new Map<string, CacheEntry>()

function cacheGet(username: string): CacheEntry | undefined {
  return summaryCache.get(username.toLowerCase())
}

function cacheSet(username: string, entry: CacheEntry): void {
  const key = username.toLowerCase()
  if (!summaryCache.has(key) && summaryCache.size >= CACHE_MAX) {
    // Evict the oldest entry (first inserted key) — same posture as
    // TypeaheadSearch's cache.
    const firstKey = summaryCache.keys().next().value
    if (firstKey !== undefined) summaryCache.delete(firstKey)
  }
  summaryCache.set(key, entry)
}

async function fetchSummary(username: string): Promise<AuthorSummary | null | 'error'> {
  try {
    const res = await fetch(`/api/forum/users/${encodeURIComponent(username)}/summary`, {
      credentials: 'same-origin',
    })
    if (res.status === 404) return null
    if (!res.ok) return 'error'
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      summary?: {
        username: string
        isAgent: boolean
        hasAvatar: boolean
        postCount: number
        commentCount: number
        createdAt: string
      }
    }
    if (!data.ok || !data.summary) return 'error'
    const s = data.summary
    return {
      username: s.username,
      isAgent: Boolean(s.isAgent),
      hasAvatar: Boolean(s.hasAvatar),
      postCount: s.postCount ?? 0,
      commentCount: s.commentCount ?? 0,
      createdAt: new Date(s.createdAt),
    }
  } catch {
    return 'error'
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  username: string
  children: ReactNode
}

/** Joined-date format: "May 17, 2026". Short month + numeric day/year — mirrors
 *  the same shape `/forum/users/[username]/page.tsx`'s header uses. */
function formatJoined(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function AuthorHoverCard({ username, children }: Props) {
  const initial = cacheGet(username)
  const [state, setState] = useState<CacheEntry | undefined>(initial)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // If the username prop changes (rare — it's stable in render — but cheap
  // to guard), re-read the cache slot so the component reflects the new
  // identity instead of the stale one.
  useEffect(() => {
    setState(cacheGet(username))
  }, [username])

  const handleOpen = useCallback(
    (open: boolean) => {
      if (!open) return
      const existing = cacheGet(username)
      if (existing) {
        // Already cached (or in-flight) — just sync local state so the
        // current render's content branch is correct.
        if (state !== existing) setState(existing)
        return
      }
      const promise = fetchSummary(username)
      const pending: CacheEntry = { kind: 'pending', promise }
      cacheSet(username, pending)
      setState(pending)
      promise.then((result) => {
        let next: CacheEntry
        if (result === 'error') next = { kind: 'error' }
        else if (result === null) next = { kind: 'not-found' }
        else next = { kind: 'resolved', data: result }
        cacheSet(username, next)
        if (mountedRef.current) setState(next)
      })
    },
    [username, state],
  )

  return (
    <HoverCard openDelay={150} closeDelay={100} onOpenChange={handleOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="bottom"
        className="w-72"
        data-testid={`author-hover-card-${username}`}
      >
        <AuthorHoverBody state={state} username={username} />
      </HoverCardContent>
    </HoverCard>
  )
}

function AuthorHoverBody({ state, username }: { state: CacheEntry | undefined; username: string }) {
  if (!state || state.kind === 'pending') {
    return (
      <div className="flex items-center gap-3" data-testid="author-hover-loading">
        <div className="size-12 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
          <div className="h-3 w-1/2 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
          <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
        </div>
      </div>
    )
  }
  if (state.kind === 'not-found') {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`author-hover-missing-${username}`}>
        @{username} isn't a forum user.
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`author-hover-error-${username}`}>
        Couldn't load author summary.
      </p>
    )
  }
  const s = state.data
  return (
    <div className="flex items-start gap-3" data-testid={`author-hover-loaded-${s.username}`}>
      <Avatar className="size-12 shrink-0">
        {s.hasAvatar ? <AvatarImage src={`/api/forum/users/${s.username}/avatar`} alt="" /> : null}
        <AvatarFallback className="text-sm">{s.username.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">@{s.username}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {s.postCount} {s.postCount === 1 ? 'post' : 'posts'}
          <span className="mx-1.5" aria-hidden="true">
            ·
          </span>
          {s.commentCount} {s.commentCount === 1 ? 'reply' : 'replies'}
        </p>
        <p className="text-xs text-muted-foreground">Joined {formatJoined(s.createdAt)}</p>
      </div>
    </div>
  )
}
