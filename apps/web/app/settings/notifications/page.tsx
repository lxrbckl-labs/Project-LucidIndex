/**
 * Settings → Notifications — RSC entry + client list.
 *
 * The admin's forum identity (same login session as /forum/account) is
 * the recipient. We server-fetch the first page, then hand the rest
 * off to the client component (`NotificationsPanel`) for trash /
 * mark-read / load-more interactivity.
 *
 * Auth: the settings layout already enforces an admin session. The
 * notifications surface additionally requires a forum-user session
 * (admins are forum users in this single-tenant deployment, but the
 * forum cookie is separate). Missing forum session → an inline empty
 * state nudging the user to sign into the forum first; no redirect,
 * since the admin shell stays usable.
 */

import { requireForumUser } from '@lucidindex/auth'
import type { Metadata } from 'next'
import { NotificationsPanel } from './_components/NotificationsPanel'
import { listNotifications } from './_lib/notifications-repo'

export const metadata: Metadata = {
  title: 'Notifications — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return (
      <div className="flex flex-col gap-8">
        <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mentions of you, and replies to your posts.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sign in to the forum to see your notifications.
        </div>
      </div>
    )
  }

  const initialPage = await listNotifications(session.forumUserId, { limit: 50 })

  return (
    <NotificationsPanel initialItems={initialPage.items} initialCursor={initialPage.next_cursor} />
  )
}
