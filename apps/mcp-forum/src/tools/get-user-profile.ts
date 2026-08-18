// get_user_profile — aggregated activity for one forum user.
//
// Powers the agent's "is this user relevant to bring into a thread?"
// decision. Returns four newest-first lists:
//   - recent_posts            (posts authored by this user)
//   - recent_comments         (comments authored by this user)
//   - recent_mentions_in_posts    (posts where this user was @-mentioned)
//   - recent_mentions_in_comments (comments where this user was @-mentioned)
//
// All four lists cap at `recent_limit` (default 10, max 50). Each list
// is independent — they don't paginate; this is a profile snapshot,
// not a feed. Agents that need full pagination should fall back to
// `list_posts` with `author_username`.
//
// HTTP-only — needs the auth context for logging the caller but
// doesn't filter on it.

import { db } from '@lucidindex/db/client'
import {
  forumComments,
  forumCommentUserMentions,
  forumPosts,
  forumPostTopics,
  forumPostUserMentions,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

const DEFAULT_RECENT_LIMIT = 10
const MAX_RECENT_LIMIT = 50

export const getUserProfileInputShape = {
  username: z
    .string()
    .describe(
      'Forum username to look up. Case-insensitive — normalized to lowercase server-side because `forum_users.username` carries a lowercase CHECK constraint.',
    ),
  recent_limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_RECENT_LIMIT)
    .optional()
    .describe(
      `Cap on each of the four recent_* arrays. Default ${DEFAULT_RECENT_LIMIT}, max ${MAX_RECENT_LIMIT}.`,
    ),
}

const argsSchema = z.object(getUserProfileInputShape)

export type GetUserProfileInput = z.infer<typeof argsSchema>

export type GetUserProfileArgs = GetUserProfileInput & {
  forumUserId: string
  callerUsername: string
}

export type GetUserProfileOutput = {
  user: {
    username: string
    is_agent: boolean
    has_avatar: boolean
    joined_at: string
  }
  recent_posts: Array<{
    id: string
    title: string
    created_at: string
    topic_badge_names: string[]
  }>
  recent_comments: Array<{
    comment_id: string
    post_id: string
    post_title: string
    body_excerpt: string
    created_at: string
  }>
  recent_mentions_in_posts: Array<{
    post_id: string
    post_title: string
    mentioned_by_username: string
    created_at: string
  }>
  recent_mentions_in_comments: Array<{
    comment_id: string
    post_id: string
    post_title: string
    mentioned_by_username: string
    created_at: string
  }>
}

const EXCERPT_LEN = 200

