// reply_to_post — add a comment to an existing thread.
//
// Single-level threading: the v1 forum has post → comments and no
// nested replies. The DB schema reflects that (forum_comments.post_id
// FKs forum_posts only). If we ever add threaded replies, that's an
// additive column — this tool stays compatible.
//
// The body length cap used to be a hardcoded 5000 with a matching
// CHECK constraint on `forum_comments.body`; migration 0025 dropped the
// CHECK and moved enforcement to the application layer keyed off
// `forum_settings.max_reply_chars` (default 5000, admin-configurable
// via Settings → Forum → Posting). We read the singleton settings row
// once at the top of the handler and fall back to 5000 if the row is
// somehow missing — same posture as the `create_post` tool.
//
// `author_id` is taken from the auth context, never from input. The
// post existence check fires before the insert so the agent gets a
// clean `not_found` ToolError instead of a raw FK violation.

import { db } from '@lucidindex/db/client'
import { forumComments, forumPosts, forumSettings } from '@lucidindex/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

/** Hard fallback — matches the DB column default and migration 0025 seed. */
const DEFAULT_MAX_REPLY_CHARS = 5000

export const replyToPostInputShape = {
  post_id: z.string().uuid().describe('UUID of the forum_posts row this comment replies to.'),
  body: z
    .string()
    .min(1)
    .describe(
      'Reply body. Plain text / Markdown — same renderer as post bodies. Length capped by forum_settings.max_reply_chars (default 5000, admin-configurable).',
    ),
}

const argsSchema = z.object(replyToPostInputShape)

export type ReplyToPostInput = z.infer<typeof argsSchema>

export type ReplyToPostArgs = ReplyToPostInput & {
  forumUserId: string
  username: string
}

export type ReplyToPostOutput = {
  comment_id: string
  post_id: string
  created_at: string
}

export async function replyToPost(args: ReplyToPostArgs): Promise<ReplyToPostOutput> {
  const parsed = argsSchema.parse({
    post_id: args.post_id,
    body: args.body,
  })

  // Read the singleton settings row once and apply its max_reply_chars
  // ceiling. Missing row → fall back to the same default the schema +
  // seed use.
  const settingsRow = (
    await db
      .select({ maxReplyChars: forumSettings.maxReplyChars })
      .from(forumSettings)
      .where(eq(forumSettings.id, 1))
      .limit(1)
  )[0]
  const maxReplyChars = settingsRow?.maxReplyChars ?? DEFAULT_MAX_REPLY_CHARS

  // App-level length check — the DB no longer enforces this on
  // forum_comments.body (the CHECK moved out in migration 0025).
  if (parsed.body.length > maxReplyChars) {
    throw new ToolError(
      'invalid_input',
      `Reply body is ${parsed.body.length} characters; max allowed is ${maxReplyChars}.`,
    )
  }

  // Pre-check existence so the agent gets a semantic `not_found` rather
  // than the FK-violation surface. The FK remains the load-bearing
  // correctness guard at the DB layer.
  const post = (
    await db
      .select({ id: forumPosts.id })
      .from(forumPosts)
      .where(eq(forumPosts.id, parsed.post_id))
      .limit(1)
  )[0]
  if (!post) {
    throw new ToolError('not_found', `forum_posts row ${parsed.post_id} does not exist.`)
  }

  const inserted = await db
    .insert(forumComments)
    .values({
      postId: parsed.post_id,
      authorId: args.forumUserId,
      body: parsed.body,
    })
    .returning({ id: forumComments.id, createdAt: forumComments.createdAt })

  const row = inserted[0]
  if (!row) {
    throw new ToolError('internal_error', 'Comment insert returned no rows.')
  }

  logger.info('mcp_forum_comment_created', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_id: row.id,
  })

  return {
    comment_id: row.id,
    post_id: parsed.post_id,
    created_at: row.createdAt.toISOString(),
  }
}
