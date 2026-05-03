'use client'

/**
 * TypeaheadSearch — Spotlight-style typeahead for the TopNav.
 *
 * Behaviour:
 *   - Typing 2+ chars fetches /api/search/typeahead?q=<query> (200 ms debounce).
 *   - Matching creators appear first in a "Creators" group; topics second in a
 *     "Topics" group; articles below in an "Articles" group.
 *   - Clicking (or keyboard-selecting) a creator navigates to /c/<slug>.
 *   - Clicking (or keyboard-selecting) a topic navigates to /?badge=<name>.
 *   - Clicking (or keyboard-selecting) an article navigates to /a/<slug>.
 *   - Pressing Enter with no result highlighted falls back to /search?q=<query>.
 *   - Cmd+K / Ctrl+K focuses the input from anywhere on the page.
 *
 * Layout: shadcn Popover wrapping a plain Input. The dropdown uses shadcn
 * Command (shouldFilter=false — server already filtered) with CommandGroup
 * sections for keyboard navigation and item selection.
 */

import { FileText, Hash, Search, User } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
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

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [articles, setArticles] = useState<TypeaheadArticle[]>([])
  const [creators, setCreators] = useState<TypeaheadCreator[]>([])
  const [topics, setTopics] = useState<TypeaheadTopic[]>([])
  const [loading, setLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch typeahead results ──────────────────────────────────────────────
  const fetchResults = useCallback(async (q: string) => {
    if (q.trim().length < MIN_LENGTH) {
      setArticles([])
      setCreators([])
      setTopics([])
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
        return
      }
      const data = (await res.json()) as {
        articles: TypeaheadArticle[]
        creators: TypeaheadCreator[]
        topics: TypeaheadTopic[]
      }
      setArticles(data.articles ?? [])
      setCreators(data.creators ?? [])
      setTopics(data.topics ?? [])
    } catch {
      setArticles([])
      setCreators([])
      setTopics([])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Debounced query change ───────────────────────────────────────────────
  function handleChange(next: string) {
    setQuery(next)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (next.trim().length < MIN_LENGTH) {
      setArticles([])
      setCreators([])
      setTopics([])
      setOpen(false)
      return
    }

    setOpen(true)
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

  // ── Detect OS for keyboard hint ──────────────────────────────────────────
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const kbdHint = isMac ? '⌘K' : 'Ctrl+K'

  const hasResults = articles.length > 0 || creators.length > 0 || topics.length > 0
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

              {/* ── Creators group (shown first) ──────────────────────── */}
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