export async function getUserProfile(args: GetUserProfileArgs): Promise<GetUserProfileOutput> {
  const parsed = argsSchema.parse({
    username: args.username,
    recent_limit: args.recent_limit,
  })
  const limit = parsed.recent_limit ?? DEFAULT_RECENT_LIMIT
  const username = parsed.username.toLowerCase()

  // Resolve the user row first — every subsequent query keys off the
  // user id rather than the username (cheaper and avoids re-hashing
  // the username for each WHERE).
  const userRow = (
    await db
      .select({
        id: forumUsers.id,
        username: forumUsers.username,
        isAgent: forumUsers.isAgent,
        joinedAt: forumUsers.createdAt,
        hasAvatar: sql<boolean>`${forumUsers.avatarData} IS NOT NULL`,
      })
      .from(forumUsers)
      .where(eq(forumUsers.username, username))
      .limit(1)
  )[0]
  if (!userRow) {
    throw new ToolError('user_not_found', `No forum_users row with username "${username}".`)
  }

  // -------- recent_posts --------
  // Two-step: pull the post ids first, then aggregate topic badges
  // per post in a second query. Simpler than a single GROUP BY +
  // array_agg here because Drizzle's pg-core handling of GROUP BY +
  // multi-table joins is fiddlier than a small second roundtrip.
  const postRows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      createdAt: forumPosts.createdAt,
    })
    .from(forumPosts)
    .where(eq(forumPosts.authorId, userRow.id))
    .orderBy(desc(forumPosts.createdAt))
    .limit(limit)

  let topicsByPostId = new Map<string, string[]>()
  if (postRows.length > 0) {
    const topicRows = await db
      .select({
        postId: forumPostTopics.postId,
        name: topicBadges.name,
      })
      .from(forumPostTopics)
      .innerJoin(topicBadges, eq(topicBadges.id, forumPostTopics.topicBadgeId))
      .where(
        inArray(
          forumPostTopics.postId,
          postRows.map((r) => r.id),
        ),
      )
    topicsByPostId = new Map<string, string[]>()
    for (const r of topicRows) {
      const existing = topicsByPostId.get(r.postId)
      if (existing) {
        existing.push(r.name)
      } else {
        topicsByPostId.set(r.postId, [r.name])
      }
    }
    for (const arr of topicsByPostId.values()) arr.sort()
  }

  const recent_posts = postRows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.createdAt.toISOString(),
    topic_badge_names: topicsByPostId.get(r.id) ?? [],
  }))

  // -------- recent_comments --------
  // Join to the parent post for `post_title`. Body excerpt mirrors
  // `list_posts`' first-200-chars treatment.
  const commentRows = await db
    .select({
      commentId: forumComments.id,
      postId: forumComments.postId,
      postTitle: forumPosts.title,
      body: forumComments.body,
      createdAt: forumComments.createdAt,
    })
    .from(forumComments)
    .innerJoin(forumPosts, eq(forumPosts.id, forumComments.postId))
    .where(eq(forumComments.authorId, userRow.id))
    .orderBy(desc(forumComments.createdAt))
    .limit(limit)

  const recent_comments = commentRows.map((r) => ({
    comment_id: r.commentId,
    post_id: r.postId,
    post_title: r.postTitle,
    body_excerpt:
      r.body.length <= EXCERPT_LEN ? r.body : `${r.body.slice(0, EXCERPT_LEN).trimEnd()}…`,
    created_at: r.createdAt.toISOString(),
  }))

  // -------- recent_mentions_in_posts --------
  // The mention rows live in `forum_post_user_mentions`; join out to
  // the post for title + to forum_users (aliased as `mentioner`) for
  // the author username of whoever wrote the post that mentioned them.
  // Drizzle aliasing is done by a second-query `from(forumUsers)` is
  // awkward — easier to project the post's authorId and then resolve
  // names in a second pass.
  const mentionPostRows = await db
    .select({
      postId: forumPostUserMentions.postId,
      postTitle: forumPosts.title,
      authorId: forumPosts.authorId,
      createdAt: forumPostUserMentions.createdAt,
    })
    .from(forumPostUserMentions)
    .innerJoin(forumPosts, eq(forumPosts.id, forumPostUserMentions.postId))
    .where(eq(forumPostUserMentions.mentionedUserId, userRow.id))
    .orderBy(desc(forumPostUserMentions.createdAt))
    .limit(limit)

  const mentionPostAuthorIds = Array.from(new Set(mentionPostRows.map((r) => r.authorId)))
  const mentionPostAuthorMap = await resolveUsernameMap(mentionPostAuthorIds)

  const recent_mentions_in_posts = mentionPostRows.map((r) => ({
    post_id: r.postId,
    post_title: r.postTitle,
    mentioned_by_username: mentionPostAuthorMap.get(r.authorId) ?? '<unknown>',
    created_at: r.createdAt.toISOString(),
  }))

  // -------- recent_mentions_in_comments --------
  // Same shape as the post-side mention list but joined through
  // forum_comment_user_mentions → forum_comments → forum_posts.
  const mentionCommentRows = await db
    .select({
      commentId: forumCommentUserMentions.commentId,
      postId: forumComments.postId,
      postTitle: forumPosts.title,
      commenterId: forumComments.authorId,
      createdAt: forumCommentUserMentions.createdAt,
    })
    .from(forumCommentUserMentions)
    .innerJoin(forumComments, eq(forumComments.id, forumCommentUserMentions.commentId))
    .innerJoin(forumPosts, eq(forumPosts.id, forumComments.postId))
    .where(eq(forumCommentUserMentions.mentionedUserId, userRow.id))
    .orderBy(desc(forumCommentUserMentions.createdAt))
    .limit(limit)

  const mentionCommentAuthorIds = Array.from(new Set(mentionCommentRows.map((r) => r.commenterId)))
  const mentionCommentAuthorMap = await resolveUsernameMap(mentionCommentAuthorIds)

  const recent_mentions_in_comments = mentionCommentRows.map((r) => ({
    comment_id: r.commentId,
    post_id: r.postId,
    post_title: r.postTitle,
    mentioned_by_username: mentionCommentAuthorMap.get(r.commenterId) ?? '<unknown>',
    created_at: r.createdAt.toISOString(),
  }))

  logger.info('mcp_forum_user_profile_lookup', {
    forum_user_id: args.forumUserId,
    caller_username: args.callerUsername,
    target_username: userRow.username,
    target_is_agent: userRow.isAgent,
    recent_posts: recent_posts.length,
    recent_comments: recent_comments.length,
    recent_mentions_in_posts: recent_mentions_in_posts.length,
    recent_mentions_in_comments: recent_mentions_in_comments.length,
  })

  return {
    user: {
      username: userRow.username,
      is_agent: userRow.isAgent,
      has_avatar: Boolean(userRow.hasAvatar),
      joined_at: userRow.joinedAt.toISOString(),
    },
    recent_posts,
    recent_comments,
    recent_mentions_in_posts,
    recent_mentions_in_comments,
  }
}

/**
 * Resolve a batch of forum_user ids to their usernames. Returns an
 * empty map for an empty input list (skipping the DB round-trip).
 */
async function resolveUsernameMap(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: forumUsers.id, username: forumUsers.username })
    .from(forumUsers)
    .where(inArray(forumUsers.id, ids))
  return new Map(rows.map((r) => [r.id, r.username]))
}
