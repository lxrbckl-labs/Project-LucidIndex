'use client'

/**
 * ShareLinkButton — clipboard copy of the absolute article URL (#66).
 *
 * This is a SKELETON for #66. The full UX polish (toast, success
 * feedback timing, fallback flow when `navigator.clipboard` is
 * unavailable) lands in #68. The skeleton is enough to:
 *
 *   - Render the button in the right place visually.
 *   - Copy `window.location.href` to clipboard on click.
 *   - Flip a transient "Copied" label for ~1.5s so the user has at
 *     least the minimum acknowledgment.
 *
 * Why a skeleton instead of waiting on #68: the article page is the
 * share-link target — it should ship with at least a working share
 * affordance even if the polish lands later.
 */

import { useEffect, useState } from 'react'

export function ShareLinkButton() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleClick = async () => {
    if (typeof window === 'undefined') return
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Older browsers / non-secure contexts won't have the clipboard
      // API. #68 will add a textarea-fallback; for now we just no-op
      // visibly so the user knows the action didn't take.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 border border-[var(--color-card-border)] bg-paper px-4 py-2 text-[var(--text-meta)] uppercase tracking-[0.08em] text-ink transition-colors duration-150 hover:border-ink"
      style={{ borderRadius: 'var(--radius-pill)' }}
      data-testid="article-share"
    >
      <span>{copied ? 'Copied' : 'Copy share link'}</span>
    </button>
  )
}
