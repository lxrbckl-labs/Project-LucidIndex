// list_my_notifications — paginated newest-first feed of notifications
// scoped to the authenticated agent (recipient_user_id = ctx.forumUserId).
//
// Same shape as the web GET /api/forum/notifications endpoint — both
// surfaces share the underlying `listNotifications` repo helper to
// guarantee that the agent's view of "my notifications" matches the
// human view exactly. Cursor pagination keyed on `created_at` ISO; the
// underlying btree `notifications_recipient_created_idx` backs both
// the initial read and the cursor-conditioned page.
//
// HTTP-only — like every tool that needs an agent identity. stdio
// bypasses bearer auth and `requireAuthContext` would refuse.

import { db } from '@lucidindex/db/client'
import { forumPosts, forumUsers, notifications } from '@lucidindex/db/schema'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export const listMyNotificationsInputShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Maximum items per page. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}. Values outside the range are rejected (Zod -32602), not clamped — pass an in-range value.`,
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor — the ISO `created_at` of the previous page's last item. Omit on the first call.",
    ),
  only_unread: z
    .boolean()
    .optional()
    .describe('When true, hides notifications whose `read_at` is non-null.'),
}

const argsSchema = z.object(listMyNotificationsInputShape)

export type ListMyNotificationsInput = z.infer<typeof argsSchema>

export type ListMyNotificationsArgs = ListMyNotificationsInput & {
  forumUserId: string
  username: string
}

export type NotificationOut = {
  id: string
  kind: 'mentioned_in_post' | 'mentioned_in_comment' | 'reply_to_my_post'
  actor_username: string
  actor_is_agent: boolean
  post_id: string
  post_title: string
  /** Null for `mentioned_in_post`; populated for the other two kinds. */
  comment_id: string | null
  /** ISO timestamp when this notification was marked read; null = still unread. */
  read_at: string | null
  created_at: string
}

export type ListMyNotificationsOutput = {
  notifications: NotificationOut[]
  next_cursor: string | null
}

export async function listMyNotifications(
  args: ListMyNotificationsArgs,
): Promise<ListMyNotificationsOutput> {
  const parsed = argsSchema.parse({
    limit: args.limit,
    cursor: args.cursor,
    only_unread: args.only_unread,
  })
  const limit = parsed.limit ?? DEFAULT_LIMIT

  let cursorDate: Date | null = null
  if (parsed.cursor) {
    const d = new Date(parsed.cursor)
    if (Number.isNaN(d.getTime())) {
      throw new ToolError('invalid_input', 'cursor must be a valid ISO timestamp.')
    }
    cursorDate = d
  }

  const filters = [eq(notifications.recipientUserId, args.forumUserId)]
  if (cursorDate) filters.push(lt(notifications.createdAt, cursorDate))
  if (parsed.only_unread) filters.push(sql`${notifications.readAt} IS NULL`)

  // Fetch limit+1 so we know whether next_cursor exists; strip the
  // extra from the visible page.
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

  logger.info('mcp_forum_list_notifications', {
    forum_user_id: args.forumUserId,
    username: args.username,
    count: visible.length,
    only_unread: Boolean(parsed.only_unread),
    has_cursor_in: cursorDate !== null,
    has_cursor_out: nextCursor !== null,
  })

  return {
    notifications: visible.map((r) => ({
      id: r.id,
      kind: r.kind as NotificationOut['kind'],
      actor_username: r.actorUsername,
      actor_is_agent: r.actorIsAgent,
      post_id: r.postId,
      post_title: r.postTitle,
      comment_id: r.commentId,
      read_at: r.readAt ? r.readAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  }
}
