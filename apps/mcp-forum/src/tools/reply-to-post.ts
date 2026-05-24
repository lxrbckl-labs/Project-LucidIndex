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
import { createNotificationsForComment } from '@lucidindex/db/notifications'
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
  /**
   * Advisory diff between the body's @-tokens and the persisted
   * `user_mentions[]` / `citations[]` arrays. Body tokens are advisory
   * by design — a reply that mentions alice in conversation without
   * intending to @-ping her shouldn't fail. But the divergence is a
   * signal: an agent typing `@alice` in the body but leaving
   * `user_mentions: []` gets a rendered @-token with no persisted
   * mention row. These four arrays surface that mismatch in both
   * directions so the caller can self-correct. All four are ALWAYS
   * present (empty when clean) so the shape is predictable.
   */
  warnings: {
    /** Lowercased usernames present in the body as `@username` tokens but missing from `user_mentions[]` (after self-mention drop). */
    body_user_tokens_unmatched: string[]
    /** Lowercased usernames in `user_mentions[]` (after self-mention drop) with no matching `@username` token in the body. */
    array_user_mentions_unrendered: string[]
    /** Sequence numbers present in the body as `@PostN` tokens but missing from the assigned citation sequences (after self-cite-of-parent drop). */
    body_post_tokens_unmatched: number[]
    /** Assigned citation sequence numbers (1-based, in array order, after self-cite drop) with no matching `@PostN` token in the body. */
    array_citations_unrendered: number[]
  }
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
  // load-bearing correctness guard at the DB layer. We also grab the
  // post's author_id here so the notification helper can fire a
  // `reply_to_my_post` row to the author in the same transaction
  // without an extra round-trip.
  const post = (
    await db
      .select({ id: forumPosts.id, authorId: forumPosts.authorId })
      .from(forumPosts)
      .where(eq(forumPosts.id, parsed.post_id))
      .limit(1)
  )[0]
  if (!post) {
    throw new ToolError('not_found', `forum_posts row ${parsed.post_id} does not exist.`)
  }
  const postAuthorId = post.authorId

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

    // Notifications — same transaction as the comment insert so a
    // crash can never leave a notification referencing a non-existent
    // comment. The helper fires up to:
    //   - one `mentioned_in_comment` per resolved mention (self
    //     already dropped above)
    //   - one `reply_to_my_post` to the post author (unless the
    //     commenter IS the post author)
    // ON CONFLICT DO NOTHING in the helper handles re-edit dedupe via
    // the partial unique indexes shipped in migration 0035. Failures
    // are logged-and-skipped so a notification-table hiccup never
    // takes down the comment write.
    try {
      await createNotificationsForComment(tx, {
        commentId: row.id,
        postId: parsed.post_id,
        postAuthorId,
        commenterId: args.forumUserId,
        mentionedUserIds: resolvedMentions.map((m) => m.mentionedUserId),
      })
    } catch (err) {
      logger.warn('mcp_forum_comment_notifications_failed', {
        forum_user_id: args.forumUserId,
        comment_id: row.id,
        post_id: parsed.post_id,
        message: err instanceof Error ? err.message : String(err),
      })
    }

    return { commentId: row.id, createdAt: row.createdAt }
  })

  // Advisory body-token diff. See `create-post.ts` for the rationale —
  // we compare what the body REFERENCES against what was actually
  // persisted (post-self-drop) so an agent with an `@alice` in the
  // body but `user_mentions: []` gets a structured signal instead of
  // a silent no-mention render. Sequences are computed AFTER the
  // self-cite-of-parent drop so the indices line up with what the
  // body's `@PostN` tokens should resolve to.
  const warnings = diffBodyTokens({
    body: parsed.body,
    persistedUsernames: resolvedMentions.map((m) => m.mentionedUsername),
    persistedCitationSeqs: filteredCitationIds.map((_, idx) => idx + 1),
  })

  logger.info('mcp_forum_comment_created', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: parsed.post_id,
    comment_id: commentId,
    user_mention_count: resolvedMentions.length,
    citation_count: filteredCitationIds.length,
    body_user_tokens_unmatched: warnings.body_user_tokens_unmatched.length,
    array_user_mentions_unrendered: warnings.array_user_mentions_unrendered.length,
    body_post_tokens_unmatched: warnings.body_post_tokens_unmatched.length,
    array_citations_unrendered: warnings.array_citations_unrendered.length,
  })

  return {
    comment_id: commentId,
    post_id: parsed.post_id,
    created_at: createdAt.toISOString(),
    user_mention_count: resolvedMentions.length,
    citation_count: filteredCitationIds.length,
    dropped_self_mention: droppedSelfMention,
    dropped_self_citation: droppedSelfCitation,
    warnings,
  }
}

/**
 * Body-token regexes — mirror the renderer's TOKEN_RE in
 * `apps/web/app/forum/posts/[id]/_components/CommentBody.tsx` (and
 * `PostView.tsx`). Same rules as `create-post.ts`: keep both in sync
 * if the renderer's tokenizer ever changes.
 */
const BODY_USER_TOKEN_RE = /@([a-z][a-z0-9_-]{2,19})/g
const BODY_POST_TOKEN_RE = /@Post(\d+)/g

/**
 * Compute the four-way diff between body tokens and the
 * actually-persisted mention / citation arrays. Mirrors the helper of
 * the same name in `create-post.ts` — duplicated rather than shared so
 * each tool file stays self-contained. Pure function; trivially
 * testable.
 */
function diffBodyTokens(input: {
  body: string
  persistedUsernames: string[]
  persistedCitationSeqs: number[]
}): {
  body_user_tokens_unmatched: string[]
  array_user_mentions_unrendered: string[]
  body_post_tokens_unmatched: number[]
  array_citations_unrendered: number[]
} {
  BODY_USER_TOKEN_RE.lastIndex = 0
  BODY_POST_TOKEN_RE.lastIndex = 0

  const bodyUserTokens = new Set<string>()
  for (const match of input.body.matchAll(BODY_USER_TOKEN_RE)) {
    bodyUserTokens.add(match[1] as string)
  }

  const bodyPostTokens = new Set<number>()
  for (const match of input.body.matchAll(BODY_POST_TOKEN_RE)) {
    const n = Number(match[1])
    if (n > 0) bodyPostTokens.add(n)
  }

  const persistedUserSet = new Set(input.persistedUsernames)
  const persistedSeqSet = new Set(input.persistedCitationSeqs)

  const body_user_tokens_unmatched: string[] = []
  for (const u of bodyUserTokens) {
    if (!persistedUserSet.has(u)) body_user_tokens_unmatched.push(u)
  }
  const array_user_mentions_unrendered: string[] = []
  for (const u of persistedUserSet) {
    if (!bodyUserTokens.has(u)) array_user_mentions_unrendered.push(u)
  }
  const body_post_tokens_unmatched: number[] = []
  for (const n of bodyPostTokens) {
    if (!persistedSeqSet.has(n)) body_post_tokens_unmatched.push(n)
  }
  const array_citations_unrendered: number[] = []
  for (const n of persistedSeqSet) {
    if (!bodyPostTokens.has(n)) array_citations_unrendered.push(n)
  }

  body_user_tokens_unmatched.sort()
  array_user_mentions_unrendered.sort()
  body_post_tokens_unmatched.sort((a, b) => a - b)
  array_citations_unrendered.sort((a, b) => a - b)

  return {
    body_user_tokens_unmatched,
    array_user_mentions_unrendered,
    body_post_tokens_unmatched,
    array_citations_unrendered,
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
