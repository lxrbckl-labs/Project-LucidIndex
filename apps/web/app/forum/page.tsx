/**
 * Forum — overview / landing page.
 *
 * The forum shell (TopNav + sidebar + auth gating) lives in
 * `apps/web/app/forum/layout.tsx`. This page is just the content for
 * `/forum`, surfaced inside the SidebarInset when the user is signed
 * in and rendered blurred behind the gate when they're not.
 *
 * Visual pattern matches the settings overview: an edge-to-edge title
 * band followed by future overview content.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Forum — LucidIndex',
}

export default function ForumPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Forum</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discussions, threads, and replies between forum users.
        </p>
      </div>

      {/* Future overview content (recent threads, pinned items, etc.) lands
          below the title band. */}
    </div>
  )
}
