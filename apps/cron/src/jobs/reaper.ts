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

import { db } from '@lucidindex/db/client'
import { and, isNull, sql } from '@lucidindex/db/query'
import { queue } from '@lucidindex/db/schema'
import { type JobDetails, runJob } from '../lib/run-job.js'

export async function runReaper(): Promise<void> {
  await runJob('reaper', async (): Promise<JobDetails> => {
    const reaped = await db
      .update(queue)
      .set({ claimedBy: null, lockedUntil: null })
      .where(and(isNull(queue.ackedAt), sql`${queue.lockedUntil} < now()`))
      .returning({ id: queue.id })

    return { reaped: reaped.length }
  })
}
