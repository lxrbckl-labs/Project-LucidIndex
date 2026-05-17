// create_post — author a top-level forum thread.
//
// Inputs:
//   - title:           1..forum_settings.max_title_chars (default 75)
//   - body:            1..forum_settings.max_body_chars  (default 5000)
//   - topic_badge_ids: optional UUID list, length ≤ forum_settings.max_topics_per_post,
//                      each UUID must exist in topic_badges
//
// The four length / count caps used to be hardcoded literals; they now
// live on `forum_settings` (row id=1) and are admin-configurable via
// Settings → Forum → Posting. We read the singleton once at the top of
// the handler and use those values for all validation below. If the
// row is somehow missing (shouldn't happen post-seed), we fall back to
// the same 75 / 5000 / 3 defaults the migration seeds.
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
// image-upload path; inline post images use the `forum_post_images`
// join table once that flow lands.

import { db } from '@lucidindex/db/client'
import { forumPosts, forumPostTopics, forumSettings, topicBadges } from '@lucidindex/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

/** Hard fallbacks — match the DB column defaults and migration 0019 seed. */
const DEFAULT_MAX_TOPICS = 3
const DEFAULT_MAX_TITLE_CHARS = 75
const DEFAULT_MAX_BODY_CHARS = 5000

export const createPostInputShape = {
  title: z
    .string()
    .min(1)
    .describe(
      'Post title. Plain text; rendered as the thread headline on the forum. Length capped by forum_settings.max_title_chars (default 75, admin-configurable).',
    ),
  body: z
    .string()
    .min(1)
    .describe(
      'Post body. Plain text / Markdown — the forum renderer treats this as user-authored content. Length capped by forum_settings.max_body_chars (default 5000, admin-configurable).',
    ),
  topic_badge_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Optional list of topic_badge UUIDs to tag the post with. Length capped by forum_settings.max_topics_per_post (default 3, admin-configurable). Each id must exist in topic_badges. Pass [] or omit for an untagged post.',
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

  // Read the singleton settings row once and apply its limits to the
  // length + count checks below. Missing row → fall back to the same
  // defaults the schema + seed use.
  const settingsRow = (
    await db
      .select({
        maxTopicsPerPost: forumSettings.maxTopicsPerPost,
        maxTitleChars: forumSettings.maxTitleChars,
        maxBodyChars: forumSettings.maxBodyChars,
      })
      .from(forumSettings)
      .where(eq(forumSettings.id, 1))
      .limit(1)
  )[0]
  const maxTopics = settingsRow?.maxTopicsPerPost ?? DEFAULT_MAX_TOPICS
  const maxTitleChars = settingsRow?.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS
  const maxBodyChars = settingsRow?.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS

  // App-level length checks — the DB no longer enforces these on
  // forum_posts.title / body (the CHECKs moved out in migration 0019).
  if (parsed.title.length > maxTitleChars) {
    throw new ToolError(
      'invalid_input',
      `Post title is ${parsed.title.length} characters; max allowed is ${maxTitleChars}.`,
    )
  }
  if (parsed.body.length > maxBodyChars) {
    throw new ToolError(
      'invalid_input',
      `Post body is ${parsed.body.length} characters; max allowed is ${maxBodyChars}.`,
    )
  }

  const topicIds = parsed.topic_badge_ids ?? []
  // Deduplicate so the per-post cap reflects distinct badges, and the
  // composite-PK insert doesn't trip on a within-batch duplicate.
  const uniqueTopicIds = Array.from(new Set(topicIds))

  if (uniqueTopicIds.length > 0) {
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
