/**
 * Server-only data helpers for the Settings → Notifications panel + the
 * matching `/api/forum/notifications` routes.
 *
 * Notification rows live in the `notifications` table (migration 0035).
 * Everything here is scoped by `recipient_user_id` — callers MUST pass
 * the authenticated forum user's id and we always include it in the
 * WHERE clause so a UUID guess from another user's session can't
 * read / mark / delete rows that aren't theirs.
 *
 * Pagination: opaque cursor, newest-first. The cursor is the
 * `created_at` ISO string of the last item returned; the next page is
 * `created_at < cursor`. The `notifications_recipient_created_idx`
 * btree (recipient_user_id, created_at DESC) backs both the initial
 * read and the cursor lookup.
 *
 * Joins: the list shape carries the actor's username + `is_agent` flag
 * AND the source post's title so a render pass on the client doesn't
 * need a second round-trip per row.
 */

import { db } from '@lucidindex/db/client'
import { and, desc, eq, lt, sql } from '@lucidindex/db/query'
import { forumPosts, forumUsers, notifications } from '@lucidindex/db/schema'

/** Hard ceiling on `limit` — server-side cap so a malicious caller
 *  can't request 100k rows. The default is intentionally generous
 *  enough to back a typical "first page" render. */
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * One row in the paginated notification list. Shape is shared between
 * the web `/api/forum/notifications` GET handler and the MCP
 * `list_my_notifications` tool — keep them in sync if you add fields.
 */
export type NotificationListItem = {
  id: string
  kind: 'mentioned_in_post' | 'mentioned_in_comment' | 'reply_to_my_post'
  actor_username: string
  actor_is_agent: boolean
  post_id: string
  post_title: string
  comment_id: string | null
  read_at: string | null
  created_at: string
}

export type NotificationListPage = {
  items: NotificationListItem[]
  next_cursor: string | null
}

export type ListOptions = {
  /** Cap is enforced server-side; values outside [1, MAX_LIMIT] are clamped. */
  limit?: number
  /** ISO `created_at` of the last item from the previous page. */
  cursor?: string | null
  /** If true, hides rows whose `read_at` is non-null. */
  only_unread?: boolean
}

function clampLimit(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input)) return DEFAULT_LIMIT
  if (input < 1) return 1
  if (input > MAX_LIMIT) return MAX_LIMIT
  return Math.floor(input)
}

function parseCursor(cursor: string | null | undefined): Date | null {
  if (!cursor) return null
  const d = new Date(cursor)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Paginated newest-first list for one recipient. Joins:
 *   - `actor` forum_users for username + is_agent
 *   - `forum_posts` (sourcePostId) for the post title
 *
 * Each row is fully self-describing so the renderer (web row OR MCP
 * tool output) doesn't need a second fetch.
 */
export async function listNotifications(
  userId: string,
  options: ListOptions = {},
): Promise<NotificationListPage> {
  const limit = clampLimit(options.limit)
  const cursorDate = parseCursor(options.cursor)

  // We fetch one extra row to know whether a next_cursor exists; if we
  // got back `limit + 1` rows, the (limit+1)th becomes the cursor and
  // we strip it from the visible page.
  const filters = [eq(notifications.recipientUserId, userId)]
  if (cursorDate) {
    filters.push(lt(notifications.createdAt, cursorDate))
  }
  if (options.only_unread) {
    filters.push(sql`${notifications.readAt} IS NULL`)
  }

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      postId: notifications.sourcePostId,
      commentId: notifications.sourceCommentId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorUsername: forumUsers.username,
      actorIsAgent: forumUsers.isAgent,
      postTitle: forumPosts.title,
    })
    .from(notifications)
    .innerJoin(forumUsers, eq(forumUsers.id, notifications.actorUserId))
    .innerJoin(forumPosts, eq(forumPosts.id, notifications.sourcePostId))
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const lastVisible = visible[visible.length - 1]
  const nextCursor = hasMore && lastVisible ? lastVisible.createdAt.toISOString() : null

  const items: NotificationListItem[] = visible.map((r) => ({
    id: r.id,
    kind: r.kind as NotificationListItem['kind'],
    actor_username: r.actorUsername,
    actor_is_agent: r.actorIsAgent,
    post_id: r.postId,
    post_title: r.postTitle,
    comment_id: r.commentId,
    read_at: r.readAt ? r.readAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
  }))

  return { items, next_cursor: nextCursor }
}

/**
 * Fast unread count, backed by the partial index
 * `notifications_recipient_unread_idx` (recipient_user_id WHERE
 * read_at IS NULL). Single number — used by the sidebar badge.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), sql`${notifications.readAt} IS NULL`))
  const row = rows[0]
  return row?.count ?? 0
}

/**
 * Mark one notification as read. Scoped by `recipient_user_id` so a
 * UUID guess against someone else's row no-ops instead of leaking.
 * Returns the updated row's `read_at` so the caller can mirror the
 * change client-side without a re-fetch.
 *
 * Idempotent: re-marking an already-read row leaves the original
 * `read_at` intact and reports `was_already_read = true`.
 */
export type MarkReadResult =
  | { found: false }
  | { found: true; was_already_read: boolean; read_at: string }

export async function markRead(userId: string, notificationId: string): Promise<MarkReadResult> {
  // Read current state first so we can report was_already_read
  // without a second round-trip after the UPDATE.
  const current = (
    await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, userId)))
      .limit(1)
  )[0]
  if (!current) return { found: false }
  if (current.readAt) {
    return {
      found: true,
      was_already_read: true,
      read_at: current.readAt.toISOString(),
    }
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, userId)))
    .returning({ readAt: notifications.readAt })
  const row = updated[0]
  if (!row?.readAt) {
    // Lost a race with a cascade delete or the row vanished between
    // the SELECT and the UPDATE.
    return { found: false }
  }
  return {
    found: true,
    was_already_read: false,
    read_at: row.readAt.toISOString(),
  }
}

/**
 * Hard-delete one notification, scoped by recipient. This IS a
 * deletion — the rule is "notifications are ephemeral UX state, not
 * audit records" (same exemption as forum_post_stars).
 *
 * Returns true if a row was removed, false if no row matched the
 * (id, recipient) pair.
 */
export async function deleteOne(userId: string, notificationId: string): Promise<boolean> {
  const result = await db
    .delete(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, userId)))
    .returning({ id: notifications.id })
  return result.length > 0
}

/**
 * Hard-delete every notification belonging to a recipient. Backs the
 * "Clear all" button on the notifications page. Returns the number of
 * rows removed so the caller can surface a toast.
 */
export async function clearAll(userId: string): Promise<number> {
  const result = await db
    .delete(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .returning({ id: notifications.id })
  return result.length
}

/**
 * Same shape as `listNotifications` but with an additional join for
 * comment context — used by the MCP `list_my_notifications` tool so
 * agents can see which comment they were mentioned in without a
 * second round-trip. Kept here next to `listNotifications` so the two
 * query shapes stay close.
 *
 * The web UI uses the smaller `listNotifications`; the MCP surface
 * uses this one because agents handle the data programmatically.
 */
export async function listNotificationsForAgent(
  userId: string,
  options: ListOptions = {},
): Promise<NotificationListPage> {
  // For now the agent + human shapes are identical. Re-exported so
  // the MCP tool can pin to a stable function name; if the agent
  // surface ever needs additional fields (e.g. comment body excerpt)
  // they'd be added here without disturbing the web path.
  return listNotifications(userId, options)
}
