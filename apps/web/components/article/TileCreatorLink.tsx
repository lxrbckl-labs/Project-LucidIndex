'use client'

/**
 * TileCreatorLink — creator attribution in article tiles (#71).
 *
 * Phase 4 rebuild: shadcn typography (text-xs font-medium hover:underline).
 * Still a client component so stopPropagation + router.push work inside
 * the full-tile <Link> wrapper.
 *
 * Renders as plain text when `creatorSlug` is null.
 */

import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'

type Props = {
  creatorLabel: string
  creatorSlug: string | null | undefined
  className?: string
}

export function TileCreatorLink({ creatorLabel, creatorSlug, className }: Props) {
  const router = useRouter()

  if (!creatorSlug) {
    return (
      <span className={`text-xs font-medium text-foreground ${className ?? ''}`}>
        {creatorLabel}
      </span>
    )
  }

  function handleClick(e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    router.push(`/c/${creatorSlug}`)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-xs font-medium text-foreground hover:underline underline-offset-4 cursor-pointer ${className ?? ''}`}
    >
      {creatorLabel}
    </button>
  )
}
