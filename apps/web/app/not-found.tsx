/**
 * Global 404 — rendered by Next.js for any unmatched route in the app.
 *
 * Standalone (no TopNav) to avoid SidebarProvider-context dependencies
 * when this page is hit at a /settings/* path that didn't match a route.
 *
 * The redirect button is context-aware: if the user was last on the
 * forum (Referer header starts with /forum, or the missing route itself
 * is under /forum), it offers Forum; otherwise Dashboard. Falls back to
 * Dashboard whenever the referer is missing, malformed, or off-origin.
 */

import { LayoutDashboard, MessagesSquare } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

async function cameFromForum(): Promise<boolean> {
  const h = await headers()

  // Path-based signal first — the URL the user tried to load. Next.js
  // exposes the current path under `next-url` / `x-invoke-path` /
  // `x-pathname` depending on how the request entered the runtime.
  const candidatePaths = [h.get('next-url'), h.get('x-invoke-path'), h.get('x-pathname')]
  for (const p of candidatePaths) {
    if (p && p.startsWith('/forum')) return true
  }

  // Otherwise the referer — wherever the user was before they hit this
  // 404. Parse defensively; same-origin paths under /forum count.
  const referer = h.get('referer')
  if (!referer) return false
  try {
    const url = new URL(referer)
    return url.pathname.startsWith('/forum')
  } catch {
    return false
  }
}

export default async function NotFound() {
  const forumContext = await cameFromForum()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-24">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            LUCIDINDEX
          </p>
          <CardTitle className="text-3xl font-bold tracking-tight">404</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          <p className="max-w-[360px] text-sm leading-relaxed text-muted-foreground">
            That page didn't make it to the press. It may have been moved, removed, or never
            existed.
          </p>
          {forumContext ? (
            <Button asChild>
              <Link href="/forum">
                Forum
                <MessagesSquare className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/">
                Dashboard
                <LayoutDashboard className="ml-2 h-4 w-4 rotate-90" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
