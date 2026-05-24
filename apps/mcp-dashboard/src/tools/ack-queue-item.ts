// `ack_queue_item` — finalize a previously-pulled queue row.
//
// Verifies the caller holds the claim (claimed_by == agent_token_id), then:
//   - Sets queue.acked_at = now()
//   - Clears claimed_by / locked_until (so retries on failure are possible)
//   - Updates the run_log row created by write_articles, OR inserts a fresh
//     run_log row if the agent never called write_articles
//   - Updates targets.last_run_status / last_run_at / last_run_failure_reason
//   - Optionally bumps targets.high_water_mark
//
// run_log timing — flow change (was: created here; now: created by
// write_articles, see write-articles.ts header):
//
// `articles` rows reference `run_log.id` via a non-null FK, so the row
// must exist before any article inserts. write_articles is now the
// authoritative creator of the run_log row (status='succeeded' on
// creation). ack_queue_item:
//   - if a run_log row already exists for this queue_item — promote /
//     adjust its terminal status (a 'failed' ack overwrites the optimistic
//     'succeeded' set by write_articles);
//   - otherwise (no write_articles call happened) — insert a fresh
//     run_log row with articles_count = 0.
//
// articles_count is recomputed authoritatively here from the actual
// articles row count tied to the run_log_id, so it stays correct even
// across multiple write_articles calls or partial-failure scenarios.
//
// #42 made the claim-lock atomic, so the explicit "claimed_by ==
// agent_token_id" check below is technically belt-and-suspenders — but
// it's cheap and gives a clear error code, so we keep it.

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

export type AckQueueItemResult = {
  ok: true
  /**
   * The values that ACTUALLY landed on the relevant rows after the ack.
   * Echoed back so the agent can verify what was persisted without a
   * follow-up read.
   *
   * - `articles_count` — authoritative count of articles tied to this
   *   queue item's run_log row (recomputed here from the articles table,
   *   not trusted from accumulated write_articles deltas).
   * - `high_water_mark` — the target's high_water_mark after the ack.
   *   Unchanged from the pre-call value if `new_high_water_mark` was
   *   omitted.
   */
  persisted: {
    articles_count: number
    high_water_mark: unknown
  }
}

export async function ackQueueItem(args: AckQueueItemArgs): Promise<AckQueueItemResult> {
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

  // P2 (audit round 3): the queue ack + run_log update + target hwm
  // update are wrapped in a single transaction so a partial failure
  // can't leave any of the three rows in a stale state (e.g. queue acked
  // but target hwm not bumped — agent thinks the run landed but the
  // next cron tick re-enqueues from the old hwm and re-runs the work).
  let articlesCount = 0
  let persistedHwm: unknown = null

  await db.transaction(async (tx) => {
    // Locate the run_log row write_articles created (if any).
    const existingRunLog = (
      await tx
        .select({ id: runLog.id })
        .from(runLog)
        .where(eq(runLog.queueItemId, args.queue_item_id))
        .limit(1)
    )[0]

    if (existingRunLog) {
      // Recount articles authoritatively for this run_log row.
      const counts = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(articles)
        .where(eq(articles.runLogId, existingRunLog.id))
      articlesCount = counts[0]?.c ?? 0

      await tx
        .update(runLog)
        .set({
          status: args.status,
          failureReason: args.failure_reason ?? null,
          articlesCount,
          completedAt: now,
          agentTokenId: args.agentTokenId,
        })
        .where(eq(runLog.id, existingRunLog.id))
    } else {
      // No write_articles call was made — insert a fresh terminal run_log
      // row with articles_count = 0.
      articlesCount = 0
      await tx.insert(runLog).values({
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

    await tx
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
    await tx.update(targets).set(targetUpdates).where(eq(targets.id, q.targetId))

    // Re-read the target's high_water_mark inside the transaction so the
    // persisted value we return reflects the post-update state and is a
    // consistent read against the same xact's writes.
    const targetRow = await tx
      .select({ highWaterMark: targets.highWaterMark })
      .from(targets)
      .where(eq(targets.id, q.targetId))
      .limit(1)
    persistedHwm = targetRow[0]?.highWaterMark ?? null
  })

  return {
    ok: true,
    persisted: {
      articles_count: articlesCount,
      high_water_mark: persistedHwm,
    },
  }
}
