/**
 * Forum → Create.
 *
 * RSC that loads the four configurable post limits + the curated topic
 * badges and hands them to the client-side `<PostComposer>`. Auth is
 * handled one level up by `apps/web/app/forum/layout.tsx` — when there's
 * no forum session the layout swaps in the `<ForumGate>` overlay and
 * never reaches this page's children. The redirect below is a
 * belt-and-suspenders guard in case an edge case bypasses the layout
 * gate.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { asc } from '@lucidindex/db/query'
import { topicBadges } from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'
import {
  PostComposer,
  type PostComposerInitialDraft,
  type TopicBadgeOption,
} from './_components/PostComposer'
import { getDraftForUser } from './_lib/drafts-repo'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: 'Create — Forum — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default async function CreateForumPage({
  searchParams,
}: {
  // Next.js 15: searchParams is a Promise in route props.
  searchParams: Promise<{ draft?: string | string[] }>
}) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    redirect('/forum')
  }

  const params = await searchParams
  const rawDraft = params.draft
  const draftId = typeof rawDraft === 'string' && UUID_RE.test(rawDraft) ? rawDraft : null

  // Resolve everything in parallel: limits, topics, and (if present) the
  // draft to hydrate from. `getDraftForUser` returns null when the id
  // is bogus / wrong-owner — we silently fall back to a blank composer
  // rather than redirect, so a stale URL doesn't blow up.
  const [limits, badgeRows, draftLoaded] = await Promise.all([
    getPostingSettings(),
    db
      .select({ id: topicBadges.id, name: topicBadges.name })
      .from(topicBadges)
      .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name)),
    draftId ? getDraftForUser(draftId, session.forumUserId) : Promise.resolve(null),
  ])

  const topicOptions: TopicBadgeOption[] = badgeRows.map((b) => ({
    id: b.id,
    name: b.name,
  }))

  const initialDraft: PostComposerInitialDraft | null = draftLoaded
    ? {
        id: draftLoaded.draft.id,
        title: draftLoaded.draft.title,
        body: draftLoaded.draft.body,
        topicBadgeIds: draftLoaded.draft.topicBadgeIds,
        images: draftLoaded.images,
      }
    : null

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Create</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Title, body, optional topics, optional images. Submit when ready.
        </p>
      </div>

      <PostComposer
        limits={{
          maxTitleChars: limits.maxTitleChars,
          maxBodyChars: limits.maxBodyChars,
          maxTopicsPerPost: limits.maxTopicsPerPost,
          maxImagesPerPost: limits.maxImagesPerPost,
        }}
        topicBadges={topicOptions}
        initialDraft={initialDraft}
      />
    </div>
  )
}
