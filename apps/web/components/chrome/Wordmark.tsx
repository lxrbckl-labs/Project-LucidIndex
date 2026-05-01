/**
 * Wordmark — the page-spanning "LUCIDINDEX" mark (#55).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * ("page-spanning wordmark") and `Design/main.jpg` (Fyrre cover).
 *
 * Sizing decisions:
 *   - Uses `--text-display-xl` from `globals.css` so the same scale
 *     drives both the public landing wordmark and the authenticated
 *     dashboard wordmark. The token is `clamp(4rem, 12vw, 9rem)` —
 *     it fluidly grows on wider viewports without ever exceeding the
 *     tile-size budget the masonry below it expects.
 *   - All-caps, condensed, ultra-bold. Negative letter-spacing keeps
 *     the wordmark dense — Fyrre style is "tight word, generous air
 *     around it".
 *   - Center-aligned per spec, with generous vertical breathing room
 *     above and below — that whitespace IS the visual emphasis.
 *
 * Pure server component — semantically an `<h1>` so the page has a
 * single, well-formed top-level heading regardless of whether the
 * empty state or the masonry renders below.
 *
 * The inner <Link href="/"> makes the wordmark a home-navigation anchor.
 * The h1 accessible name is derived from its text content (the link text),
 * so getByRole('heading', { name: 'LUCIDINDEX' }) still resolves correctly.
 */

import Link from 'next/link'

type Props = {
  /**
   * Override the size class. The dashboard uses the default
   * `--text-display-xl` scale; secondary pages (e.g. the search route
   * #73) pass a smaller clamp so the wordmark reads as a return-anchor
   * rather than the visual centerpiece.
   */
  className?: string
}

export function Wordmark({ className }: Props = {}) {
  const sizeClass = className ?? 'text-[length:var(--text-display-xl)]'
  return (
    <h1
      className={`font-display ${sizeClass} font-black leading-none tracking-tight text-ink uppercase w-full text-center`}
      style={{ letterSpacing: '-0.02em' }}
    >
      <Link href="/" className="block hover:opacity-80 transition-opacity">
        LUCIDINDEX
      </Link>
    </h1>
  )
}
