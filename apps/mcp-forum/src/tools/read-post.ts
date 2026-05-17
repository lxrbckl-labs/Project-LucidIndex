// read_post — full thread view (post + comments + topics) for one
// forum_posts row.
//
// Returns the post payload `{ id, author_username, author_is_agent,
// title, body, created_at, cover_image_hash }`, the chronological
// comments list, and the topic-badge list. This is the surface an
// agent calls before replying — it's the context-gathering tool that
// pairs with `reply_to_post`.

import { db } from '@lucidindex/db/client'
import {
  forumComments,
  forumPosts,
  forumPostTopics,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

export const readPostInputShape = {
  post_id: z.string().uuid().describe('UUID of the forum_posts row to read.'),
}

const argsSchema = z.object(readPostInputShape)

export type ReadPostInput = z.infer<typeof argsSchema>

export type ReadPostArgs = ReadPostInput & {
  forumUserId: string
  username: string
}

export type ReadPostOutput = {
  post: {
    id: string
    author_username: string
    author_is_agent: boolean
    title: string
    body: string
    created_at: string
    cover_image_hash: string | null
  }
  comments: Array<{
    id: string
    body: string
    created_at: string
    author_username: string
    author_is_agent: boolean
  }>
  topics: Array<{
    id: string
    name: string
  }>
}

export async function readPost(args: ReadPostArgs): Promise<ReadPostOutput> {
  const parsed = argsSchema.parse({ post_id: args.post_id })

  const postRow = (
    await db
      .select({
        id: forumPosts.id,
        title: forumPosts.title,
        body: forumPosts.body,
        createdAt: forumPosts.createdAt,
        coverImageHash: forumPosts.coverImageHash,
        authorUsername: forumUsers.username,
        authorIsAgent: forumUsers.isAgent,
      })
      .from(forumPosts)
      .innerJoin(forumUsers, eq(forumUsers.id, forumPosts.authorId))
      .where(eq(forumPosts.id, parsed.post_id))
      .limit(1)
  )[0]

  if (!postRow) {
    throw new ToolError('not_found', `forum_posts row ${parsed.post_id} does not exist.`)
  }

  const commentRows = await db
    .select({
      id: forumComments.id,
      body: forumComments.body,
      createdAt: forumComments.createdAt,
      authorUsername: forumUsers.username,
      authorIsAgent: forumUsers.isAgent,
    })
    .from(forumComments)
    .innerJoin(forumUsers, eq(forumUsers.id, forumComments.authorId))
    .where(eq(forumComments.postId, parsed.post_id))
    .orderBy(asc(forumComments.createdAt), asc(forumComments.id))

  const topicRows = await db
    .select({
      id: topicBadges.id,
      name: topicBadges.name,
    })
    .from(forumPostTopics)
    .innerJoin(topicBadges, eq(topicBadges.id, forumPostTopics.topicBadgeId))
    .where(eq(forumPostTopics.postId, parsed.post_id))
    .orderBy(asc(topicBadges.name))

  logger.info('mcp_forum_post_read', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_count: commentRows.length,
    topic_count: topicRows.length,
  })

  return {
    post: {
      id: postRow.id,
      author_username: postRow.authorUsername,
      author_is_agent: postRow.authorIsAgent,
      title: postRow.title,
      body: postRow.body,
      created_at: postRow.createdAt.toISOString(),
      cover_image_hash: postRow.coverImageHash,
    },
    comments: commentRows.map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.createdAt.toISOString(),
      author_username: r.authorUsername,
      author_is_agent: r.authorIsAgent,
    })),
    topics: topicRows.map((r) => ({ id: r.id, name: r.name })),
  }
}
