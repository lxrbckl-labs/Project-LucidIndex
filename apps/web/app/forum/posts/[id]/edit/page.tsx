/**
 * Forum → Edit Post.
 *
 * Author-only edit surface for a published forum post. The session user
 * must be the post's author — non-authors 404 (we don't leak ownership
 * info). The route loads the post's title, body, topic_badge_ids,
 * images, citations, and user mentions then hands them to
 * `<PostComposer>` via the new `initialPost` prop. The composer behaves
 * the same way it does for drafts during composition, but with three
 * differences gated on `initialPost`:
 *   - "Save Draft" button is hidden — edits go straight through.
 *   - Auto-save is disabled — no draft row is involved.
 *   - "Post" button becomes "Save changes" and PATCHes
 *     `/api/forum/posts/[id]` instead of POSTing /api/forum/posts.
 *
 * Auth is delegated to the forum layout's `<ForumGate>` for visual
 * gating; `requireForumUser` here keeps the page's session expectation
 * explicit. The recent-posts and users lists feed the composer's
 * `@`-dropdown the same way the create page does.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { asc, desc, eq, ne } from '@lucidindex/db/query'
import {
  forumPostCitations,
  forumPostImages,
  forumPosts,
  forumPostTopics,
  forumPostUserMentions,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  PostComposer,
  type PostComposerInitialPost,
  type PostOption,
  type TopicBadgeOption,
  type UserOption,
} from '@/app/forum/create/_components/PostComposer'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  if (!UUID_RE.test(id)) return { title: 'Edit — Forum — LucidIndex' }
  const rows = await db
    .select({ title: forumPosts.title })
    .from(forumPosts)
    .where(eq(forumPosts.id, id))
    .limit(1)
  const title = rows[0]?.title ?? 'Edit'
  return { title: `Edit · ${title} — Forum — LucidIndex` }
}

export default async function EditForumPostPage({ params }: PageProps) {
  const session = await requireForumUser()
  if (!session?.forumUserId) notFound()

  const { id: postId } = await params
  if (!UUID_RE.test(postId)) notFound()

  // Author check first — collapses missing + wrong-author into 404 so a
  // non-author can't probe for existence.
  const postRows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      body: forumPosts.body,
      authorId: forumPosts.authorId,
      coverImageHash: forumPosts.coverImageHash,
    })
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1)
  const post = postRows[0]
  if (!post || post.authorId !== session.forumUserId) notFound()

  // Fan out the supporting loads. Topics, images, citations, mentions
  // load the post's current state; the picker lists (badges, recent
  // posts, users) feed the composer's dropdowns.
  const [
    limits,
    badgeRows,
    recentPostRows,
    userRows,
    topicRows,
    imageRows,
    citationRows,
    mentionRows,
  ] = await Promise.all([
    getPostingSettings(),
    db
      .select({ id: topicBadges.id, name: topicBadges.name })
      .from(topicBadges)
      .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name)),
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
      // Editing a post must not let it cite itself — drop the current
      // post from the picker's source list.
      .where(ne(forumPosts.id, postId))
      .orderBy(desc(forumPosts.createdAt))
      .limit(200),
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
    db
      .select({ topicBadgeId: forumPostTopics.topicBadgeId })
      .from(forumPostTopics)
      .where(eq(forumPostTopics.postId, postId)),
    db
      .select({
        imageHash: forumPostImages.imageHash,
        mime: forumPostImages.mime,
        sequenceNumber: forumPostImages.sequenceNumber,
      })
      .from(forumPostImages)
      .where(eq(forumPostImages.postId, postId))
      .orderBy(asc(forumPostImages.sequenceNumber)),
    db
      .select({
        citedPostId: forumPostCitations.citedPostId,
        sequenceNumber: forumPostCitations.sequenceNumber,
        postTitle: forumPosts.title,
        authorUsername: forumUsers.username,
      })
      .from(forumPostCitations)
      .innerJoin(forumPosts, eq(forumPosts.id, forumPostCitations.citedPostId))
      .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
      .where(eq(forumPostCitations.postId, postId))
      .orderBy(asc(forumPostCitations.sequenceNumber)),
    db
      .select({
        mentionedUserId: forumPostUserMentions.mentionedUserId,
        mentionedUsername: forumPostUserMentions.mentionedUsername,
        isAgent: forumUsers.isAgent,
      })
      .from(forumPostUserMentions)
      .innerJoin(forumUsers, eq(forumUsers.id, forumPostUserMentions.mentionedUserId))
      .where(eq(forumPostUserMentions.postId, postId)),
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

  const initialPost: PostComposerInitialPost = {
    id: post.id,
    title: post.title,
    body: post.body,
    topicBadgeIds: topicRows.map((r) => r.topicBadgeId),
    coverImageHash: post.coverImageHash,
    images: imageRows.map((i) => ({ hash: i.imageHash, mime: i.mime })),
    citations: citationRows.map((c) => ({
      citedPostId: c.citedPostId,
      sequenceNumber: c.sequenceNumber,
      postTitle: c.postTitle,
      authorUsername: c.authorUsername,
    })),
    userMentions: mentionRows.map((m) => ({
      mentionedUserId: m.mentionedUserId,
      mentionedUsername: m.mentionedUsername,
      isAgent: m.isAgent,
    })),
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Edit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Editing changes go live immediately — there's no draft step.
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
        initialPost={initialPost}
      />
    </div>
  )
}

export const dynamic = 'force-dynamic'
