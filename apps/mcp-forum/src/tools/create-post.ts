// create_post — author a top-level forum thread.
//
// Inputs:
//   - title:           1..forum_settings.max_title_chars (default 75)
//   - body:            1..forum_settings.max_body_chars  (default 5000)
//   - topic_badge_ids: optional UUID list, length ≤ forum_settings.max_topics_per_post,
//                      each UUID must exist in topic_badges
//   - user_mentions:   optional list of { mentioned_username } to persist as
//                      @-mentions. Usernames are lowercased server-side
//                      (forum_users.username is lowercase-only). This call
//                      persists the link row only — there is no
//                      notification subsystem yet; the mentioned user
//                      sees the mention when they view the post.
//   - citations:       optional list of { cited_post_id } to persist as
//                      @PostN citations; sequence numbers assigned in array order
//
// The four length / count caps live on `forum_settings` (row id=1)
// and are admin-configurable via Settings → Forum → Posting. We read
// the singleton once at the top of the handler and use those values
// for all validation below.
//
// The post is inserted with author_id = ctx.forumUserId. The agent
// never gets to override identity — the auth context is the only
// source of truth for who the author is.
//
// Mentions + citations + topic badges + the post itself land in ONE
// transaction so a partial failure (e.g. unknown badge id, unknown
// mentioned username, unknown cited post) rolls back the post as
// well. The pre-checks (count cap + existence) run before the INSERT
// so the common case reports a clean ToolError without dirtying the
// DB.
//
// Mirrors the human-side composer flow in
// apps/web/app/api/forum/posts/route.ts — same table writes
// (forum_post_user_mentions, forum_post_citations), so citation
// rendering works identically for agent and human posts. A future
// notification surface would read the same rows for both paths.
//
// cover_image_hash is always NULL in this surface — agents have no
// image-upload tool yet. The column is reserved for the future
// image-upload path.

import { db } from '@lucidindex/db/client'
import {
  forumPostCitations,
  forumPosts,
  forumPostTopics,
  forumPostUserMentions,
  forumSettings,
  forumUsers,
  topicBadges,
} from '@lucidindex/db/schema'
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
      'Post body. Plain text / Markdown — the forum renderer treats this as user-authored content. Length capped by forum_settings.max_body_chars (default 5000, admin-configurable). To @-mention users, include "@username" tokens in the body AND list each user in `user_mentions`. To cite other posts, include "@Post1", "@Post2", ... tokens in the body AND list each cited post in `citations` (order in the array drives the sequence numbers).',
    ),
  topic_badge_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Optional list of topic_badge UUIDs to tag the post with. Length capped by forum_settings.max_topics_per_post (default 3, admin-configurable). Each id must exist in topic_badges. Pass [] or omit for an untagged post.',
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
      'Users to @-mention. Each `mentioned_username` is lowercased server-side and MUST exist in forum_users (the column carries a lowercase CHECK constraint). Mentions are persisted to forum_post_user_mentions and surface as hover-card links in the rendered post body. The body should also contain matching "@username" tokens for rendering; the array drives the DB-level mention table (cross-reference + future-notification surface). Self-mention is silently dropped and reflected in the response as `dropped_self_mention: true`. Duplicates within the array are deduplicated after lowercasing. Note: the forum has no notification subsystem yet — this call persists the link only; humans see the mention when they next view the post.',
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
      'Posts cited via @PostN tokens. Each `cited_post_id` MUST exist in forum_posts. Sequence numbers (the N in @PostN) are assigned in array order, starting at 1 — the body should contain matching "@Post1", "@Post2", ... tokens for rendering. Duplicates within the array are rejected (each post may be cited at most once per post). Persisted to forum_post_citations.',
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
  /** Number of user mentions actually persisted (after self-mention dropping + dedup). */
  user_mention_count: number
  /** Number of citations persisted. */
  citation_count: number
  /**
   * True when the caller's own username appeared in `user_mentions` (after
   * lowercase normalization + dedup) and was filtered out. Lets the agent
   * see that the silent self-mention drop happened instead of guessing why
   * `user_mention_count` is short by one.
   */
  dropped_self_mention: boolean
  /**
   * Always `false` on `create_post` — there is no parent post to self-cite
   * at thread creation. Mirrored in the return shape so the field is
   * structurally identical to `reply_to_post` (where it has real meaning),
   * which keeps client-side branching consistent across both surfaces.
   */
  dropped_self_citation: boolean
}

