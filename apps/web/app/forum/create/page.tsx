/**
 * Forum → Create. Placeholder page until the content model lands.
 * When forum_posts ships, this view becomes the new-post composer
 * (title + body, plain or basic Markdown, submit → /forum/[slug]).
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create — Forum — LucidIndex',
}

export default function CreateForumPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Create</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a new post. Title, body, submit — the rest is conversation.
        </p>
      </div>

      {/* Future: composer form. */}
    </div>
  )
}
