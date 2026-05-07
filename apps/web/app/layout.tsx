/**
 * Root layout — typography setup.
 *
 * Fonts: **Bebas Neue (display) + Inter (body)**, loaded via `next/font/google`
 * — self-hosted, zero CLS, no Google CDN dependency.
 *
 * The two CSS variables (`--font-display`, `--font-body`) are wired into
 * `globals.css`'s `@theme` block; every component that uses `font-display`
 * or `font-body` utilities inherits them automatically via Tailwind v4.
 */

import type { Metadata, Viewport } from 'next'
import { Bebas_Neue, Inter } from 'next/font/google'
import type { ReactNode } from 'react'
import { ThemeProvider } from '@/components/chrome/ThemeProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
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
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body className="font-body antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
