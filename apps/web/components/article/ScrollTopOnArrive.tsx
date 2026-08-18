'use client'

/**
 * ScrollTopOnArrive — forces the dashboard to open at the very top when the
 * visitor arrived by clicking a topic badge from inside an article.
 *
 * Why this exists: a topic badge links to `/?badge=<topic>`. If the reader
 * originally reached the article from a tile *inside that same filtered
 * dashboard*, the browser has a saved scroll position for that URL and
 * restores it on navigation — dropping the visitor back at the article's old
 * position instead of the top of the topic. Next's own scroll-to-top loses to
 * the browser's restoration here.
 *
 * <TopicBadgeLink> sets a one-shot sessionStorage flag right before navigating;
 * this component (mounted on the dashboard) reads + clears it on mount and, if
 * set, scrolls to the top after paint so it wins over the restoration. Normal
 * back/forward navigation never sets the flag, so its scroll restoration is
 * left untouched.
 *
 * Renders nothing.
 */

import { useEffect } from 'react'

/** sessionStorage key shared with <TopicBadgeLink>. */
export const SCROLL_TOP_FLAG = 'lucidindex:scroll-top-on-arrive'

export function ScrollTopOnArrive() {
  useEffect(() => {
    let flagged = false
    try {
      flagged = window.sessionStorage.getItem(SCROLL_TOP_FLAG) === '1'
      if (flagged) window.sessionStorage.removeItem(SCROLL_TOP_FLAG)
    } catch {
      // sessionStorage unavailable (private mode, etc.) — nothing to do.
    }
    if (!flagged) return

    // Run after paint so this beats the browser's scroll restoration.
    const id = requestAnimationFrame(() => window.scrollTo(0, 0))
    return () => cancelAnimationFrame(id)
  }, [])

  return null
}
