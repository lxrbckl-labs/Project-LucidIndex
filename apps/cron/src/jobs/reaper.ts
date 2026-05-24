// #50 — Dead-lock reaper.
//
// Every minute, find queue rows whose `locked_until` has passed but were
// never acked, and release them back to the unlocked pool. This handles the
// case where an agent picked up work, crashed mid-run, and never returned —
// without the reaper, the row would stay locked forever and effectively
// vanish from the queue.
//
// Reset shape: `claimed_by = NULL, locked_until = NULL`. The next agent pull
// can claim it cleanly.
//
// The `queue_locked_until_unacked_idx` partial index (declared in
// packages/db/schema/targets.ts) keeps this UPDATE cheap as the queue grows
// — Postgres only walks rows where acked_at IS NULL.
//
// Per NO DELETIONS: we never delete queue rows. Acked rows accumulate as a
// soft archive; reaper only releases unacked ones.
//
// Audit round 8 / migration 0034 — orphan run_log cleanup:
// pull_queue_item now INSERTs an in_progress run_log row at claim time.
// When the reaper releases a stale claim (agent crashed mid-run), the
// matching in_progress run_log row is left behind as an orphan — it has
// no terminal status, no completed_at, and (in the common case) no
// articles. The next claim of the same queue item (potentially by a
// different agent) would be blocked by the (queue_item_id, agent_token_id)
// UNIQUE if the same agent retries.
//
// We DELETE those orphans in the same transaction as the queue release.
// Safe because:
//   (a) status='in_progress' uniquely identifies a not-yet-acked row;
//   (b) we only delete rows with ZERO articles attached — if articles ARE
//       present the agent at least partially completed write_articles, so
//       we preserve the row (status stays 'in_progress' and an operator
//       can decide what to do — there is no automated promotion path);
//   (c) the queue row release is what authoritatively says "this run is
//       over." Deleting the run_log here is NOT a "deletion of meaningful
//       data" — it's removing a never-completed in-flight marker,
//       comparable to the queue's claim release.

import { db } from '@lucidindex/db/client'
import { and, eq, inArray, isNull, sql } from '@lucidindex/db/query'
import { articles, queue, runLog } from '@lucidindex/db/schema'
import { type JobDetails, runJob } from '../lib/run-job.js'

export async function runReaper(): Promise<void> {
  await runJob('reaper', async (): Promise<JobDetails> => {
    return await db.transaction(async (tx) => {
      const reaped = await tx
        .update(queue)
        .set({ claimedBy: null, lockedUntil: null })
        .where(and(isNull(queue.ackedAt), sql`${queue.lockedUntil} < now()`))
        .returning({ id: queue.id })

      // Sweep orphan in_progress run_log rows for the queue items we
      // just released. Two-phase: find candidate run_log rows for the
      // released queue items, then delete the ones with zero articles.
      // A single statement with a NOT EXISTS subquery would be tighter
      // but the volumes here are tiny (≤ a handful per tick) and the
      // explicit form is easier to audit.
      let orphansDeleted = 0
      if (reaped.length > 0) {
        const queueIds = reaped.map((r) => r.id)
        const candidates = await tx
          .select({ id: runLog.id })
          .from(runLog)
          .where(and(inArray(runLog.queueItemId, queueIds), eq(runLog.status, 'in_progress')))
        if (candidates.length > 0) {
          const candidateIds = candidates.map((c) => c.id)
          const withArticles = await tx
            .selectDistinct({ runLogId: articles.runLogId })
            .from(articles)
            .where(inArray(articles.runLogId, candidateIds))
          const withArticlesSet = new Set(withArticles.map((w) => w.runLogId))
          const toDelete = candidateIds.filter((id) => !withArticlesSet.has(id))
          if (toDelete.length > 0) {
            const deleted = await tx
              .delete(runLog)
              .where(and(inArray(runLog.id, toDelete), eq(runLog.status, 'in_progress')))
              .returning({ id: runLog.id })
            orphansDeleted = deleted.length
          }
        }
      }

      return { reaped: reaped.length, run_log_orphans_deleted: orphansDeleted }
    })
  })
}
