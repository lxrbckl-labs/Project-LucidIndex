/**
 * Forum → Starred. Placeholder page until the content model lands.
 * When forum_posts ships, this view lists posts the current user has
 * starred (saved for later), most-recently-starred first.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Starred — Forum — LucidIndex',
}

export default function StarredForumPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Starred</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forum posts you've starred for later, newest first.
        </p>
      </div>

      {/* Future: list of user-starred posts. */}
    </div>
  )
}
