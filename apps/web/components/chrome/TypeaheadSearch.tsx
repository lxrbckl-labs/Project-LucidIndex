'use client'

/**
 * TypeaheadSearch — Spotlight-style typeahead for the TopNav.
 *
 * Behaviour:
 *   - Typing 2+ chars fetches /api/search/typeahead?q=<query> (200 ms debounce).
 *   - On /settings/* routes, a "Settings" group is prepended with results from
 *     the static settings index (synchronous, no fetch needed).
 *   - Matching creators appear first in a "Creators" group; topics second in a
 *     "Topics" group; starred articles in a "Starred" group; regular articles
 *     below in an "Articles" group. Starred articles are deduplicated out of
 *     the regular Articles group so each match appears only once.
 *   - Clicking (or keyboard-selecting) a creator navigates to /c/<slug>.
 *   - Clicking (or keyboard-selecting) a topic navigates to /?badge=<name>.
 *   - Clicking (or keyboard-selecting) an article navigates to /a/<slug>.
 *   - Clicking (or keyboard-selecting) a settings entry navigates to its href.
 *   - Pressing Enter with no result highlighted falls back to /search?q=<query>.
 *   - Cmd+K / Ctrl+K focuses the input from anywhere on the page.
 *
 * Layout: shadcn Popover wrapping a plain Input. The dropdown uses shadcn
 * Command (shouldFilter=false — server already filtered) with CommandGroup
 * sections for keyboard navigation and item selection.
 */

import { FileText, Hash, Search, Settings, Star, User } from 'lucide-react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
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

const DEBOUNCE_MS = 200
const MIN_LENGTH = 2

// ─── Component ────────────────────────────────────────────────────────────────

export function TypeaheadSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const onSettingsPage = pathname.startsWith('/settings')

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [articles, setArticles] = useState<TypeaheadArticle[]>([])
  const [creators, setCreators] = useState<TypeaheadCreator[]>([])
  const [topics, setTopics] = useState<TypeaheadTopic[]>([])
  const [starredArticles, setStarredArticles] = useState<TypeaheadArticle[]>([])
  const [settingsResults, setSettingsResults] = useState<SettingsIndexEntry[]>([])
  const [loading, setLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch typeahead results ──────────────────────────────────────────────
  const fetchResults = useCallback(async (q: string) => {
    if (q.trim().length < MIN_LENGTH) {
      setArticles([])
      setCreators([])
      setTopics([])
      setStarredArticles([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/search/typeahead?q=${encodeURIComponent(q.trim())}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setArticles([])
        setCreators([])
        setTopics([])
        setStarredArticles([])
        return
      }
      const data = (await res.json()) as {
        articles: TypeaheadArticle[]
        creators: TypeaheadCreator[]
        topics: TypeaheadTopic[]
        starredArticles: TypeaheadArticle[]
      }
      setArticles(data.articles ?? [])
      setCreators(data.creators ?? [])
      setTopics(data.topics ?? [])
      setStarredArticles(data.starredArticles ?? [])
    } catch {
      setArticles([])
      setCreators([])
      setTopics([])
      setStarredArticles([])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Settings index search (synchronous) ─────────────────────────────────
  const updateSettingsResults = useCallback(
    (q: string) => {
      if (onSettingsPage && q.trim().length >= MIN_LENGTH) {
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

    if (next.trim().length < MIN_LENGTH) {
      setArticles([])
      setCreators([])
      setTopics([])
      setStarredArticles([])
      setOpen(false)
      return
    }

    setOpen(true)

    // On settings pages: only show settings results — skip the typeahead API
    // (no articles / creators / topics / starred articles).
    if (onSettingsPage) {
      setArticles([])
      setCreators([])
      setTopics([])
      setStarredArticles([])
      return
    }

    debounceRef.current = setTimeout(() => {
      void fetchResults(next)
    }, DEBOUNCE_MS)
  }

  // ── Cleanup debounce on unmount ──────────────────────────────────────────
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
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

  // ── Enter → full-search fallback ────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setOpen(false)
    router.push(`/search?q=${encodeURIComponent(trimmed)}`)
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

  // ── Detect OS for keyboard hint ──────────────────────────────────────────
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const kbdHint = isMac ? '⌘K' : 'Ctrl+K'

  const hasResults =
    articles.length > 0 ||
    creators.length > 0 ||
    topics.length > 0 ||
    starredArticles.length > 0 ||
    settingsResults.length > 0
  const showDropdown = open && (loading || hasResults || query.trim().length >= MIN_LENGTH)

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
                  if (query.trim().length >= MIN_LENGTH) setOpen(true)
                }}
                placeholder={`Search  ${kbdHint}`}
                autoComplete="off"
                data-testid="topnav-search-input"
                className="w-64 pl-8 pr-2 md:w-80 h-9"
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
              {!loading && !hasResults && query.trim().length >= MIN_LENGTH && (
                <CommandEmpty className="py-3 text-sm text-muted-foreground">
                  No matches for &ldquo;{truncate(query, 40)}&rdquo;
                </CommandEmpty>
              )}

              {/* ── Settings group (shown first on /settings/* routes) ── */}
              {!loading && settingsResults.length > 0 && (
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
                        <p className="text-sm leading-tight truncate">{entry.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {entry.description}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Creators group ────────────────────────────────────── */}
              {!loading && creators.length > 0 && (
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
                        <p className="text-sm leading-tight truncate">{truncate(c.label, 60)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.articleCount === 1 ? '1 article' : `${c.articleCount} articles`}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Topics group ──────────────────────────────────────── */}
              {!loading && topics.length > 0 && (
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
                        <p className="text-sm leading-tight truncate">{t.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.articleCount === 1 ? '1 article' : `${t.articleCount} articles`}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* ── Starred articles group ────────────────────────────── */}
              {!loading && starredArticles.length > 0 && (
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
                        <p className="text-sm leading-tight truncate">{truncate(r.title, 60)}</p>
                        {r.creatorLabel && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {r.creatorLabel}
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
              {!loading && articles.length > 0 && (
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
                        <p className="text-sm leading-tight truncate">{truncate(r.title, 60)}</p>
                        {r.creatorLabel && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {r.creatorLabel}
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
