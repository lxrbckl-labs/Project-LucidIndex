/**
 * Wordmark — brand mark for the LUCIDINDEX header.
 *
 * Phase 3 rebuild: shadcn-aesthetic. Replaced the Fyrre editorial
 * display treatment (--text-display-xl, ultra-bold, negative
 * letter-spacing) with a clean app-header wordmark:
 *   text-xl font-semibold tracking-wider uppercase
 *
 * When used in the TopNav the default sizing applies.
 * Secondary pages (e.g. /search) can pass `className` to override
 * size — the text-size class is applied directly to the <h1>.
 *
 * Semantically still an <h1>; still wraps a Next <Link href="/">
 * so the wordmark doubles as a home anchor.
 */

import Link from 'next/link'
import { cn } from '@/lib/utils'

type Props = {
  /**
   * Override the default size / weight / spacing. Secondary-page callers
   * (e.g. /search) pass a smaller size so the wordmark reads as a
   * return-anchor rather than the visual centrepiece.
   */
  className?: string
}

export function Wordmark({ className }: Props = {}) {
  return (
    <h1 className={cn('text-xl font-semibold uppercase tracking-wider text-foreground', className)}>
      <Link href="/" className="hover:opacity-80 transition-opacity">
        LUCIDINDEX
      </Link>
    </h1>
  )
}
