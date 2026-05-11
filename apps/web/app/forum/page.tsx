/**
 * Forum — placeholder for the upcoming feature.
 *
 * Renders the standard TopNav so the chrome (wordmark, search, settings,
 * forum trigger on dashboard) stays consistent across the app. Body is
 * intentionally empty — phases will fill it in.
 *
 * Auth: reads the forum session server-side and passes the resolved
 * username (or null) to ForumGate. When signed in, the gate steps
 * aside and the placeholder content shows un-blurred.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { forumUsers } from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { TopNav } from '@/components/chrome/TopNav'
import { ForumGate } from './_components/ForumGate'

export const metadata: Metadata = {
  title: 'Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

async function resolveForumUsername(): Promise<string | null> {
  const session = await getForumSession()
  if (!session.forumUserId) return null
  const rows = await db
    .select({ username: forumUsers.username })
    .from(forumUsers)
    .where(eq(forumUsers.id, session.forumUserId))
    .limit(1)
  return rows[0]?.username ?? null
}

export default async function ForumPage() {
  const username = await resolveForumUsername()

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <TopNav />
      <main className="flex-1 overflow-hidden px-4 pt-4">
        <ForumGate username={username}>
          {/* Phase B placeholder — fills with real forum content in later phases. */}
          <div className="flex flex-col gap-4 max-w-3xl mx-auto">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
            <div className="h-4 w-4/6 rounded bg-muted" />
            <div className="mt-6 h-32 w-full rounded-lg bg-muted" />
            <div className="h-32 w-full rounded-lg bg-muted" />
          </div>
        </ForumGate>
      </main>
    </div>
  )
}
