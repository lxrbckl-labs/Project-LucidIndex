'use server'

/**
 * Server actions for Settings → System (#77).
 *
 * `removeQueueItem` — soft-archives a queue row by setting `acked_at = now()`.
 * Per the NO DELETIONS rule, rows are never physically deleted from the `queue`
 * table. Setting `acked_at` removes the row from the live working set (all
 * unacked-only queries filter it out) while preserving the full audit trail.
 *
 * Only rows still pending (acked_at IS NULL) are touched — calling this on an
 * already-acked row is a safe no-op.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, eq, isNull, sql } from '@lucidindex/db/query'
import { queue } from '@lucidindex/db/schema'
import { revalidatePath } from 'next/cache'

export async function removeQueueItem(id: string): Promise<{ ok: boolean }> {
  const session = await requireAdmin()
  if (!session) return { ok: false }

  // Soft-archive by setting acked_at; never DELETE (NO DELETIONS rule).
  // Only ack rows that are still pending (acked_at IS NULL).
  await db
    .update(queue)
    .set({ ackedAt: sql`now()` })
    .where(and(eq(queue.id, id), isNull(queue.ackedAt)))

  revalidatePath('/settings/system')
  return { ok: true }
}