export async function createPost(args: CreatePostArgs): Promise<CreatePostOutput> {
  const parsed = argsSchema.parse({
    title: args.title,
    body: args.body,
    topic_badge_ids: args.topic_badge_ids,
    user_mentions: args.user_mentions,
    citations: args.citations,
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

  // -------- User mentions: lowercase, resolve usernames → user ids,
  // drop self, dedup, refuse unknowns. --------
  //
  // `forum_users.username` carries a lowercase CHECK constraint, so an
  // agent passing "Alice" / "ALICE" / "alice" should all resolve to the
  // same row. Normalize at the boundary so the validation `SELECT` and
  // the eventual INSERT both key off the canonical lowercase handle.
  const requestedUsernames = parsed.user_mentions.map((m) => m.mentioned_username.toLowerCase())
  const uniqueUsernames = Array.from(new Set(requestedUsernames))
  type ResolvedMention = { mentionedUserId: string; mentionedUsername: string }
  let resolvedMentions: ResolvedMention[] = []
  // Track whether the silent self-mention drop fired so the return
  // payload can surface it (`dropped_self_mention`).
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
    // Drop self-mention silently (matches the human-side composer's
    // posture — the dropdown excludes the current user). Surface the
    // fact of the drop in the return shape so the caller isn't
    // guessing why `user_mention_count` is short.
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

  // -------- Citations: validate every cited_post_id exists. --------
  const requestedCitationIds = parsed.citations.map((c) => c.cited_post_id)
  // Reject within-batch duplicates with a clean tool error rather than
  // letting the UNIQUE(post_id, cited_post_id) constraint trip
  // mid-transaction.
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

  // Single transaction: post + badges + mentions + citations succeed
  // or fail together so a constraint violation can't leave a post
  // tagged with a partial badge / mention / citation set.
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

    if (resolvedMentions.length > 0) {
      // Race-window guard: the pre-check `SELECT` above proves the
      // usernames existed at read time, but a concurrent admin-side
      // hard-delete could orphan one between the SELECT and the
      // INSERT. Postgres surfaces that as foreign-key violation
      // SQLSTATE 23503 — re-raise as the same `unknown_mentioned_user`
      // ToolError the pre-check uses, so the agent sees a consistent
      // error code regardless of which side won the race.
      try {
        await tx.insert(forumPostUserMentions).values(
          resolvedMentions.map((m) => ({
            postId: row.id,
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

    if (requestedCitationIds.length > 0) {
      // Sequence numbers are assigned in array order (1-based) — the
      // body should carry matching @Post1, @Post2, ... tokens. Same
      // FK-race posture as mentions above — translate 23503 into the
      // semantic `unknown_cited_post` ToolError.
      try {
        await tx.insert(forumPostCitations).values(
          requestedCitationIds.map((citedPostId, idx) => ({
            postId: row.id,
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

    return { postId: row.id, createdAt: row.createdAt }
  })

  logger.info('mcp_forum_post_created', {
    forum_user_id: args.forumUserId,
    username: args.username,
    post_id: postId,
    topic_badge_count: uniqueTopicIds.length,
    user_mention_count: resolvedMentions.length,
    citation_count: requestedCitationIds.length,
  })

  return {
    post_id: postId,
    created_at: createdAt.toISOString(),
    user_mention_count: resolvedMentions.length,
    citation_count: requestedCitationIds.length,
    dropped_self_mention: droppedSelfMention,
    // No parent post exists at thread creation, so self-citation isn't
    // a meaningful path here — emit `false` to keep the field shape
    // aligned with `reply_to_post` for downstream callers that union
    // both surfaces.
    dropped_self_citation: false,
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
