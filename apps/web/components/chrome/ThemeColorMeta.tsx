'use client'

/**
 * Keeps the browser UI tint (`<meta name="theme-color">`, used by Safari's
 * toolbar, mobile Chrome's address bar, etc.) in lockstep with the *resolved*
 * app theme — including a manual light/dark toggle that diverges from the OS.
 *
 * The root layout also declares static `prefers-color-scheme` theme-colors via
 * `viewport.themeColor`; those are correct at SSR / for the default `system`
 * theme. This component refines them after hydration: it writes the resolved
 * color into every theme-color meta, so whichever one the browser honors shows
 * the app's actual background — not just whatever the OS prefers.
 *
 * Colors mirror `--background` in globals.css: dark = #1e1e1e (0 0% 11.8%,
 * Safari-chrome black), light = #f8f6f2 (40 27% 96%). Keep these in sync if
 * that token changes.
 */

import { useTheme } from 'next-themes'
import { useEffect } from 'react'

const THEME_COLORS = { dark: '#1e1e1e', light: '#f8f6f2' } as const

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (resolvedTheme !== 'dark' && resolvedTheme !== 'light') return
    const color = THEME_COLORS[resolvedTheme]
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    if (metas.length === 0) {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      meta.setAttribute('content', color)
      document.head.appendChild(meta)
      return
    }
    // Write the resolved color into all of them so the browser's choice
    // (media-matched or not) always lands on the app's real background.
    for (const meta of metas) meta.setAttribute('content', color)
  }, [resolvedTheme])

  return null
}
