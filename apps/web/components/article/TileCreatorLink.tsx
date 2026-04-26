/**
 * TileCreatorLink — creator attribution in article tiles (#71).
 *
 * Renders the creator's name as a clickable element that navigates to
 * `/c/<slug>`. Lives inside a card that is itself a full-tile <Link>,
 * so we must prevent the tile navigation from firing when the creator
 * name is clicked. This mirrors the `TileShareButton` approach — a
 * client component with `stopPropagation` + `preventDefault`, then
 * `router.push` for the actual navigation.
 *
 * Renders as plain text when `creatorSlug` is null (target hasn't been
 * lazy-backfilled yet — rare in practice but defensive).
 */

'use client'

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
    return <span className={className}>{creatorLabel}</span>
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
      className={`cursor-pointer underline-offset-4 hover:underline ${className ?? ''}`}
    >
      {creatorLabel}
    </button>
  )
}
