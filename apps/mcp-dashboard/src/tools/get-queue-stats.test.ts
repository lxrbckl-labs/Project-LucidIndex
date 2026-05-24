/**
 * Tests for `get_queue_stats` — single-snapshot queue health read.
 *
 * Audit round 6 hardened the implementation: previously five parallel
 * queries (one per bucket + oldest_pending + next_due), each with its
 * own MVCC snapshot, so a row could be observed in `pending` by one
 * snapshot and `claimed` by another. The fix folds the queue-side
 * reads into a single `count(*) FILTER (WHERE ...)` query so the
 * three buckets + the oldest_pending timestamp all come from one scan.
 *
 * Coverage targets (when the DB harness lands):
 *
 *   1. Atomic single query — the implementation issues exactly ONE
 *      query against `queue` (rather than three counts + a min). A spy
 *      on `db.execute(...)` should record one queue read and one
 *      targets read; not five.
 *   2. Returned row carries all 5 fields — `{ pending, claimed,
 *      expired, oldest_pending_enqueued_at, next_due_at }` are all
 *      present and typed correctly.
 *   3. Empty queue — pending/claimed/expired all 0,
 *      oldest_pending_enqueued_at === null.
 *   4. next_due_at null when no active targets.
 *
 * STATUS: SKIPPED — but the harness is no longer the blocker. See
 * `check-article-exists.test.ts` for the working pattern using
 * `@lucidindex/db/test-helpers`. Audit round 9 left this file
 * skipped to keep the round's scope tight; the next round can copy
 * that file's bootstrap shape and un-skip the cases below verbatim.
 */

import { describe, it } from 'vitest'

describe.skip('getQueueStats', () => {
  // ------------------------------------------------------------------------
  // 1. Atomic single query
  // ------------------------------------------------------------------------
  it('issues exactly one query against the queue table (not 4 separate count queries)', async () => {
    // TODO(next round): spy on db.execute / db.select. Call getQueueStats()
    // against a seeded queue. Assert:
    //   - exactly one db.execute(...) targeting `queue` (the count(*) FILTER
    //     statement)
    //   - exactly one db.select(...) targeting `targets` (the next_due_at
    //     lookup — kept separate because not race-sensitive)
    //   - total queries: 2 (down from 5 before the round-6 fix).
  })

  // ------------------------------------------------------------------------
  // 2. Returned row carries all 5 fields
  // ------------------------------------------------------------------------
  it('returns { pending, claimed, expired, oldest_pending_enqueued_at, next_due_at }', async () => {
    // TODO(next round): seed:
    //   - 3 queue rows acked_at=null, claimed_by=null              (pending)
    //   - 2 queue rows acked_at=null, claimed_by=X, locked > now() (claimed)
    //   - 1 queue row  acked_at=null, claimed_by=X, locked < now() (expired)
    //   - 1 active target with next_due_at = T
    // Assert getQueueStats() === {
    //   pending: 3,
    //   claimed: 2,
    //   expired: 1,
    //   oldest_pending_enqueued_at: <oldest pending enqueued_at, ISO>,
    //   next_due_at: T.toISOString(),
    // }
  })

  // ------------------------------------------------------------------------
  // 3. Empty queue
  // ------------------------------------------------------------------------
  it('returns all zeros and null timestamps on an empty queue', async () => {
    // TODO(next round): truncate queue + targets. Assert getQueueStats()
    // === { pending: 0, claimed: 0, expired: 0,
    //       oldest_pending_enqueued_at: null, next_due_at: null }.
  })

  // ------------------------------------------------------------------------
  // 4. next_due_at null when no active targets
  // ------------------------------------------------------------------------
  it('returns next_due_at: null when all targets are inactive', async () => {
    // TODO(next round): seed one target with active=false. Assert
    // getQueueStats().next_due_at === null.
  })
})
