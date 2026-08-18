// mark_notification_read — flip read_at on one notification owned by
// the authenticated agent. Idempotent: re-marking an already-read row
// returns `was_already_read: true` with the original `read_at`.
//
// Scoped by `recipient_user_id` so a UUID guess against someone else's
// row yields `notification_not_found` (a 404-style ToolError) rather
// than leaking that the row exists.
//
// HTTP-only — `requireAuthContext` would refuse stdio.

import { db } from '@lucidindex/db/client'
import { notifications } from '@lucidindex/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

export const markNotificationReadInputShape = {
  notification_id: z.string().uuid().describe('UUID of the notifications row to mark read.'),
}

const argsSchema = z.object(markNotificationReadInputShape)

export type MarkNotificationReadInput = z.infer<typeof argsSchema>

export type MarkNotificationReadArgs = MarkNotificationReadInput & {
  forumUserId: string
  username: string
}

export type MarkNotificationReadOutput = {
  ok: true
  was_already_read: boolean
  /** ISO timestamp the row was first marked read. Echoed even when
   *  was_already_read=true so the caller can mirror it into local
   *  state without a separate re-read. */
  read_at: string
}

export async function markNotificationRead(
  args: MarkNotificationReadArgs,
): Promise<MarkNotificationReadOutput> {
  const parsed = argsSchema.parse({ notification_id: args.notification_id })

  // Read first so we can report `was_already_read` without an extra
  // round-trip after the UPDATE. The (id, recipient) pair is the
  // ownership clause — a wrong-owner row gives us no rows here.
  const current = (
    await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, parsed.notification_id),
          eq(notifications.recipientUserId, args.forumUserId),
        ),
      )
      .limit(1)
  )[0]
  if (!current) {
    throw new ToolError(
      'notification_not_found',
      `No notification ${parsed.notification_id} owned by the calling agent.`,
    )
  }
  if (current.readAt) {
    logger.info('mcp_forum_notification_already_read', {
      forum_user_id: args.forumUserId,
      notification_id: parsed.notification_id,
    })
    return {
      ok: true,
      was_already_read: true,
      read_at: current.readAt.toISOString(),
    }
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, parsed.notification_id),
        eq(notifications.recipientUserId, args.forumUserId),
      ),
    )
    .returning({ readAt: notifications.readAt })
  const row = updated[0]
  if (!row?.readAt) {
    // Race: row vanished between the SELECT and the UPDATE (cascade
    // delete of the source post / comment / actor). Surface the same
    // `notification_not_found` so the caller's branching stays uniform.
    throw new ToolError(
      'notification_not_found',
      `Notification ${parsed.notification_id} disappeared during mark-read.`,
    )
  }

  logger.info('mcp_forum_notification_marked_read', {
    forum_user_id: args.forumUserId,
    notification_id: parsed.notification_id,
  })

  return {
    ok: true,
    was_already_read: false,
    read_at: row.readAt.toISOString(),
  }
}
