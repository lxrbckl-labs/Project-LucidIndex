// `ack_queue_item` — finalize a previously-pulled queue row.
//
// Verifies the caller holds the claim (claimed_by == agent_token_id), then:
//   - Sets queue.acked_at = now()
//   - Clears claimed_by / locked_until (so retries on failure are possible)
//   - Inserts a run_log row (one per ack)
//   - Updates targets.last_run_status / last_run_at / last_run_failure_reason
//   - Optionally bumps targets.high_water_mark
//
// `articles_count` on the run_log row is computed at ack time by counting
// the article rows already inserted via `write_articles` for this run. We
// match by `run_log_id` once we've created the run_log row — but because
// `write_articles` ran first, those article rows reference a run_log row
// that didn't exist yet. To keep the schema's NOT NULL FK constraints
// satisfied, write_articles creates an interim run_log row with a sentinel
// status; ack_queue_item promotes that row to its terminal status. See
// `write-articles.ts` for the matching half.
//
// TODO(#42): once claim-lock is atomic, the "verify claim" step here can
// drop the explicit check and rely on the row-level lock.

import { db } from '@lucidindex/db/client'
import { articles, queue, runLog, targets } from '@lucidindex/db/schema'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ToolError } from './index.js'

export const ackQueueItemInputShape = {
  queue_item_id: z.string().uuid(),
  status: z.enum(['succeeded', 'failed']),
  failure_reason: z.string().optional(),
  new_high_water_mark: z.unknown().optional(),
}

const ackQueueItemArgs = z.object(ackQueueItemInputShape)

export type AckQueueItemArgs = z.infer<typeof ackQueueItemArgs> & {
  agentTokenId: string
}

export async function ackQueueItem(args: AckQueueItemArgs): Promise<{ ok: true }> {
  const queueRows = await db
    .select({
      id: queue.id,
      targetId: queue.targetId,
      enqueuedAt: queue.enqueuedAt,
      claimedBy: queue.claimedBy,
      ackedAt: queue.ackedAt,
    })
    .from(queue)
    .where(eq(queue.id, args.queue_item_id))
    .limit(1)

  if (queueRows.length === 0) {
    throw new ToolError('queue_item_not_found', `Queue item ${args.queue_item_id} not found.`)
  }
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const q = queueRows[0]!

  if (q.ackedAt !== null) {
    throw new ToolError('queue_item_already_acked', 'Queue item has already been acknowledged.')
  }

  if (q.claimedBy !== args.agentTokenId) {
    throw new ToolError(
      'queue_item_not_claimed_by_caller',
      'This queue item is claimed by a different agent.',
    )
  }

  const now = new Date()

  // Count articles inserted for this queue item (write_articles tags them).
  // We match by target + by the run_log rows previously linked. Simpler
  // approach: count via the run_log rows for this queue_item_id — but those
  // were only created on prior write_articles calls. If write_articles never
  // ran (failed run), articles_count = 0.
  const interimRunLog = (
    await db
      .select({ id: runLog.id })
      .from(runLog)
      .where(eq(runLog.queueItemId, args.queue_item_id))
      .limit(1)
  )[0]

  let articlesCount = 0
  if (interimRunLog) {
    const counts = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(articles)
      .where(eq(articles.runLogId, interimRunLog.id))
    articlesCount = counts[0]?.c ?? 0
  }

  if (interimRunLog) {
    // Promote the existing interim run_log row to its terminal status.
    await db
      .update(runLog)
      .set({
        status: args.status,
        failureReason: args.failure_reason ?? null,
        articlesCount,
        completedAt: now,
        agentTokenId: args.agentTokenId,
      })
      .where(eq(runLog.id, interimRunLog.id))
  } else {
    // No write_articles call — create a fresh terminal run_log row.
    await db.insert(runLog).values({
      targetId: q.targetId,
      queueItemId: q.id,
      agentTokenId: args.agentTokenId,
      status: args.status,
      failureReason: args.failure_reason ?? null,
      articlesCount: 0,
      startedAt: q.enqueuedAt,
      completedAt: now,
    })
  }

  await db
    .update(queue)
    .set({ ackedAt: now, claimedBy: null, lockedUntil: null })
    .where(eq(queue.id, q.id))

  // Update target's last-run summary fields. high_water_mark only changes
  // if the caller passed `new_high_water_mark` (jsonb is opaque to us).
  const targetUpdates: Partial<{
    lastRunStatus: 'succeeded' | 'failed'
    lastRunAt: Date
    lastRunFailureReason: string | null
    highWaterMark: unknown
  }> = {
    lastRunStatus: args.status,
    lastRunAt: now,
    lastRunFailureReason: args.failure_reason ?? null,
  }
  if (args.new_high_water_mark !== undefined) {
    targetUpdates.highWaterMark = args.new_high_water_mark
  }
  await db.update(targets).set(targetUpdates).where(eq(targets.id, q.targetId))

  return { ok: true }
}
