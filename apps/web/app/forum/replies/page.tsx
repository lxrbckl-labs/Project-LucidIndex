/**
 * Forum → Replies. Placeholder page until the content model lands.
 * When forum_posts ships, this view lists posts authored by the
 * current user that have new replies, ranked by latest reply time.
 * A "NEW" badge on each row indicates replies received since the
 * user last opened the conversation.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Replies — Forum — LucidIndex',
}

export default function RepliesForumPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Replies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversations where someone responded to your posts, newest activity first.
        </p>
      </div>

      {/* Future: list of {parent post + latest reply timestamp + NEW
          badge when unread} ranked by recent activity. */}
    </div>
  )
}
