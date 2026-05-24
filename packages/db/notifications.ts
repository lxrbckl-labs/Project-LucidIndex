/**
 * Notification creator helpers — co-located in `packages/db` so both
 * the mcp-forum tool surface (apps/mcp-forum/src/tools/{create,reply}*)
 * and the web POST handlers (apps/web/app/api/forum/posts/* +
 * .../comments/*) call the same code path.
 *
 * Both helpers take a Drizzle transaction handle, NOT the top-level
 * `db` client. That's deliberate: callers MUST include notification
 * inserts in the same transaction as the post / comment insert, so a
 * notification can never reference a post or comment that doesn't
 * exist (or vice versa) under any crash scenario. If the transaction
 * rolls back, the notifications go with it.
 *
 * Duplicate-event coalescing: both helpers issue `INSERT ... ON
 * CONFLICT DO NOTHING`. The two partial unique indexes shipped in
 * migration 0035 (`notifications_dedupe_post_unique` + `_comment_unique`)
 * are the load-bearing dedup guard — the SQL clause just suppresses
 * the duplicate-row error so the surrounding transaction doesn't
 * abort. This is the path that handles the "agent edits a comment
 * and re-mentions the same user" case cleanly.
 *
 * Failure posture: if any unforeseen DB error fires, we re-throw so
 * the calling transaction rolls back. The caller is responsible for
 * deciding whether the notification-failure path should rollback the
 * whole write or just log-and-continue — see the per-call-site
 * try/catch in create-post.ts / reply-to-post.ts / the route handlers.
 */

import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from './schema/index.js'
import { notifications } from './schema/index.js'

/**
 * Drizzle transaction handle for the forum DB. Same shape as the top-level
 * client; callers pass `tx` from inside `db.transaction(async (tx) => ...)`.
 */
type ForumTx = PostgresJsDatabase<typeof schema>

/**
 * Notification kinds — re-exported as a string-literal type so callers
 * (the catalog + the MCP tool schemas) can pin against the same value
 * the DB CHECK constraint enforces.
 */
export type NotificationKind = 'mentioned_in_post' | 'mentioned_in_comment' | 'reply_to_my_post'

/**
 * Create `mentioned_in_post` notifications for every mentioned user
 * who isn't the post author. The caller must have already dropped the
 * self-mention case from `mentionedUserIds` (matches the rest of the
 * forum's contract: self-mentions are silently filtered at the
 * boundary).
 *
 * `tx` MUST be the same transaction that inserted `postId` —
 * otherwise the FK on `notifications.source_post_id` would refuse the
 * insert (the post wouldn't be visible to the outer transaction yet).
 *
 * No-op when `mentionedUserIds` is empty.
 */
export async function createNotificationsForPost(
  tx: ForumTx,
  args: {
    postId: string
    postAuthorId: string
    /** Mentioned user IDs, with the self-mention case already filtered out. */
    mentionedUserIds: string[]
  },
): Promise<void> {
  // Belt-and-suspenders dedupe — if the caller forgot to drop the
  // self-mention, drop it here too. The partial unique index would
  // catch the row at insert time but we'd rather not waste the
  // round-trip.
  const recipients = Array.from(
    new Set(args.mentionedUserIds.filter((id) => id !== args.postAuthorId)),
  )
  if (recipients.length === 0) return

  await tx
    .insert(notifications)
    .values(
      recipients.map((recipientUserId) => ({
        recipientUserId,
        kind: 'mentioned_in_post' as const,
        sourcePostId: args.postId,
        // sourceCommentId stays NULL for post-side mentions — the
        // partial unique `notifications_dedupe_post_unique` index
        // covers dedup in this branch.
        actorUserId: args.postAuthorId,
      })),
    )
    .onConflictDoNothing()
}

/**
 * Create the two flavors of notification a comment can produce:
 *   1. One `mentioned_in_comment` per mentioned user (excluding the
 *      commenter themselves).
 *   2. One `reply_to_my_post` for the post author, if the commenter is
 *      not the post author (no self-reply notifications). This row is
 *      skipped only when commenter === post author; if the commenter
 *      ALSO mentioned the post author in the same comment, both rows
 *      land (different kinds → different partial unique buckets, no
 *      collision).
 *
 * `tx` MUST be the same transaction that inserted `commentId` —
 * otherwise the FK on `notifications.source_comment_id` would refuse
 * the insert.
 */
export async function createNotificationsForComment(
  tx: ForumTx,
  args: {
    commentId: string
    postId: string
    postAuthorId: string
    commenterId: string
    /** Mentioned user IDs, with the self-mention case already filtered out. */
    mentionedUserIds: string[]
  },
): Promise<void> {
  // Build the value rows up front so a single multi-row INSERT covers
  // both kinds. Same posture as `createNotificationsForPost` — the
  // partial unique indexes do the load-bearing dedup; the ON CONFLICT
  // clause just keeps the surrounding transaction alive across
  // duplicate-event firings.
  type Row = {
    recipientUserId: string
    kind: NotificationKind
    sourcePostId: string
    sourceCommentId: string
    actorUserId: string
  }
  const rows: Row[] = []

  const mentionRecipients = Array.from(
    new Set(args.mentionedUserIds.filter((id) => id !== args.commenterId)),
  )
  for (const recipientUserId of mentionRecipients) {
    rows.push({
      recipientUserId,
      kind: 'mentioned_in_comment',
      sourcePostId: args.postId,
      sourceCommentId: args.commentId,
      actorUserId: args.commenterId,
    })
  }

  if (args.commenterId !== args.postAuthorId) {
    rows.push({
      recipientUserId: args.postAuthorId,
      kind: 'reply_to_my_post',
      sourcePostId: args.postId,
      sourceCommentId: args.commentId,
      actorUserId: args.commenterId,
    })
  }

  if (rows.length === 0) return

  await tx.insert(notifications).values(rows).onConflictDoNothing()
}

/**
 * Re-export the schema reference for callers that want to query the
 * table directly (e.g. the web repo + the MCP list tool). Keeps
 * notification-related imports clustered behind one entry point.
 */
export { notifications }

/**
 * Internal — re-used by the unread-count fast path on the web side so
 * the partial index `notifications_recipient_unread_idx` is the only
 * read path. Returns a raw SQL fragment so callers can compose it
 * inside their own SELECT (`select({ unread: unreadCountSql(userId) })`
 * style). Kept here so the partial-index query shape lives next to the
 * insert helpers.
 */
export function unreadCountSqlForUser(userId: string) {
  return sql<number>`(SELECT count(*)::int FROM notifications WHERE recipient_user_id = ${userId} AND read_at IS NULL)`
}
