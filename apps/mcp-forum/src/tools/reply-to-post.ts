// reply_to_post — add a comment to an existing thread.
//
// Single-level threading: the v1 forum has post → comments and no
// nested replies. The DB schema reflects that (forum_comments.post_id
// FKs forum_posts only). If we ever add threaded replies, that's an
// additive column — this tool stays compatible.
//
// The body length cap lives on `forum_settings.max_reply_chars`
// (default 5000, admin-configurable via Settings → Forum → Posting).
// We read the singleton settings row once at the top of the handler
// and fall back to 5000 if the row is somehow missing — same posture
// as the `create_post` tool.
//
// `author_id` is taken from the auth context, never from input. The
// post existence check fires before the insert so the agent gets a
// clean `not_found` ToolError instead of a raw FK violation.
//
// Mentions + citations mirror create_post's contract — see the
// comment-side tables (forum_comment_user_mentions,
// forum_comment_citations) and the human-side flow in
// apps/web/app/api/forum/posts/[id]/comments/route.ts. Self-citation
// of the parent post is silently dropped; self-mention by the author
// is silently dropped. Both silent drops are mirrored in the response
// as `dropped_self_mention` / `dropped_self_citation` booleans so the
// agent isn't guessing why the persisted counts are short.
//
// Mentioned usernames are lowercased server-side because
// forum_users.username carries a lowercase CHECK constraint —
// `"Alice"` and `"ALICE"` both resolve to `alice`. Persisting the
// link row is the entire job here; the forum has no notification
// subsystem yet, so humans see a mention only when they view the
// containing post or comment.

import { db } from '@lucidindex/db/client'
import {
  forumCommentCitations,
  forumComments,
  forumCommentUserMentions,
  forumPosts,
  forumSettings,
  forumUsers,
} from '@lucidindex/db/schema'
import { eq, inArray } from 'drizzle-orm'
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
      'Reply body. Plain text / Markdown — same renderer as post bodies. Length capped by forum_settings.max_reply_chars (default 5000, admin-configurable). To @-mention users, include "@username" tokens AND list each user in `user_mentions`. To cite other posts, include "@Post1", "@Post2", ... tokens AND list each cited post in `citations`.',
    ),
  user_mentions: z
    .array(
      z.object({
        mentioned_username: z.string(),
      }),
    )
    .optional()
    .default([])
    .describe(
      'Users to @-mention in this reply. Each `mentioned_username` is lowercased server-side and MUST exist in forum_users (the column carries a lowercase CHECK constraint). Persisted to forum_comment_user_mentions; surfaces as hover-card links in the rendered comment. The body should also contain matching "@username" tokens. Self-mention is silently dropped and reflected in the response as `dropped_self_mention: true`. Duplicates within the array are deduplicated after lowercasing. Note: the forum has no notification subsystem yet — this call persists the link only; humans see the mention when they next view the post.',
    ),
  citations: z
    .array(
      z.object({
        cited_post_id: z.string().uuid(),
      }),
    )
    .optional()
    .default([])
    .describe(
      'Posts cited via @PostN tokens. Each `cited_post_id` MUST exist in forum_posts. Sequence numbers (the N in @PostN) are assigned in array order, starting at 1 — the body should contain matching "@Post1", "@Post2", ... tokens for rendering. Self-citation of the parent post is silently dropped. Duplicates within the array are rejected.',
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
  /** Number of user mentions actually persisted (after self-mention dropping + dedup). */
  user_mention_count: number
  /** Number of citations persisted (after self-cite-of-parent dropping). */
  citation_count: number
  /**
   * True when the caller's own username appeared in `user_mentions`
   * (after lowercase normalization + dedup) and was filtered out. Lets
   * the agent see that the silent drop happened instead of guessing
   * why `user_mention_count` is short.
   */
  dropped_self_mention: boolean
  /**
   * True when the caller's `citations` included the parent post itself
   * — that's the only self-citation case the reply tool can produce,
   * and it's silently filtered the same way the human-side composer
   * filters it.
   */
  dropped_self_citation: boolean
}

