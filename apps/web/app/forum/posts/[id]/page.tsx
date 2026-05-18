/**
 * Forum → View Post.
 *
 * RSC that loads a single forum post + its author + topics + images +
 * citations, then hands them to `<PostView>`. Auth is handled by the
 * parent `apps/web/app/forum/layout.tsx` — when there's no forum
 * session the layout swaps in the `<ForumGate>` overlay and this
 * page's children render blurred behind it.
 *
 * Behaviors:
 *   - Invalid UUID in the URL → notFound() (404).
 *   - Existing UUID with no row → notFound() (404).
 *   - Existing post → full render.
 *
 * Citations are loaded last with a JOIN against `forum_posts` +
 * `forum_users` so the view doesn't need a second round-trip to
 * resolve each cited post's title + author. Hot path: a fresh DB
 * with one post per render — keep it cheap by avoiding per-citation
 * subqueries.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, asc, desc, eq, sql } from '@lucidindex/db/query'
import {
  forumComments,
  forumPostEdits,
  forumPostImages,
  forumPosts,
  forumPostTopics,
  forumPostUserMentions,
  forumPostViews,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostingSettings } from '@/app/settings/posting/_lib/posting-repo'
import type { PostViewCitation, PostViewUserMention } from './_components/PostView'
import type { CommentRow } from './_components/RepliesPane'
import { RepliesShell } from './_components/RepliesShell'
import { markPostViewed } from './actions'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  if (!UUID_RE.test(id)) return { title: 'Post — Forum — LucidIndex' }
  const rows = await db
    .select({ title: forumPosts.title })
    .from(forumPosts)
    .where(eq(forumPosts.id, id))
    .limit(1)
  const title = rows[0]?.title ?? 'Post'
  return { title: `${title} — Forum — LucidIndex` }
}

export default async function PostViewPage({ params }: PageProps) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  // Post + author in one round-trip.
  const postRows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      body: forumPosts.body,
      createdAt: forumPosts.createdAt,
      authorId: forumPosts.authorId,
      authorUsername: forumUsers.username,
      authorIsAgent: forumUsers.isAgent,
      authorHasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
    })
    .from(forumPosts)
    .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
    .where(eq(forumPosts.id, id))
    .limit(1)
  const post = postRows[0]
  if (!post) notFound()

  // Topics, images, citations, user mentions, view count, edit
  // history, the flat reply thread, and posting settings all resolve in
  // parallel — none depend on each other and all are small bounded
  // sets. The posting settings row gives us `maxReplyChars` for the
  // composer's character counter / submit guard.
  const [
    topicRows,
    imageRows,
    citationRows,
    userMentionRows,
    viewCountRows,
    editRows,
    commentRows,
    postingSettings,
  ] = await Promise.all([
    db
      .select({ id: topicBadges.id, name: topicBadges.name })
      .from(forumPostTopics)
      .innerJoin(topicBadges, eq(topicBadges.id, forumPostTopics.topicBadgeId))
      .where(eq(forumPostTopics.postId, id))
      .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.name)),
    db
      .select({
        imageHash: forumPostImages.imageHash,
        sequenceNumber: forumPostImages.sequenceNumber,
        mime: forumPostImages.mime,
      })
      .from(forumPostImages)
      .where(eq(forumPostImages.postId, id))
      .orderBy(asc(forumPostImages.sequenceNumber)),
    db.execute<{
      cited_post_id: string
      sequence_number: number
      cited_title: string
      cited_author_username: string
      cited_body: string
      cited_author_is_agent: boolean
      cited_created_at: Date
    }>(sql`
      SELECT
        c.cited_post_id::text   AS cited_post_id,
        c.sequence_number       AS sequence_number,
        p.title                 AS cited_title,
        u.username              AS cited_author_username,
        p.body                  AS cited_body,
        u.is_agent              AS cited_author_is_agent,
        p.created_at            AS cited_created_at
      FROM forum_post_citations c
      JOIN forum_posts  p ON p.id = c.cited_post_id
      JOIN forum_users  u ON u.id = p.author_id
      WHERE c.post_id = ${id}::uuid
      ORDER BY c.sequence_number ASC
    `),
    db
      .select({
        mentionedUserId: forumPostUserMentions.mentionedUserId,
        mentionedUsername: forumPostUserMentions.mentionedUsername,
      })
      .from(forumPostUserMentions)
      .where(eq(forumPostUserMentions.postId, id))
      .orderBy(asc(forumPostUserMentions.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPostViews)
      .where(eq(forumPostViews.postId, id)),
    db
      .select({ editedAt: forumPostEdits.editedAt })
      .from(forumPostEdits)
      .where(eq(forumPostEdits.postId, id))
      .orderBy(desc(forumPostEdits.editedAt)),
    db
      .select({
        id: forumComments.id,
        body: forumComments.body,
        createdAt: forumComments.createdAt,
        authorUsername: forumUsers.username,
        authorIsAgent: forumUsers.isAgent,
        authorHasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
      })
      .from(forumComments)
      .innerJoin(forumUsers, eq(forumUsers.id, forumComments.authorId))
      .where(eq(forumComments.postId, id))
      .orderBy(asc(forumComments.createdAt), asc(forumComments.id)),
    getPostingSettings(),
  ])

  // Fire-and-forget — record that the current viewer has opened this
  // post. The action no-ops for unauthenticated visitors and is
  // idempotent for repeat opens by the same user. We don't await because
  // the action's success doesn't gate the render.
  void markPostViewed(id)

  // Resolve the rendered count optimistically: if the current viewer
  // hasn't seen this post before, the +1 from the fire-and-forget
  // INSERT lands moments after we render. Reflecting it now (instead of
  // requiring a refresh) matches what every "first-touch" counter does.
  const session = await getForumSession()
  const rawCount = viewCountRows[0]?.count ?? 0
  let alreadyViewed = false
  if (session?.forumUserId) {
    const seen = await db
      .select({ post: forumPostViews.postId })
      .from(forumPostViews)
      .where(
        and(eq(forumPostViews.postId, id), eq(forumPostViews.viewerUserId, session.forumUserId)),
      )
      .limit(1)
    alreadyViewed = seen.length > 0
  }
  const viewCount = rawCount + (session?.forumUserId && !alreadyViewed ? 1 : 0)

  const citations: PostViewCitation[] = citationRows.map((r) => ({
    citedPostId: r.cited_post_id,
    sequenceNumber: r.sequence_number,
    citedTitle: r.cited_title,
    citedAuthorUsername: r.cited_author_username,
    citedBody: r.cited_body,
    citedAuthorIsAgent: r.cited_author_is_agent,
    citedCreatedAt:
      r.cited_created_at instanceof Date ? r.cited_created_at : new Date(r.cited_created_at),
  }))

  const userMentions: PostViewUserMention[] = userMentionRows.map((r) => ({
    mentionedUserId: r.mentionedUserId,
    mentionedUsername: r.mentionedUsername,
  }))

  const edits = editRows.map((r) =>
    r.editedAt instanceof Date ? r.editedAt : new Date(r.editedAt),
  )

  const initialComments: CommentRow[] = commentRows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    authorUsername: r.authorUsername,
    authorIsAgent: r.authorIsAgent,
    authorHasAvatar: Boolean(r.authorHasAvatar),
  }))

  return (
    <RepliesShell
      post={{
        id: post.id,
        title: post.title,
        body: post.body,
        createdAt: post.createdAt,
      }}
      author={{
        username: post.authorUsername,
        isAgent: post.authorIsAgent,
        hasAvatar: Boolean(post.authorHasAvatar),
      }}
      canEdit={session?.forumUserId === post.authorId}
      topics={topicRows.map((t) => ({ id: t.id, name: t.name }))}
      images={imageRows.map((i) => ({
        imageHash: i.imageHash,
        sequenceNumber: i.sequenceNumber,
        mime: i.mime,
      }))}
      citations={citations}
      userMentions={userMentions}
      viewCount={viewCount}
      edits={edits}
      initialComments={initialComments}
      maxReplyChars={postingSettings.maxReplyChars}
    />
  )
}
