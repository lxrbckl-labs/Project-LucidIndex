/**
 * Root layout — wires the Phase 5 typography (#54).
 *
 * Final pick: **Bebas Neue (display) + Inter (body)**.
 *
 * Why these (decided against Archivo Black + Inter and Anton + DM Sans —
 * see the #54 PR body for the side-by-side comparison and the read of
 * `<vault>/Projects/Project-LucidIndex/Design/main.jpg`):
 *
 *   - **Bebas Neue** is the closest free Google Fonts approximation of
 *     the Fyrre Magazine cover wordmark — condensed, all-caps by nature,
 *     heavy verticals, very tight rhythm. It also reads convincingly as
 *     a card-title display sans at 18-22px.
 *   - **Inter** is the workhorse body sans the Visual Identity spec
 *     calls out by name (`Visual Identity.md` line 68). Variable font,
 *     widest-deployed editorial sans, pairs cleanly with a condensed
 *     display face without competing for attention.
 *
 * Both are loaded via `next/font/google` — self-hosted, zero CLS, no
 * runtime call to fonts.googleapis.com (privacy + offline-friendly per
 * the spec's "Self-host all fonts via `next/font` — zero CLS, no Google
 * CDN dependency" rule).
 *
 * `display: 'swap'` — render with the system fallback while the font
 * loads so first paint is never blocked. The Visual Identity spec's
 * type scale was sized against the system stack, so the swap looks
 * coherent during the brief unload window.
 *
 * The two CSS variables (`--font-display`, `--font-body`) are wired into
 * `globals.css`'s `@theme` block as the source-of-truth tokens; every
 * component that uses `text-display-*` or default body type inherits
 * them automatically via Tailwind v4's auto-utility generation.
 */

import type { Metadata, Viewport } from 'next'
import { Bebas_Neue, Inter } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// Display face — the page-spanning LUCIDINDEX wordmark + card titles.
// Bebas Neue ships as a single-weight (400) family; that's enough — the
// wordmark uses font-weight inheritance from the family's bold drawing,
// and weight variation isn't part of the type scale at the display end.
//
// Note: the CSS variable name is `--font-display-src` (not `--font-display`)
// because Tailwind v4's `@theme` block in `globals.css` defines a token
// also called `--font-display` to drive the `font-display` utility. Using
// distinct names prevents the recursive `var(--font-display)` self-reference
// that would otherwise occur.
const display = Bebas_Neue({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400'],
  variable: '--font-display-src',
})

// Body face — Inter variable, all weights available so card summary,
// muted byline copy, and pill labels all draw from the same family.
const body = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body-src',
})

export const metadata: Metadata = {
  title: 'LucidIndex',
  description: 'A single-admin personal intelligence magazine.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  )
}
