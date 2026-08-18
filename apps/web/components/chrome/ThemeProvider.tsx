'use client'

/**
 * Thin client wrapper around next-themes. Lives in /components/chrome
 * so the (server) root layout can include it without colocation noise.
 *
 * Defaults:
 *   - attribute="class" — toggles `.dark` on <html>, matching shadcn's
 *     CSS-variable scheme defined in globals.css.
 *   - defaultTheme="system" — first-visit users get whatever their OS
 *     reports; subsequent visits read localStorage.
 *   - enableSystem — `system` shows up alongside light/dark and tracks
 *     OS-level changes when picked.
 *   - disableTransitionOnChange — kills the 1-frame color flash that
 *     happens when many CSS properties animate simultaneously on theme
 *     swap.
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
