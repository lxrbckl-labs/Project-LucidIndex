/**
 * SearchInput — top-nav search affordance (#73).
 *
 * Sits in the right-side cluster of the TopNav, before the Settings /
 * Account links. Hairline magazine vibe — no rounded corners, no fill,
 * just a thin underline that thickens on focus. Same uppercase tracking
 * as the rest of the nav so it reads as part of the same row.
 *
 * Behavior:
 *   - Submitting the form (Enter) navigates to `/search?q=<term>`.
 *   - The input is debounced (~300ms) and pushes the same URL when the
 *     user stops typing — instant-search-via-navigation. We deliberately
 *     don't render in-line dropdown suggestions for v0.1; the spec
 *     defers that to a follow-up. The search route is fast enough that
 *     navigating-on-debounce reads as "live".
 *   - Empty query is a no-op — we never navigate to `/search?q=` with
 *     an empty term; the user is left where they are.
 *   - When already on `/search`, typing replaces the URL (no history
 *     spam) and preserves the `include_archived` flag if present.
 *
 * Client component — owns the debounce timer + the controlled input
 * state. The route renders against `searchParams` server-side so we
 * don't need a separate "submit" path beyond the URL push.
 */

'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 300

export function SearchInput() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Initial value comes from `?q=…` so the input rehydrates to whatever
  // the user typed in the URL — important on `/search` page reloads.
  const [value, setValue] = useState(() => searchParams.get('q') ?? '')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the input in sync if the user navigates server-side and the
  // URL's `?q=` changes from underneath us (e.g. clicking a saved link).
  // This effect mirrors `?q=` → state when the user is currently on the
  // search page; on other pages, the input is the source of truth.
  useEffect(() => {
    if (pathname === '/search') {
      const fromUrl = searchParams.get('q') ?? ''
      setValue((current) => (current === fromUrl ? current : fromUrl))
    }
  }, [pathname, searchParams])

  const navigateToSearch = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return // never navigate with an empty query

      const params = new URLSearchParams()
      params.set('q', trimmed)
      // Preserve the `include_archived` flag when typing on /search.
      if (pathname === '/search') {
        const archived = searchParams.get('include_archived')
        if (archived) params.set('include_archived', archived)
      }
      const url = `/search?${params.toString()}`
      // On /search we replace so debounced typing doesn't pollute history.
      if (pathname === '/search') {
        router.replace(url)
      } else {
        router.push(url)
      }
    },
    [router, pathname, searchParams],
  )

  function handleChange(next: string) {
    setValue(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => navigateToSearch(next), DEBOUNCE_MS)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    navigateToSearch(value)
  }

  // Clean up the pending timer on unmount so a stale debounced push
  // can't fire after the component is gone (rare in practice, but
  // strict-mode dev would otherwise warn).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <search aria-label="Site search">
      <form onSubmit={handleSubmit} className="flex items-center">
        <label htmlFor="topnav-search" className="sr-only">
          Search articles
        </label>
        <input
          id="topnav-search"
          type="search"
          name="q"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search"
          autoComplete="off"
          className="w-32 border-b border-[var(--color-card-border)] bg-transparent px-1 py-1 text-[var(--text-meta)] uppercase tracking-[0.12em] text-ink placeholder:text-[var(--color-muted-500)] focus:border-ink focus:outline-none md:w-44"
        />
      </form>
    </search>
  )
}
