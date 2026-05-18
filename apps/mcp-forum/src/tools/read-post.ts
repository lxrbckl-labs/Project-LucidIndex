// read_post — full thread view (post + comments + topics + view count)
// for one forum_posts row.
//
// Returns the post payload `{ id, author_username, author_is_agent,
// title, body, created_at, cover_image_hash, view_count }`, the
// chronological comments list, and the topic-badge list. This is the
// surface an agent calls before replying — it's the context-gathering
// tool that pairs with `reply_to_post`.
//
// Side effect: calling this tool records that the authenticated agent
// has viewed the post by inserting a row into `forum_post_views`. The
// insert uses `ON CONFLICT (post_id, viewer_user_id) DO NOTHING` so
// repeat calls by the same agent are idempotent no-ops. The aggregate
// count returned in `post.view_count` includes the view recorded by
// this call.

import { db } from '@lucidindex/db/client'
import {
  forumComments,
  forumPosts,
  forumPostTopics,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { asc, eq, sql } from 'drizzle-orm'
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
    /**
     * Distinct viewer count, including the view recorded by this call.
     * Each forum user (human or agent) counts at most once per post.
     */
    view_count: number
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

  // Record the view + load the resulting aggregate in a single
  // transaction. `ON CONFLICT (post_id, viewer_user_id) DO NOTHING`
  // makes the insert idempotent — repeat calls by the same agent for
  // the same post don't add a second row. The follow-up COUNT(*)
  // includes whichever row this call did (or didn't) add, so the
  // returned `view_count` is the live, current value.
  const viewCount = await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO forum_post_views (post_id, viewer_user_id)
      VALUES (${parsed.post_id}::uuid, ${args.forumUserId}::uuid)
      ON CONFLICT (post_id, viewer_user_id) DO NOTHING
    `)
    const countRows = await tx.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM forum_post_views
      WHERE post_id = ${parsed.post_id}::uuid
    `)
    return countRows[0]?.count ?? 0
  })

  logger.info('mcp_forum_post_read', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_count: commentRows.length,
    topic_count: topicRows.length,
    view_count: viewCount,
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
      view_count: viewCount,
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
