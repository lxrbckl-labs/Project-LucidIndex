'use client'

/**
 * SearchInput — top-nav search affordance (Phase 3 rebuild on shadcn).
 *
 * Visual: shadcn `Input` with a leading lucide `Search` icon positioned
 * absolutely inside the input wrapper (standard shadcn pattern). The
 * input gains left padding so text doesn't overlap the icon.
 *
 * All functional behaviour is preserved verbatim:
 *   - Submitting (Enter) navigates to /search?q=<term>.
 *   - 300 ms debounce pushes the URL while the user types.
 *   - Empty query is a no-op.
 *   - On /search, URL replacement (no history spam) + include_archived
 *     flag is preserved on debounce.
 *   - Input rehydrates from ?q= so back-nav restores the value.
 */

import { Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

const DEBOUNCE_MS = 300

export function SearchInput() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Initial value comes from `?q=…` so the input rehydrates to whatever
  // the user typed in the URL — important on /search page reloads.
  const [value, setValue] = useState(() => searchParams.get('q') ?? '')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the input in sync if the user navigates server-side and the
  // URL's `?q=` changes from underneath us (e.g. clicking a saved link).
  useEffect(() => {
    if (pathname === '/search') {
      const fromUrl = searchParams.get('q') ?? ''
      setValue((current) => (current === fromUrl ? current : fromUrl))
    }
  }, [pathname, searchParams])

  const navigateToSearch = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      const params = new URLSearchParams()
      params.set('q', trimmed)
      if (pathname === '/search') {
        const archived = searchParams.get('include_archived')
        if (archived) params.set('include_archived', archived)
      }
      const url = `/search?${params.toString()}`
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

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <search aria-label="Site search">
      <form onSubmit={handleSubmit} data-testid="topnav-search-form">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="topnav-search"
            type="search"
            name="q"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search"
            autoComplete="off"
            data-testid="topnav-search-input"
            className="w-32 pl-8 md:w-44 h-9"
          />
        </div>
      </form>
    </search>
  )
}
