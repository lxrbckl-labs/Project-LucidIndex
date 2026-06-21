/**
 * Global 404 — rendered by Next.js for any unmatched route in the app.
 *
 * Matches the shared compact-card 404 style (see app/a/[slug]/not-found.tsx and
 * the dashboard empty-state): TopNav + a centered rounded-xl card with a
 * normal-weight heading, muted tagline, and a full-width primary button.
 *
 * The button is context-aware: forum routes (or a forum referer) offer Forum;
 * everything else offers Dashboard, falling back to Dashboard whenever the
 * signal is missing/off-origin. TopNav reads SidebarContext defensively (null
 * when there's no SidebarProvider), so it renders fine standalone here.
 */

import { LayoutDashboard, MessagesSquare } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { TopNav } from '@/components/chrome/TopNav'
import { Button } from '@/components/ui/button'

async function cameFromForum(): Promise<boolean> {
  const h = await headers()

  // Path-based signal first — the URL the user tried to load. Next.js
  // exposes the current path under `next-url` / `x-invoke-path` /
  // `x-pathname` depending on how the request entered the runtime.
  const candidatePaths = [h.get('next-url'), h.get('x-invoke-path'), h.get('x-pathname')]
  for (const p of candidatePaths) {
    if (p?.startsWith('/forum')) return true
  }

  // Otherwise the referer — wherever the user was before they hit this
  // 404. Parse defensively; same-origin paths under /forum count.
  const referer = h.get('referer')
  if (!referer) return false
  try {
    return new URL(referer).pathname.startsWith('/forum')
  } catch {
    return false
  }
}

export default async function NotFound() {
  const forumContext = await cameFromForum()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-background p-6 text-center shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight">Page not found</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            That page didn't make it to the press. It may have been moved, removed, or never
            existed.
          </p>
          {forumContext ? (
            <Button variant="default" asChild className="mt-2 w-full">
              <Link href="/forum">
                <MessagesSquare className="mr-2 h-5 w-5" />
                Forum
              </Link>
            </Button>
          ) : (
            <Button variant="default" asChild className="mt-2 w-full">
              <Link href="/">
                <LayoutDashboard className="mr-2 h-5 w-5 rotate-90" />
                Dashboard
              </Link>
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
