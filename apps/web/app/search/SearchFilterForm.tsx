'use client'

/**
 * SearchFilterForm — client component for the search page's query input
 * and "Include archived" checkbox (Phase 6 shadcn rebuild).
 *
 * Uses shadcn Input + Checkbox + Label. Submits via router.push so the
 * URL params are updated without a full page reload, keeping consistent
 * with the TopNav SearchInput behaviour.
 *
 * The `include_archived` param is written as `?include_archived=1` when
 * checked (preserving the existing URL contract).
 */

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  /** The current query string from the URL. */
  query: string
  /** Whether `?include_archived=1` is currently set. */
  includeArchived: boolean
}

export function SearchFilterForm({ query, includeArchived }: Props) {
  const router = useRouter()
  const [localQuery, setLocalQuery] = useState(query)
  const [localArchived, setLocalArchived] = useState(includeArchived)

  // Keep local state in sync if the parent re-renders with new URL params
  // (e.g. browser back / forward navigation).
  useEffect(() => {
    setLocalQuery(query)
  }, [query])

  useEffect(() => {
    setLocalArchived(includeArchived)
  }, [includeArchived])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = useCallback(
    (q: string, archived: boolean) => {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (archived) params.set('include_archived', '1')
      const url = `/search${params.toString() ? `?${params.toString()}` : ''}`
      router.push(url)
    },
    [router],
  )

  function handleQueryChange(next: string) {
    setLocalQuery(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => navigate(next, localArchived), 300)
  }

  function handleArchivedChange(checked: boolean) {
    setLocalArchived(checked)
    // Archived toggle fires immediately — no debounce needed.
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    navigate(localQuery, checked)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    navigate(localQuery, localArchived)
  }

  // Cleanup debounce on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <search aria-label="Article search">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-center gap-4"
        data-testid="search-form"
      >
        {/* Query input with search icon */}
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="search-q"
            type="search"
            name="q"
            value={localQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search articles…"
            autoComplete="off"
            className="pl-9 h-11 text-base"
            data-testid="search-page-input"
          />
        </div>

        {/* Include archived toggle */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-archived"
            checked={localArchived}
            onCheckedChange={(state) => handleArchivedChange(state === true)}
            data-testid="include-archived-checkbox"
          />
          <Label htmlFor="include-archived" className="cursor-pointer text-sm font-normal">
            Include archived
          </Label>
        </div>

        {/* Hidden submit — Enter key still works; visually the Input handles it */}
        <Button type="submit" variant="outline" size="sm" className="shrink-0">
          Search
        </Button>
      </form>
    </search>
  )
}
