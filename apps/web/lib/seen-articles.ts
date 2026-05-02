/**
 * localStorage helpers for tracking which articles the user has seen (#seen-indicator).
 *
 * All functions guard `typeof window === 'undefined'` so they're safe to import
 * in SSR context — they're no-ops / return empty values when running server-side.
 */

export const STORAGE_KEY = 'lucidindex:seen-articles'

/**
 * Read the current seen-article id set from localStorage.
 * Returns an empty Set in SSR or when localStorage is unavailable/corrupt.
 */
export function getSeenArticles(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed as string[])
  } catch {
    return new Set()
  }
}

/**
 * Add `id` to the seen set and persist it. No-op in SSR.
 */
export function markArticleSeen(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const seen = getSeenArticles()
    seen.add(id)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {
    // localStorage may be disabled (private browsing / quota) — swallow silently.
  }
}

/**
 * Returns true when `id` is present in the seen set. Returns false in SSR.
 */
export function isArticleSeen(id: string): boolean {
  return getSeenArticles().has(id)
}
