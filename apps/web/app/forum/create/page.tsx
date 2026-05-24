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
import { asc, desc, eq, ne } from '@lucidindex/db/query'
import { forumPosts, forumUsers, topicBadges } from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'
import {
  PostComposer,
  type PostComposerInitialDraft,
  type PostOption,
  type TopicBadgeOption,
  type UserOption,
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

  // Resolve everything in parallel: limits, topics, recent posts (for
  // the citation `@`-dropdown), and (if present) the draft to hydrate
  // from. `getDraftForUser` returns null when the id is bogus /
  // wrong-owner — we silently fall back to a blank composer rather than
  // redirect, so a stale URL doesn't blow up.
  //
  // Recent-posts is capped at 200 most-recent rows by design (per the
  // v1 plan note). The composer filters client-side by title substring,
  // so no search endpoint exists yet. Joining on `forum_users` here so
  // the dropdown can render `<title> — @<author>` rows without a second
  // round-trip.
  const [limits, badgeRows, draftLoaded, recentPostRows, userRows] = await Promise.all([
    getPostingSettings(),
    db
      .select({ id: topicBadges.id, name: topicBadges.name })
      .from(topicBadges)
      .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name)),
    draftId ? getDraftForUser(draftId, session.forumUserId) : Promise.resolve(null),
    db
      .select({
        id: forumPosts.id,
        title: forumPosts.title,
        authorUsername: forumUsers.username,
        authorIsAgent: forumUsers.isAgent,
        createdAt: forumPosts.createdAt,
      })
      .from(forumPosts)
      .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
      .orderBy(desc(forumPosts.createdAt))
      .limit(200),
    // Forum users for the `@<user>` mention dropdown. Excludes the
    // current authoring user — you can't mention yourself. Capped at
    // top-200 by `created_at DESC` to match the recent-posts approach;
    // if/when the user table grows beyond a few hundred, this becomes
    // a search endpoint.
    db
      .select({
        id: forumUsers.id,
        username: forumUsers.username,
        isAgent: forumUsers.isAgent,
      })
      .from(forumUsers)
      .where(ne(forumUsers.id, session.forumUserId))
      .orderBy(desc(forumUsers.createdAt))
      .limit(200),
  ])

  const topicOptions: TopicBadgeOption[] = badgeRows.map((b) => ({
    id: b.id,
    name: b.name,
  }))

  const recentPosts: PostOption[] = recentPostRows.map((r) => ({
    id: r.id,
    title: r.title,
    authorUsername: r.authorUsername,
    authorIsAgent: r.authorIsAgent,
    createdAt: r.createdAt.toISOString(),
  }))

  const users: UserOption[] = userRows.map((u) => ({
    id: u.id,
    username: u.username,
    isAgent: u.isAgent,
  }))

  const initialDraft: PostComposerInitialDraft | null = draftLoaded
    ? {
        id: draftLoaded.draft.id,
        title: draftLoaded.draft.title,
        body: draftLoaded.draft.body,
        topicBadgeIds: draftLoaded.draft.topicBadgeIds,
        coverImageHash: draftLoaded.draft.coverImageHash,
        images: draftLoaded.images,
        citations: draftLoaded.citations.map((c) => ({
          citedPostId: c.citedPostId,
          sequenceNumber: c.sequenceNumber,
          postTitle: c.postTitle,
          authorUsername: c.authorUsername,
        })),
        userMentions: draftLoaded.userMentions.map((m) => ({
          mentionedUserId: m.mentionedUserId,
          mentionedUsername: m.mentionedUsername,
          isAgent: m.isAgent,
        })),
      }
    : null

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
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
        recentPosts={recentPosts}
        users={users}
        initialDraft={initialDraft}
      />
    </div>
  )
}
