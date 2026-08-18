'use client'

/**
 * Theme toggle — Sun/Moon icon button in the TopNav right cluster.
 *
 * Behavior:
 *   - First click: flips between light and dark explicitly. After the
 *     user expresses a preference once, we stop following the OS — saved
 *     in localStorage by next-themes.
 *   - Renders the icon for the OPPOSITE state ("click for ___"), which
 *     is the canonical convention.
 *   - Hidden until mounted to avoid hydration mismatch (server doesn't
 *     know the resolved theme; first paint would otherwise flash the
 *     wrong icon).
 */

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Pre-mount placeholder keeps the layout stable (same-size button slot)
  // without rendering an icon that might mismatch the resolved theme on
  // hydration.
  if (!mounted) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-hidden="true"
        disabled
      />
    )
  }

  const isDark = resolvedTheme === 'dark'
  const next = isDark ? 'light' : 'dark'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setTheme(next)}
          aria-label={`Switch to ${next} mode`}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
    </Tooltip>
  )
}
