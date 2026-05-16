/**
 * Forum → Top. Placeholder page until the content model lands; shares
 * the title-band visual pattern with the Forum overview and the
 * settings sub-pages.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Top — Forum — LucidIndex',
}

export default function TopForumPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Top</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Highest-engagement posts in the forum, all-time.
        </p>
      </div>

      {/* Future: top-feed content. */}
    </div>
  )
}
