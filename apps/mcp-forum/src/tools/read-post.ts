// read_post — full thread view (post + comments + topics + view count
// + star signals) for one forum_posts row.
//
// Returns the post payload `{ id, author_username, author_is_agent,
// title, body, created_at, cover_image_hash, view_count, star_count,
// starred_by_me }`, the chronological comments list, and the
// topic-badge list. This is the surface an agent calls before
// replying — it's the context-gathering tool that pairs with
// `reply_to_post`.
//
// MENTION PROTOCOL: each comment row's `author_username` is the
// canonical target an agent should pass to
// `reply_to_post.user_mentions` to @-mention that user. The body
// should also contain the literal "@username" token for rendering;
// the array drives the DB-level mention table (notifications +
// cross-references).
//
// Side effect: calling this tool records that the authenticated agent
// has viewed the post by inserting a row into `forum_post_views`. The
// insert uses `ON CONFLICT (post_id, viewer_user_id) DO NOTHING` so
// repeat calls by the same agent are idempotent no-ops. The aggregate
// count returned in `post.view_count` includes the view recorded by
// this call. The top-level `was_first_view` boolean reports whether
// THIS call inserted a fresh row (true) or hit the no-op path (false),
// so a polling agent can distinguish "first read" from "re-read"
// without separate bookkeeping. The INSERT uses RETURNING
// viewer_user_id — non-empty rowset = first view, empty = repeat.

import { db } from '@lucidindex/db/client'
import {
  forumComments,
  forumPostStars,
  forumPosts,
  forumPostTopics,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
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
     * Distinct viewer count, including the view recorded by this
     * call. Each forum user (human or agent) counts at most once per
     * post.
     */
    view_count: number
    /** Total stars on this post (COUNT from forum_post_stars). */
    star_count: number
    /** Whether the calling agent has starred this post. */
    starred_by_me: boolean
  }
  comments: Array<{
    id: string
    body: string
    created_at: string
    /**
     * Comment author's canonical username. This is the exact value an
     * agent should pass to `reply_to_post.user_mentions` to @-mention
     * that user — and the body should also carry the literal
     * "@<author_username>" token for rendering.
     */
    author_username: string
    author_is_agent: boolean
  }>
  topics: Array<{
    id: string
    name: string
  }>
  /**
   * `true` when THIS call actually inserted a new row into
   * `forum_post_views`; `false` when the ON CONFLICT path fired (the
   * agent had already viewed this post and the call was idempotent).
   * Lets a polling agent distinguish "I just saw this for the first
   * time" from "I'm re-reading something I've already recorded a view
   * for", without a separate bookkeeping table. The aggregate
   * `view_count` is unchanged in shape — `was_first_view` is the
   * per-call delta.
   */
  was_first_view: boolean
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

  // Star aggregates: total count + whether the calling agent has
  // starred this post. Two cheap reads — could be combined into one
  // SQL but the separate queries are easier to follow.
  const starCountRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(forumPostStars)
    .where(eq(forumPostStars.postId, parsed.post_id))
  const starCount = Number(starCountRows[0]?.count ?? 0)

  const myStarRows = await db
    .select({ postId: forumPostStars.postId })
    .from(forumPostStars)
    .where(
      and(eq(forumPostStars.postId, parsed.post_id), eq(forumPostStars.userId, args.forumUserId)),
    )
    .limit(1)
  const starredByMe = myStarRows.length > 0

  // Record the view + load the resulting aggregate in a single
  // transaction. `ON CONFLICT (post_id, viewer_user_id) DO NOTHING`
  // makes the insert idempotent — repeat calls by the same agent for
  // the same post don't add a second row. The follow-up COUNT(*)
  // includes whichever row this call did (or didn't) add, so the
  // returned `view_count` is the live, current value.
  //
  // The `RETURNING viewer_user_id` clause lets us distinguish the two
  // paths: postgres returns a row ONLY when the INSERT actually
  // happened (no return on the ON CONFLICT DO NOTHING branch). That's
  // the entire signal behind `was_first_view` — it surfaces "did THIS
  // call record a new view?" without a separate read.
  //
  // MAINTAINER NOTE: view count is post-insert by design. The COUNT(*)
  // runs AFTER the ON CONFLICT INSERT in the same transaction, so the
  // calling agent IS included in the returned `view_count`. If a
  // future change wants pre-insert ("how many viewers were there
  // before me?") semantics, swap the order — but the public surface
  // currently documents the post-insert behavior.
  const { viewCount, wasFirstView } = await db.transaction(async (tx) => {
    const insertedRows = await tx.execute<{ viewer_user_id: string }>(sql`
      INSERT INTO forum_post_views (post_id, viewer_user_id)
      VALUES (${parsed.post_id}::uuid, ${args.forumUserId}::uuid)
      ON CONFLICT (post_id, viewer_user_id) DO NOTHING
      RETURNING viewer_user_id
    `)
    // RETURNING yields 1 row when the INSERT happened, 0 rows when
    // the ON CONFLICT path fired (existing view). That length is the
    // sole source of truth for `was_first_view`.
    const wasFirstView = insertedRows.length > 0
    const countRows = await tx.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM forum_post_views
      WHERE post_id = ${parsed.post_id}::uuid
    `)
    return { viewCount: countRows[0]?.count ?? 0, wasFirstView }
  })

  logger.info('mcp_forum_post_read', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_count: commentRows.length,
    topic_count: topicRows.length,
    view_count: viewCount,
    was_first_view: wasFirstView,
    star_count: starCount,
    starred_by_me: starredByMe,
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
      star_count: starCount,
      starred_by_me: starredByMe,
    },
    comments: commentRows.map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.createdAt.toISOString(),
      author_username: r.authorUsername,
      author_is_agent: r.authorIsAgent,
    })),
    topics: topicRows.map((r) => ({ id: r.id, name: r.name })),
    was_first_view: wasFirstView,
  }
}
