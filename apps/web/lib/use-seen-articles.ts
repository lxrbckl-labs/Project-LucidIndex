'use client'

/**
 * React hook for reading and writing the seen-articles state.
 *
 * Initialized with an empty Set so SSR + first-client-render match
 * (avoids hydration mismatch). The `useEffect` hydrates from localStorage
 * on mount so subsequent renders reflect any previously seen articles.
 */

import { useCallback, useEffect, useState } from 'react'
import { getSeenArticles, markArticleSeen } from './seen-articles'

export function useSeenArticles(): { seen: Set<string>; markSeen: (id: string) => void } {
  // Start empty — must match the SSR render to avoid hydration mismatch.
  const [seen, setSeen] = useState<Set<string>>(new Set())

  // Hydrate from localStorage after mount.
  useEffect(() => {
    setSeen(getSeenArticles())
  }, [])

  const markSeen = useCallback((id: string) => {
    markArticleSeen(id)
    setSeen((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  return { seen, markSeen }
}
