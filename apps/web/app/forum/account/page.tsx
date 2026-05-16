/**
 * Forum → Account.
 *
 * Per-user account surface inside the forum shell. Today the only
 * affordance is the profile-photo uploader; future fields (display
 * name, bio, pronouns) slot in below the photo card.
 *
 * Server resolves the current user + whether they already have an
 * avatar (so the form can show the current photo as a preview), then
 * defers interactivity to the client component.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, isNotNull } from '@lucidindex/db/query'
import { forumUsers } from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AccountAvatarForm } from './AccountAvatarForm'

export const metadata: Metadata = {
  title: 'Account — Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

async function resolveCurrentUser(): Promise<{ username: string; hasAvatar: boolean } | null> {
  const session = await requireForumUser()
  if (!session?.forumUserId) return null
  const rows = await db
    .select({
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
  return { username: row.username, hasAvatar: Boolean(row.hasAvatar) }
}

export default async function ForumAccountPage() {
  const user = await resolveCurrentUser()
  // Belt-and-suspenders: the forum layout's gate handles unauthenticated
  // access, but if some edge case bypasses that we still don't want to
  // render the account page without a user.
  if (!user) redirect('/forum')

  return (
    <div className="max-w-[640px] flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage how you appear in the forum.</p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Profile photo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shown next to your posts and replies. PNG, JPEG, or WebP. Max 2 MB.
          </p>
        </div>
        <AccountAvatarForm username={user.username} hasAvatar={user.hasAvatar} />
      </section>
    </div>
  )
}
