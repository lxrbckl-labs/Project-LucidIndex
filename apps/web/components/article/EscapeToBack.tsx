'use client'

/**
 * EscapeToBack — global Esc handler that calls `router.back()` (#84).
 *
 * Phase 5 rebuild: shadcn `<Button variant="ghost" size="sm">` with lucide
 * `<ChevronLeft>` and "Back" label. Keyboard shortcut (Escape) preserved.
 *
 * Mounted on the article page and creator page. When the user presses Esc,
 * navigates back in browser history. Combined with the dashboard's
 * MasonryKeyboardNav this completes the keyboard contract:
 *
 *   - On the dashboard: Arrow keys move focus across tiles, Enter opens
 *     the focused article (browser default for focused <a>).
 *   - On the article page: Esc returns the user to wherever they came
 *     from (the dashboard, /search, /c/<slug>, etc.) — that's the same
 *     surface as the browser back button.
 *
 * Bails when an input/textarea/contenteditable is focused so Esc
 * doesn't accidentally yank the user out of a form mid-edit. (Article
 * pages don't currently have any forms but this is a cheap guard
 * against future changes.)
 */

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export function EscapeToBack() {
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return

      // Bail when the user is interacting with form controls — Esc
      // typically dismisses native pickers there, and we don't want
      // to compete with that.
      const active = document.activeElement
      if (active instanceof HTMLInputElement) return
      if (active instanceof HTMLTextAreaElement) return
      if (active instanceof HTMLSelectElement) return
      if (active instanceof HTMLElement && active.isContentEditable) return

      e.preventDefault()
      router.back()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router])

  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => router.back()} className="gap-1">
      <ChevronLeft aria-hidden="true" />
      Back
    </Button>
  )
}
