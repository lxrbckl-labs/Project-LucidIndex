'use client'

/**
 * TypeaheadSearch — Spotlight-style typeahead for the TopNav.
 *
 * Behaviour:
 *   - Typing 2+ chars fetches /api/search/typeahead?q=<query> (120 ms debounce).
 *   - On /settings/* routes, a "Settings" group is prepended with results from
 *     the static settings index (synchronous, no fetch needed). Min length 1
 *     for settings; 2 for the API.
 *   - On /forum/* routes, swaps to `/api/forum/search/typeahead` and renders
 *     three forum-specific groups: Forum Posts, Authors, Topics. The
 *     dashboard groups (Creators/Topics/Articles/Starred/Settings) do NOT
 *     render in forum mode — the two modes don't cross-contaminate.
 *   - Matching creators appear first in a "Creators" group; topics second in a
 *     "Topics" group; starred articles in a "Starred" group; regular articles
 *     below in an "Articles" group. Starred articles are deduplicated out of
 *     the regular Articles group so each match appears only once.
 *   - Clicking (or keyboard-selecting) a creator navigates to /c/<slug>.
 *   - Clicking (or keyboard-selecting) a topic navigates to /?badge=<name>.
 *   - Clicking (or keyboard-selecting) an article navigates to /a/<slug>.
 *   - Clicking (or keyboard-selecting) a settings entry navigates to its href.
 *   - In forum mode: post → /forum/posts/<id>; author → /forum/users/<username>;
 *     topic → /forum?topic=<id>.
 *   - Cmd+K / Ctrl+K focuses the input from anywhere on the page.
 *   - In-flight fetches are aborted when the query changes.
 *   - Responses are cached in a module-scope Map (up to 50 entries). Cache
 *     keys are namespaced by mode (`forum:` / `dashboard:`) so flipping
 *     pages doesn't surface stale cross-mode results.
 *   - Matched substrings in titles/descriptions/names are highlighted.
 *
 * Layout: shadcn Popover wrapping a plain Input. The dropdown uses shadcn
 * Command (shouldFilter=false — server already filtered) with CommandGroup
 * sections for keyboard navigation and item selection.
 */

import { Bot, FileText, Hash, MessageSquare, Search, Settings, Star, User } from 'lucide-react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type {
  ForumAuthorHit,
  ForumPostHit,
  ForumTopicHit,
} from '@/app/api/forum/search/typeahead/route'
import type {
  TypeaheadArticle,
  TypeaheadCreator,
  TypeaheadTopic,
} from '@/app/api/search/typeahead/route'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type SettingsIndexEntry, searchSettingsIndex } from '@/lib/settings-index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str
}

/**
 * Wrap the first occurrence of `query` in `text` with a <mark> element.
 * Case-insensitive. Returns the plain string if no match.
 */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-semibold text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

const DEBOUNCE_MS = 120
/** Minimum chars before firing the remote API (articles/creators/topics). */
const MIN_LENGTH = 2
/** Minimum chars before searching the settings index. */
const SETTINGS_MIN_LENGTH = 1

// ─── Module-scope fetch cache ─────────────────────────────────────────────────

type DashboardApiResponse = {
  articles: TypeaheadArticle[]
  creators: TypeaheadCreator[]
  topics: TypeaheadTopic[]
  starredArticles: TypeaheadArticle[]
}

type ForumApiResponse = {
  posts: ForumPostHit[]
  authors: ForumAuthorHit[]
  topics: ForumTopicHit[]
}

/**
 * Cache entries are namespaced by mode (`forum:<q>` / `dashboard:<q>`) so
 * dashboard-mode and forum-mode results never collide for the same query
 * string. The union stays narrow so the read path doesn't need a runtime
 * discriminator — callers only `cacheGet` from the branch they're in.
 */
type CachedEntry = DashboardApiResponse | ForumApiResponse

const CACHE_MAX = 50
const fetchCache = new Map<string, CachedEntry>()

function cacheGet<T extends CachedEntry>(key: string): T | undefined {
  return fetchCache.get(key) as T | undefined
}

