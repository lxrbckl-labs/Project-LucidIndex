// `get_queue_stats` — at-a-glance queue health for orchestrators (P2 / audit
// round 3).
//
// Read-only. Returns the current queue distribution so an agent or operator
// can answer "are there items to pull?" / "is the reaper keeping up?" / "when
// does the next target come due?" without scraping the dashboard UI.
//
// Counts:
//   - `pending`  — acked_at IS NULL AND claimed_by IS NULL
//                  (un-claimed work waiting to be pulled).
//   - `claimed`  — acked_at IS NULL AND claimed_by IS NOT NULL
//                  AND locked_until > now() (in-flight, lock not yet expired).
//   - `expired`  — acked_at IS NULL AND claimed_by IS NOT NULL
//                  AND locked_until <= now() (lock expired, reaper hasn't
//                  yet released — should be very small in steady state since
//                  the reaper runs every minute).
//
// Plus:
//   - `oldest_pending_enqueued_at` — ISO timestamp of the oldest unacked,
//     unclaimed queue row, or null if the queue is empty.
//   - `next_due_at` — soonest `next_due_at` across active targets, or
//     null if there are no active targets.
//
// Works on either transport (read-only, no auth context required).
//
// Audit round 6 — atomicity: previously the three bucket counts +
// oldest_pending lookup ran as four parallel queries against the queue
// table. Each had its own MVCC snapshot, so under contention a row could
// be observed in `pending` by one snapshot and `claimed` by another (or
// neither, if a transaction was committing between the reads). We now
// fold the queue-side reads into one statement using
// `count(*) FILTER (WHERE ...)` so all three buckets + the oldest-pending
// timestamp come from the same snapshot.
//
// `next_due_at` reads from a different table (`targets`) and is not
// race-sensitive against the queue buckets, so it stays its own query.

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { asc, eq, sql } from 'drizzle-orm'

export type GetQueueStatsResult = {
  pending: number
  claimed: number
  expired: number
  oldest_pending_enqueued_at: string | null
  next_due_at: string | null
}

type QueueStatsRow = {
  pending: number
  claimed: number
  expired: number
  oldest_pending_enqueued_at: Date | null
}

export async function getQueueStats(): Promise<GetQueueStatsResult> {
  // Single-snapshot read of the queue buckets + oldest pending timestamp.
  // `count(*) FILTER (WHERE ...)` is standard SQL and pushes all four
  // aggregations into one scan of `queue`.
  const queueRowsResult = await db.execute<QueueStatsRow>(sql`
    SELECT
      count(*) FILTER (
        WHERE acked_at IS NULL AND claimed_by IS NULL
      )::int AS pending,
      count(*) FILTER (
        WHERE acked_at IS NULL AND claimed_by IS NOT NULL AND locked_until > now()
      )::int AS claimed,
      count(*) FILTER (
        WHERE acked_at IS NULL AND claimed_by IS NOT NULL AND locked_until <= now()
      )::int AS expired,
      min(enqueued_at) FILTER (
        WHERE acked_at IS NULL AND claimed_by IS NULL
      ) AS oldest_pending_enqueued_at
    FROM queue
  `)

  // drizzle-orm's postgres-js execute returns the row array directly.
  const queueRows = queueRowsResult as unknown as QueueStatsRow[]
  const q = queueRows[0]

  // `next_due_at` is on `targets`, not `queue` — not race-sensitive
  // against the queue buckets, so its own query is fine.
  const nextDueRows = await db
    .select({ nextDueAt: targets.nextDueAt })
    .from(targets)
    .where(eq(targets.active, true))
    .orderBy(asc(targets.nextDueAt))
    .limit(1)

  const oldestPending = q?.oldest_pending_enqueued_at ?? null

  return {
    pending: q?.pending ?? 0,
    claimed: q?.claimed ?? 0,
    expired: q?.expired ?? 0,
    oldest_pending_enqueued_at:
      oldestPending instanceof Date
        ? oldestPending.toISOString()
        : oldestPending
          ? new Date(oldestPending).toISOString()
          : null,
    next_due_at: nextDueRows[0]?.nextDueAt ? nextDueRows[0].nextDueAt.toISOString() : null,
  }
}
