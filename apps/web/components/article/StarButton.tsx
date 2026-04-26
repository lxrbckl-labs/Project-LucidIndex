'use client'

/**
 * StarButton — client wrapper that renders the star toggle on the
 * article page (#66).
 *
 * Optimistic UI: on click we flip the local state immediately, then
 * fire the server action. If the action throws we revert. Star state
 * is visually small (a single icon swap) so the optimistic path is
 * the right default — a network blip shouldn't block the
 * "you starred this" feedback.
 *
 * Authorization: the parent server component decides whether to render
 * this button at all. When no admin session is present, the parent
 * passes `disabled` so the button renders as a non-interactive icon
 * (the page still has to communicate "this exists" to public visitors,
 * since they ARE allowed to read but not star).
 */

import { useState, useTransition } from 'react'
import { toggleStar } from '@/app/a/[slug]/actions'

type Props = {
  articleId: string
  slug: string
  initialStarred: boolean
  /** True when no admin session is present — render visible-but-inert. */
  disabled?: boolean
}

export function StarButton({ articleId, slug, initialStarred, disabled = false }: Props) {
  const [starred, setStarred] = useState(initialStarred)
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    if (disabled) return
    const next = !starred
    setStarred(next) // optimistic flip
    startTransition(async () => {
      try {
        await toggleStar(articleId, slug)
      } catch {
        // Revert on failure. Real failures are rare (admin-only action
        // gated to the same origin); the revert keeps the UI honest if
        // the server rejects the call for any reason.
        setStarred(!next)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isPending}
      aria-pressed={starred}
      aria-label={starred ? 'Remove star' : 'Star this article'}
      // Phase 8 #83 — tap-friendly: min-h-[44px] meets the 44×44 WCAG
      // target-size recommendation on mobile. Phase 8 #85 — the global
      // :focus-visible ring (1px ink outline + 2px offset) handles
      // focus visibility; no rounded-blue browser default.
      className={`inline-flex min-h-[44px] items-center gap-2 border border-[var(--color-card-border)] bg-paper px-4 py-2 text-[var(--text-meta)] uppercase tracking-[0.08em] transition-colors duration-150 ${
        disabled
          ? 'cursor-not-allowed text-[var(--color-muted-500)]'
          : 'cursor-pointer text-ink hover:border-ink'
      }`}
      style={{ borderRadius: 'var(--radius-pill)' }}
      data-testid="article-star"
    >
      {/* Inline SVG to keep the asset surface tiny — the star is the
          only icon on the page. Filled when starred, hairline-only when
          not, so the change reads at a glance even at small size. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill={starred ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        <path d="M12 2.5l3.09 6.26 6.91 1L17 14.62l1.18 6.88L12 18.27l-6.18 3.23L7 14.62 2 9.76l6.91-1L12 2.5z" />
      </svg>
      <span>{starred ? 'Starred' : 'Star'}</span>
    </button>
  )
}
