/**
 * Forum shell layout.
 *
 * Two branches based on the server-resolved forum session:
 *   - Unauthenticated → centered ForumGate overlay on top of the
 *     blurred page content. Behaves the way the old single-page
 *     /forum did.
 *   - Authenticated  → shadcn SidebarProvider + ForumSidebar + inset
 *     wrapping `{children}` — same chrome as the settings shell so
 *     the muscle memory between the two surfaces matches.
 *
 * Auth surfaces (the gate panes) render WITHOUT the sidebar; once the
 * session cookie is minted, the page reloads and lands on the sidebar
 * variant.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, isNotNull } from '@lucidindex/db/query'
import { forumUsers } from '@lucidindex/db/schema'
import type { ReactNode } from 'react'
import { TopNav } from '@/components/chrome/TopNav'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ForumGate } from './_components/ForumGate'
import { ForumSidebar, type SidebarDraft } from './_components/ForumSidebar'
import { listDraftsForUser } from './create/_lib/drafts-repo'

export const dynamic = 'force-dynamic'

type ResolvedForumUser = { id: string; username: string; hasAvatar: boolean }

async function resolveForumUser(): Promise<ResolvedForumUser | null> {
  const session = await getForumSession()
  if (!session.forumUserId) return null
  const rows = await db
    .select({
      id: forumUsers.id,
      username: forumUsers.username,
      hasAvatar: isNotNull(forumUsers.avatarData),
    })
    .from(forumUsers)
    .where(eq(forumUsers.id, session.forumUserId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  // drizzle types `isNotNull` as a raw SQL expression (unknown) in a
  // SELECT projection — coerce here so the return is a clean boolean.
  return { id: row.id, username: row.username, hasAvatar: Boolean(row.hasAvatar) }
}

export default async function ForumLayout({ children }: { children: ReactNode }) {
  const user = await resolveForumUser()
  const username = user?.username ?? null

  if (!username) {
    // Unauthenticated: gate overlay covers the forum surface. The
    // children render blurred behind the gate (preserves the old
    // single-page behavior).
    return (
      <div className="h-screen overflow-hidden bg-background flex flex-col">
        <TopNav />
        <main className="flex-1 overflow-hidden px-4 pt-4">
          <ForumGate username={null}>{children}</ForumGate>
        </main>
      </div>
    )
  }

  // Drafts are loaded server-side here so the sidebar's "Drafts" group
  // appears on first paint with no client-side fetch. Updated_at is
  // serialized to ISO for the client boundary.
  const draftRows = user ? await listDraftsForUser(user.id) : []
  const drafts: SidebarDraft[] = draftRows.map((d) => ({
    id: d.id,
    title: d.title,
    updatedAt: d.updatedAt.toISOString(),
  }))

  // Authenticated: full sidebar shell, identical structural pattern to
  // the settings shell.
  return (
    <SidebarProvider>
      <div className="flex w-full flex-col">
        <TopNav />
        <div className="flex flex-1">
          <ForumSidebar username={username} hasAvatar={user?.hasAvatar ?? false} drafts={drafts} />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-4 p-6">{children}</div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
