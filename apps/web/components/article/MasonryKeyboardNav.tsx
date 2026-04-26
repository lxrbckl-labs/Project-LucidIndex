'use client'

/**
 * MasonryKeyboardNav — keyboard navigation across dashboard tiles (#84).
 *
 * Mounted alongside <ArticleMasonry/> by the dashboard route. Renders
 * nothing visible — its sole job is to attach a window-level keydown
 * handler that walks focus across tiles by querying the DOM for
 * elements with `data-masonry-tile`. Pulling the handler into a separate
 * client component lets ArticleMasonry / ArticleCard / LargeArticleCard
 * stay pure server components, which keeps server-only env vars
 * (e.g. WEBAUTHN_ORIGIN baked into BASE_URL) resolving correctly.
 *
 * Behavior:
 *
 *   - Arrow keys (←↑→↓): walk focus across tiles. Linear walk over the
 *     `data-masonry-tile` query result, in DOM order.
 *       ←/↑  → previous tile (clamped at index 0)
 *       →/↓  → next tile (clamped at last index)
 *     The masonry's irregular row sizes make a "true" 2D arrow-walk
 *     infeasible, so we use a simple linear walk — standard treatment
 *     for masonry-style article grids.
 *   - Enter on a focused tile is handled by the browser default
 *     (the underlying <a> activates).
 *   - Esc on the dashboard does nothing (the article page handles its
 *     own back navigation).
 *
 * Guard: the handler bails unless the currently-focused element is one
 * of our tiles. This keeps arrow keys from being hijacked elsewhere on
 * the page (e.g. while typing in the search input or scrubbing through
 * filter pills).
 *
 * v0.1: focus-on-return-from-article is NOT preserved. After visiting
 * an article and pressing Esc to come back, the dashboard re-mounts
 * with focus reset. Pressing Tab re-enters the masonry from the top.
 * A future iteration could persist the focused tile id in
 * sessionStorage and restore it on mount — out of scope here.
 */

import { useEffect } from 'react'

export function MasonryKeyboardNav() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Only handle arrow keys.
      const isArrow =
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      if (!isArrow) return

      // Bail unless the focused element is a tile. We don't want arrow
      // keys hijacked elsewhere on the page (e.g. while typing in the
      // search input).
      const active = document.activeElement
      if (!active || !(active instanceof HTMLElement)) return
      if (!active.matches('[data-masonry-tile]')) return

      // Enumerate tiles in DOM order. Re-querying on each keypress is
      // cheap (≤24 tiles per dashboard render in practice) and keeps
      // the handler resilient to live SSE-driven masonry updates.
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-masonry-tile]'))
      const idx = tiles.indexOf(active)
      if (idx < 0) return

      let nextIdx: number
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIdx = Math.min(idx + 1, tiles.length - 1)
      } else {
        nextIdx = Math.max(idx - 1, 0)
      }
      if (nextIdx === idx) return

      e.preventDefault()
      const target = tiles[nextIdx]
      if (target) {
        target.focus()
        // Scroll into view if the next tile is off-screen; nearest keeps
        // the page from jumping when the tile is already visible.
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