function cacheSet(key: string, value: CachedEntry): void {
  if (fetchCache.size >= CACHE_MAX) {
    // Evict the oldest entry (first inserted key)
    const firstKey = fetchCache.keys().next().value
    if (firstKey !== undefined) fetchCache.delete(firstKey)
  }
  fetchCache.set(key, value)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TypeaheadSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const onSettingsPage = pathname.startsWith('/settings')
  const onForumPage = pathname.startsWith('/forum')

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [articles, setArticles] = useState<TypeaheadArticle[]>([])
  const [creators, setCreators] = useState<TypeaheadCreator[]>([])
  const [topics, setTopics] = useState<TypeaheadTopic[]>([])
  const [starredArticles, setStarredArticles] = useState<TypeaheadArticle[]>([])
  const [settingsResults, setSettingsResults] = useState<SettingsIndexEntry[]>([])
  // Forum-mode results — kept separate from the dashboard arrays above so
  // the two modes never bleed into each other when the user navigates from
  // /forum/* back to /.
  const [forumPosts, setForumPosts] = useState<ForumPostHit[]>([])
  const [forumAuthors, setForumAuthors] = useState<ForumAuthorHit[]>([])
  const [forumTopics, setForumTopics] = useState<ForumTopicHit[]>([])
  const [loading, setLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** AbortController for the current in-flight fetch. */
  const abortRef = useRef<AbortController | null>(null)

  function clearDashboardResults() {
    setArticles([])
    setCreators([])
    setTopics([])
    setStarredArticles([])
  }

  function clearForumResults() {
    setForumPosts([])
    setForumAuthors([])
    setForumTopics([])
  }

  // ── Fetch typeahead results (dashboard mode) ────────────────────────────
  const fetchDashboardResults = useCallback(async (q: string) => {
    const cacheKey = `dashboard:${q.trim().toLowerCase()}`

    // Cache hit — skip the network entirely
    const cached = cacheGet<DashboardApiResponse>(cacheKey)
    if (cached) {
      setArticles(cached.articles)
      setCreators(cached.creators)
      setTopics(cached.topics)
      setStarredArticles(cached.starredArticles)
      setLoading(false)
      return
    }

    // Abort any previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch(`/api/search/typeahead?q=${encodeURIComponent(q.trim())}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!res.ok) {
        setArticles([])
        setCreators([])
        setTopics([])
        setStarredArticles([])
        return
      }
      const data = (await res.json()) as DashboardApiResponse
      const result: DashboardApiResponse = {
        articles: data.articles ?? [],
        creators: data.creators ?? [],
        topics: data.topics ?? [],
        starredArticles: data.starredArticles ?? [],
      }
      cacheSet(cacheKey, result)
      setArticles(result.articles)
      setCreators(result.creators)
      setTopics(result.topics)
      setStarredArticles(result.starredArticles)
    } catch (err) {
      // Ignore aborted requests — they are intentional (query changed)
      if (err instanceof DOMException && err.name === 'AbortError') return
      setArticles([])
      setCreators([])
      setTopics([])
      setStarredArticles([])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Fetch typeahead results (forum mode) ────────────────────────────────
  const fetchForumResults = useCallback(async (q: string) => {
    const cacheKey = `forum:${q.trim().toLowerCase()}`

    const cached = cacheGet<ForumApiResponse>(cacheKey)
    if (cached) {
      setForumPosts(cached.posts)
      setForumAuthors(cached.authors)
      setForumTopics(cached.topics)
      setLoading(false)
      return
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch(`/api/forum/search/typeahead?q=${encodeURIComponent(q.trim())}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!res.ok) {
        setForumPosts([])
        setForumAuthors([])
        setForumTopics([])
        return
      }
      const data = (await res.json()) as ForumApiResponse
      const result: ForumApiResponse = {
        posts: data.posts ?? [],
        authors: data.authors ?? [],
        topics: data.topics ?? [],
      }
      cacheSet(cacheKey, result)
      setForumPosts(result.posts)
      setForumAuthors(result.authors)
      setForumTopics(result.topics)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setForumPosts([])
      setForumAuthors([])
      setForumTopics([])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Settings index search (synchronous) ─────────────────────────────────
  const updateSettingsResults = useCallback(
    (q: string) => {
      if (onSettingsPage && q.trim().length >= SETTINGS_MIN_LENGTH) {
        setSettingsResults(searchSettingsIndex(q, 5))
      } else {
        setSettingsResults([])
      }
    },
    [onSettingsPage],
  )

  // ── Debounced query change ───────────────────────────────────────────────
  function handleChange(next: string) {
    setQuery(next)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    // Settings search is synchronous — update immediately (no debounce needed)
    updateSettingsResults(next)

    const trimmed = next.trim()

    // On settings pages, short queries (≥1 char) open the dropdown for settings
    // only — no API fetch needed.
    if (onSettingsPage) {
      if (trimmed.length >= SETTINGS_MIN_LENGTH) {
        setOpen(true)
      } else {
        setOpen(false)
      }
      clearDashboardResults()
      clearForumResults()
      return
    }

    // Forum pages: fetch from the forum endpoint. Dashboard arrays stay
    // empty so the dashboard groups don't render alongside forum hits.
    if (onForumPage) {
      if (trimmed.length < MIN_LENGTH) {
        clearForumResults()
        setOpen(false)
        return
      }
      clearDashboardResults()
      setOpen(true)
      debounceRef.current = setTimeout(() => {
        void fetchForumResults(next)
      }, DEBOUNCE_MS)
      return
    }

    // Dashboard pages: need ≥ MIN_LENGTH to fire the API
    if (trimmed.length < MIN_LENGTH) {
      clearDashboardResults()
      clearForumResults()
      setOpen(false)
      return
    }

    setOpen(true)
    clearForumResults()

    debounceRef.current = setTimeout(() => {
      void fetchDashboardResults(next)
    }, DEBOUNCE_MS)
  }

  // ── Cleanup debounce + abort on unmount ─────────────────────────────────
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    },
    [],
  )

  // ── Cmd+K / Ctrl+K global focus ─────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── Enter — no-op (no dedicated /search page exists; user picks from dropdown) ──
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
  }

  // ── Article selection ───────────────────────────────────────────────────
  function handleSelectArticle(slug: string) {
    setOpen(false)
    setQuery('')
    router.push(`/a/${slug}`)
  }

  // ── Creator selection ───────────────────────────────────────────────────
  function handleSelectCreator(slug: string) {
    setOpen(false)
    setQuery('')
    router.push(`/c/${slug}`)
  }

  // ── Topic selection ─────────────────────────────────────────────────────
  function handleSelectTopic(name: string) {
    setOpen(false)
    setQuery('')
    router.push(`/?badge=${encodeURIComponent(name)}`)
  }

  // ── Settings selection ──────────────────────────────────────────────────
  function handleSelectSetting(href: string) {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  // ── Forum selections ────────────────────────────────────────────────────
  function handleSelectForumPost(id: string) {
    setOpen(false)
    setQuery('')
    router.push(`/forum/posts/${id}`)
  }

  function handleSelectForumAuthor(username: string) {
    setOpen(false)
    setQuery('')
    router.push(`/forum/users/${username}`)
  }

  function handleSelectForumTopic(id: string) {
    setOpen(false)
    setQuery('')
    router.push(`/forum?topic=${id}`)
  }

  const trimmedQuery = query.trim()

  const hasResults =
    articles.length > 0 ||
    creators.length > 0 ||
    topics.length > 0 ||
    starredArticles.length > 0 ||
    settingsResults.length > 0 ||
    forumPosts.length > 0 ||
    forumAuthors.length > 0 ||
    forumTopics.length > 0

  // Show the dropdown when open and there is something to render or we're
  // still loading. The effective min-length check differs per page type.
  const effectiveMinLength = onSettingsPage ? SETTINGS_MIN_LENGTH : MIN_LENGTH
  const showDropdown = open && (loading || hasResults || trimmedQuery.length >= effectiveMinLength)

  return (
    <search aria-label="Site search">
      <Popover open={showDropdown} onOpenChange={setOpen}>
        <form onSubmit={handleSubmit} data-testid="topnav-search-form">
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                id="topnav-search"
                type="search"
                name="q"
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                onFocus={() => {
                  // Open popover on focus when there's already enough input,
                  // or always on settings pages (browse mode shows all settings).
                  if (onSettingsPage) {
                    // Browse mode: even empty query should open to show all settings
                    updateSettingsResults(query)
                    setOpen(true)
                  } else if (trimmedQuery.length >= MIN_LENGTH) {
                    setOpen(true)
                  }
                }}
                placeholder="Search"
                autoComplete="off"
                data-testid="topnav-search-input"
                className="w-96 pl-8 pr-2 md:w-[28rem] h-9 bg-background focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
              />
            </div>
          </PopoverTrigger>
        </form>

        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[320px]"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              {loading && (
                <CommandEmpty className="py-3 text-sm text-muted-foreground">
                  Searching…
                </CommandEmpty>
              )}
              {!loading && !hasResults && trimmedQuery.length >= effectiveMinLength && (
                <CommandEmpty className="py-3 text-sm text-muted-foreground">
                  No matches for &ldquo;{truncate(query, 40)}&rdquo;
                </CommandEmpty>
              )}

              {/* ── Settings group (shown first on /settings/* routes) ── */}
              {!loading && !onForumPage && settingsResults.length > 0 && (
                <CommandGroup heading="Settings">
                  {settingsResults.map((entry) => (
                    <CommandItem
                      key={entry.href}
                      value={entry.href}
                      onSelect={() => handleSelectSetting(entry.href)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Settings icon */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Title + description */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(entry.title, trimmedQuery)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {highlightMatch(entry.description, trimmedQuery)}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Forum Posts group ─────────────────────────────────── */}
              {!loading && onForumPage && forumPosts.length > 0 && (
                <CommandGroup heading="Forum Posts">
                  {forumPosts.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`forum-post-${p.id}`}
                      onSelect={() => handleSelectForumPost(p.id)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Post icon */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Title + author */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(truncate(p.title, 60), trimmedQuery)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                          <span>@{p.authorUsername}</span>
                          {p.authorIsAgent && (
                            <Bot className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                          )}
                        </p>
                      </div>

                      {/* Date */}
                      {p.createdAt && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(p.createdAt)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Authors group (forum mode) ────────────────────────── */}
              {!loading && onForumPage && forumAuthors.length > 0 && (
                <CommandGroup heading="Authors">
                  {forumAuthors.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={`forum-author-${a.id}`}
                      onSelect={() => handleSelectForumAuthor(a.username)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Avatar circle */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        {a.isAgent ? (
                          <Bot className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>

                      {/* Username */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          @{highlightMatch(a.username, trimmedQuery)}
                        </p>
                        {a.isAgent && <p className="text-xs text-muted-foreground mt-0.5">agent</p>}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Topics group (forum mode) ─────────────────────────── */}
              {!loading && onForumPage && forumTopics.length > 0 && (
                <CommandGroup heading="Topics">
                  {forumTopics.map((t) => (
                    <CommandItem
                      key={`forum-topic-${t.id}`}
                      value={`forum-topic-${t.id}`}
                      onSelect={() => handleSelectForumTopic(t.id)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Hash icon */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Name + post count */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(t.name, trimmedQuery)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.postCount === 1 ? '1 post' : `${t.postCount} posts`}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Creators group ────────────────────────────────────── */}
              {!loading && !onForumPage && creators.length > 0 && (
                <CommandGroup heading="Creators">
                  {creators.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => handleSelectCreator(c.slug)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Avatar circle */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Label + article count */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(truncate(c.label, 60), trimmedQuery)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.articleCount === 1 ? '1 article' : `${c.articleCount} articles`}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Topics group ──────────────────────────────────────── */}
              {!loading && !onForumPage && topics.length > 0 && (
                <CommandGroup heading="Topics">
                  {topics.map((t) => (
                    <CommandItem
                      key={t.name}
                      value={t.name}
                      onSelect={() => handleSelectTopic(t.name)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Hash icon */}
                      <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Name + article count */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(t.name, trimmedQuery)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.articleCount === 1 ? '1 article' : `${t.articleCount} articles`}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Starred articles group ────────────────────────────── */}
              {!loading && !onForumPage && starredArticles.length > 0 && (
                <CommandGroup heading="Starred">
                  {starredArticles.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`starred-${r.id}`}
                      onSelect={() => handleSelectArticle(r.slug)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Thumbnail */}
                      <div className="shrink-0 w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center">
                        {r.heroImageHash ? (
                          <Image
                            src={`/i/${r.heroImageHash}`}
                            alt=""
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Star className="h-4 w-4 text-muted-foreground fill-current" />
                        )}
                      </div>

                      {/* Title + creator */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(truncate(r.title, 60), trimmedQuery)}
                        </p>
                        {r.creatorLabel && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {highlightMatch(r.creatorLabel, trimmedQuery)}
                          </p>
                        )}
                      </div>

                      {/* Star icon (always visible, to distinguish from regular articles) */}
                      <Star className="shrink-0 h-3.5 w-3.5 text-amber-400 fill-current" />

                      {/* Date */}
                      {r.sourcePublishedAt && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(r.sourcePublishedAt)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Articles group ─────────────────────────────────────── */}
              {!loading && !onForumPage && articles.length > 0 && (
                <CommandGroup heading="Articles">
                  {articles.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      onSelect={() => handleSelectArticle(r.slug)}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                    >
                      {/* Thumbnail */}
                      <div className="shrink-0 w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center">
                        {r.heroImageHash ? (
                          <Image
                            src={`/i/${r.heroImageHash}`}
                            alt=""
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>

                      {/* Title + creator */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight truncate">
                          {highlightMatch(truncate(r.title, 60), trimmedQuery)}
                        </p>
                        {r.creatorLabel && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {highlightMatch(r.creatorLabel, trimmedQuery)}
                          </p>
                        )}
                      </div>

                      {/* Date */}
                      {r.sourcePublishedAt && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(r.sourcePublishedAt)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </search>
  )
}
