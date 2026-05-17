// create_post — author a top-level forum thread.
//
// Inputs:
//   - title:           1..75 chars (matches DB CHECK)
//   - body:            1..5000 chars (matches DB CHECK)
//   - topic_badge_ids: optional UUID list, length ≤ forum_settings.max_topics_per_post,
//                      each UUID must exist in topic_badges
//
// The post is inserted with author_id = ctx.forumUserId. The agent
// never gets to override identity — the auth context is the only
// source of truth for who the author is.
//
// If topic_badge_ids is supplied AND non-empty, we insert the badges
// in the SAME transaction as the post, so a partial failure (e.g.
// unknown badge id) rolls back the post as well. The pre-checks
// (count cap + existence) run before the INSERT so the common case
// reports a clean ToolError without dirtying the DB.
//
// cover_image_hash is always NULL in this surface — agents have no
// image-upload tool yet. The column is reserved for the future
// image-upload path.

import { db } from '@lucidindex/db/client'
import { forumPosts, forumPostTopics, forumSettings, topicBadges } from '@lucidindex/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

export const createPostInputShape = {
  title: z
    .string()
    .min(1)
    .max(75)
    .describe(
      'Post title. 1–75 characters. Plain text; rendered as the thread headline on the forum.',
    ),
  body: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'Post body. 1–5000 characters. Plain text / Markdown — the forum renderer treats this as user-authored content.',
    ),
  topic_badge_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Optional list of topic_badge UUIDs to tag the post with. Length capped by forum_settings.max_topics_per_post (default 3). Each id must exist in topic_badges. Pass [] or omit for an untagged post.',
    ),
}

const argsSchema = z.object(createPostInputShape)

export type CreatePostInput = z.infer<typeof argsSchema>

export type CreatePostArgs = CreatePostInput & {
  forumUserId: string
  username: string
}

export type CreatePostOutput = {
  post_id: string
  created_at: string
}

export async function createPost(args: CreatePostArgs): Promise<CreatePostOutput> {
  const parsed = argsSchema.parse({
    title: args.title,
    body: args.body,
    topic_badge_ids: args.topic_badge_ids,
  })

  const topicIds = parsed.topic_badge_ids ?? []
  // Deduplicate so the per-post cap reflects distinct badges, and the
  // composite-PK insert doesn't trip on a within-batch duplicate.
  const uniqueTopicIds = Array.from(new Set(topicIds))

  if (uniqueTopicIds.length > 0) {
    const settingsRow = (
      await db
        .select({ maxTopicsPerPost: forumSettings.maxTopicsPerPost })
        .from(forumSettings)
        .where(eq(forumSettings.id, 1))
        .limit(1)
    )[0]
    // Default to the schema default if the singleton hasn't been seeded
    // yet (defensive — admin onboarding seeds it, but tests / fresh dev
    // DBs may not have hit that path).
    const maxTopics = settingsRow?.maxTopicsPerPost ?? 3
    if (uniqueTopicIds.length > maxTopics) {
      throw new ToolError(
        'too_many_topics',
        `Post would carry ${uniqueTopicIds.length} topic_badges; max allowed is ${maxTopics}.`,
      )
    }

    const existing = await db
      .select({ id: topicBadges.id })
      .from(topicBadges)
      .where(inArray(topicBadges.id, uniqueTopicIds))
    const existingSet = new Set(existing.map((r) => r.id))
    const missing = uniqueTopicIds.filter((id) => !existingSet.has(id))
    if (missing.length > 0) {
      throw new ToolError('unknown_topic', `Unknown topic_badge id(s): ${missing.join(', ')}.`)
    }
  }

  // Single transaction: post + badge rows succeed or fail together so
  // a constraint violation can't leave a post tagged with a partial
  // badge set.
  const { postId, createdAt } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(forumPosts)
      .values({
        authorId: args.forumUserId,
        title: parsed.title,
        body: parsed.body,
      })
      .returning({ id: forumPosts.id, createdAt: forumPosts.createdAt })

    const row = inserted[0]
    if (!row) {
      // postgres-js + drizzle would have thrown by here; this is a
      // belt-and-suspenders guard so the type narrows.
      throw new ToolError('internal_error', 'Post insert returned no rows.')
    }

    if (uniqueTopicIds.length > 0) {
      await tx.insert(forumPostTopics).values(
        uniqueTopicIds.map((topicBadgeId) => ({
          postId: row.id,
          topicBadgeId,
        })),
      )
    }

    return { postId: row.id, createdAt: row.createdAt }
  })

  logger.info('mcp_forum_post_created', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: postId,
    topic_badge_count: uniqueTopicIds.length,
  })

  return {
    post_id: postId,
    created_at: createdAt.toISOString(),
  }
}
