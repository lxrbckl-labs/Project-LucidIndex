'use client'

/**
 * TileShareButton — compact "share" affordance for dashboard article tiles (#68).
 *
 * Design rules:
 *   - Small, unobtrusive — does NOT dominate the tile.
 *   - Hairline border, opacity transition on hover. Editorial vibe.
 *   - On click: copies the article URL to clipboard + shows "Copied!" for ~1.5s.
 *   - MUST NOT trigger the tile's <Link> navigation — uses
 *     event.stopPropagation() + event.preventDefault().
 *
 * Two variants:
 *   - "light" (default) — hairline border on paper/light background.
 *   - "dark"            — paper-toned border/text for overlay-on-image tiles.
 */

import { useEffect, useState } from 'react'

type Props = {
  /** Absolute URL of the article to share (e.g. `${baseUrl}/a/${slug}`). */
  url: string
  /**
   * Visual variant:
   *   - "light" — renders on light (paper) backgrounds (ArticleCard default).
   *   - "dark"  — renders on dark/image overlay backgrounds (LargeArticleCard).
   */
  variant?: 'light' | 'dark'
}

/** execCommand fallback for environments without `navigator.clipboard`. */
function copyViaTextarea(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function TileShareButton({ url, variant = 'light' }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleClick = async (e: React.MouseEvent) => {
    // Stop the event bubbling up to the parent <Link> so clicking Share
    // does not navigate to the article page.
    e.stopPropagation()
    e.preventDefault()

    if (typeof window === 'undefined') return
    let ok = false
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url)
        ok = true
      } catch {
        ok = copyViaTextarea(url)
      }
    } else {
      ok = copyViaTextarea(url)
    }
    if (ok) setCopied(true)
  }

  const variantClass =
    variant === 'dark'
      ? 'border-paper/50 text-paper/70 hover:border-paper hover:text-paper'
      : 'border-[var(--color-card-border)] text-[var(--color-muted-700)] hover:border-ink hover:text-ink'

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? 'Link copied' : 'Copy share link'}
      data-testid="tile-share"
      className={`inline-flex items-center px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em] border opacity-60 transition-all duration-150 hover:opacity-100 ${variantClass}`}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {copied ? 'Copied!' : 'Share'}
    </button>
  )
}