export async function replyToPost(args: ReplyToPostArgs): Promise<ReplyToPostOutput> {
  const parsed = argsSchema.parse({
    post_id: args.post_id,
    body: args.body,
    user_mentions: args.user_mentions,
    citations: args.citations,
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

  // Pre-check existence so the agent gets a semantic `not_found`
  // rather than the FK-violation surface. The FK remains the
  // load-bearing correctness guard at the DB layer.
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

  // -------- User mentions: lowercase, resolve usernames → user ids,
  // drop self, dedup, refuse unknowns. Same posture as `create_post`. --------
  const requestedUsernames = parsed.user_mentions.map((m) => m.mentioned_username.toLowerCase())
  const uniqueUsernames = Array.from(new Set(requestedUsernames))
  type ResolvedMention = { mentionedUserId: string; mentionedUsername: string }
  let resolvedMentions: ResolvedMention[] = []
  let droppedSelfMention = false
  if (uniqueUsernames.length > 0) {
    const userRows = await db
      .select({ id: forumUsers.id, username: forumUsers.username })
      .from(forumUsers)
      .where(inArray(forumUsers.username, uniqueUsernames))
    const usernameToId = new Map(userRows.map((r) => [r.username, r.id]))
    const missingUsernames = uniqueUsernames.filter((u) => !usernameToId.has(u))
    if (missingUsernames.length > 0) {
      throw new ToolError(
        'unknown_mentioned_user',
        `Unknown mentioned username(s): ${missingUsernames.join(', ')}.`,
      )
    }
    resolvedMentions = uniqueUsernames
      .map((u) => ({
        mentionedUserId: usernameToId.get(u) as string,
        mentionedUsername: u,
      }))
      .filter((m) => {
        if (m.mentionedUserId === args.forumUserId) {
          droppedSelfMention = true
          return false
        }
        return true
      })
  }

  // -------- Citations: validate every cited_post_id exists; drop
  // self-cite of the parent post silently (same posture as the
  // human-side composer). --------
  const requestedCitationIds = parsed.citations.map((c) => c.cited_post_id)
  // Reject within-batch duplicates with a clean tool error.
  const seenCitedIds = new Set<string>()
  for (const id of requestedCitationIds) {
    if (seenCitedIds.has(id)) {
      throw new ToolError(
        'invalid_input',
        `Citation cited_post_id ${id} appears more than once; each post may be cited at most once.`,
      )
    }
    seenCitedIds.add(id)
  }
  if (requestedCitationIds.length > 0) {
    const existingCited = await db
      .select({ id: forumPosts.id })
      .from(forumPosts)
      .where(inArray(forumPosts.id, requestedCitationIds))
    const existingCitedSet = new Set(existingCited.map((r) => r.id))
    const missingCited = requestedCitationIds.filter((id) => !existingCitedSet.has(id))
    if (missingCited.length > 0) {
      throw new ToolError(
        'unknown_cited_post',
        `Unknown cited post id(s): ${missingCited.join(', ')}.`,
      )
    }
  }
  // Drop self-citation of the parent post silently. Track the drop so
  // the caller sees `dropped_self_citation: true` in the response —
  // the parent-post-cited-itself case is the only self-cite the reply
  // surface can produce.
  const droppedSelfCitation = requestedCitationIds.some((id) => id === parsed.post_id)
  const filteredCitationIds = requestedCitationIds.filter((id) => id !== parsed.post_id)

  // Single transaction: comment + mentions + citations succeed or
  // fail together.
  const { commentId, createdAt } = await db.transaction(async (tx) => {
    const inserted = await tx
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

    if (resolvedMentions.length > 0) {
      // Race-window guard: the pre-check `SELECT` above proves the
      // usernames existed at read time, but a concurrent admin-side
      // hard-delete could orphan one between the SELECT and the
      // INSERT. Postgres surfaces that as foreign-key violation
      // SQLSTATE 23503 — re-raise as the same `unknown_mentioned_user`
      // ToolError the pre-check uses, so the agent sees a consistent
      // error code regardless of which side won the race.
      try {
        await tx.insert(forumCommentUserMentions).values(
          resolvedMentions.map((m) => ({
            commentId: row.id,
            mentionedUserId: m.mentionedUserId,
            mentionedUsername: m.mentionedUsername,
          })),
        )
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw new ToolError(
            'unknown_mentioned_user',
            'A mentioned user disappeared between validation and insert.',
          )
        }
        throw err
      }
    }

    if (filteredCitationIds.length > 0) {
      // Sequence numbers are assigned in array order (1-based) — the
      // body should carry matching @Post1, @Post2, ... tokens. We
      // assign sequences AFTER dropping the self-cite so the
      // remaining indices stay contiguous from 1 (matching what the
      // body should contain). FK-race posture mirrors mentions above —
      // translate 23503 into the semantic `unknown_cited_post`
      // ToolError.
      try {
        await tx.insert(forumCommentCitations).values(
          filteredCitationIds.map((citedPostId, idx) => ({
            commentId: row.id,
            citedPostId,
            sequenceNumber: idx + 1,
          })),
        )
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw new ToolError(
            'unknown_cited_post',
            'A cited post disappeared between validation and insert.',
          )
        }
        throw err
      }
    }

    return { commentId: row.id, createdAt: row.createdAt }
  })

  logger.info('mcp_forum_comment_created', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_id: commentId,
    user_mention_count: resolvedMentions.length,
    citation_count: filteredCitationIds.length,
  })

  return {
    comment_id: commentId,
    post_id: parsed.post_id,
    created_at: createdAt.toISOString(),
    user_mention_count: resolvedMentions.length,
    citation_count: filteredCitationIds.length,
    dropped_self_mention: droppedSelfMention,
    dropped_self_citation: droppedSelfCitation,
  }
}

/**
 * Postgres surfaces foreign-key violations as SQLSTATE 23503. The
 * `code` field is usually decorated by drizzle-orm / postgres-js when
 * the error originates inside a query, but defensively check the
 * message text too — different driver paths surface the code with
 * varying reliability.
 */
function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (code === '23503') return true
  const message = err instanceof Error ? err.message : String(err)
  return /foreign key constraint/i.test(message)
}
