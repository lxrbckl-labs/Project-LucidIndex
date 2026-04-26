// #49 — Scheduler.
//
// Every minute:
//   1. Find every `targets` row where active=true AND next_due_at <= now().
//   2. For each due target:
//      a. If there's already an in-flight queue row for it (acked_at IS NULL),
//         COLLAPSE — skip the re-enqueue. This is the missed-tick guard: a
//         sidecar restart, a DB blip, or just a slow agent shouldn't pile up
//         redundant work. One queue row per target until it's acked.
//      b. Otherwise insert a new queue row.
//      c. Advance `targets.next_due_at` by one cadence interval from now.
//
// The whole sweep runs inside a single transaction so an interrupted tick
// rolls back atomically — we don't want half-advanced next_due_at values.
//
// Counts (`swept`, `enqueued`, `collapsed`) are recorded in the cron_runs
// row's `details` jsonb so the System dashboard (Phase 7) can graph activity.

import { db } from '@lucidindex/db/client'
import { and, eq, isNull, sql } from '@lucidindex/db/query'
import { queue, targets } from '@lucidindex/db/schema'
import { nextDueAt } from '../lib/cadence.js'
import { type JobDetails, runJob } from '../lib/run-job.js'

export async function runScheduler(): Promise<void> {
  await runJob('scheduler', async (): Promise<JobDetails> => {
    return await db.transaction(async (tx) => {
      // 1. Collect due targets. We read inside the txn so the row set is
      //    consistent with the next_due_at updates below.
      const dueTargets = await tx
        .select({ id: targets.id, cadence: targets.cadence })
        .from(targets)
        .where(and(eq(targets.active, true), sql`${targets.nextDueAt} <= now()`))

      let enqueued = 0
      let collapsed = 0
      const now = new Date()

      for (const target of dueTargets) {
        // 2a. Collapse check — is there already an unacked queue row?
        const existing = await tx
          .select({ id: queue.id })
          .from(queue)
          .where(and(eq(queue.targetId, target.id), isNull(queue.ackedAt)))
          .limit(1)

        if (existing.length > 0) {
          collapsed += 1
        } else {
          // 2b. Enqueue a fresh row. enqueued_at defaults to now() at the DB.
          await tx.insert(queue).values({ targetId: target.id })
          enqueued += 1
        }

        // 2c. Advance next_due_at regardless of collapse — the cadence is
        //     about how often we *intend* to run, not whether the previous
        //     run was acked yet. We anchor on `now` (not the old
        //     next_due_at) so a backlogged target doesn't stay perpetually
        //     overdue after the sidecar catches up.
        await tx
          .update(targets)
          .set({ nextDueAt: nextDueAt(target.cadence, now) })
          .where(eq(targets.id, target.id))
      }

      return {
        swept: dueTargets.length,
        enqueued,
        collapsed,
      }
    })
  })
}
