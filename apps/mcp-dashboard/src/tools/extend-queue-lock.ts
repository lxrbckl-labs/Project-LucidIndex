// `extend_queue_lock` — push out the lock expiry on an in-flight claim.
//
// An agent doing slow work (long fetch, expensive analysis) can blow past
// `MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC`; once `locked_until < now()` the cron reaper
// will unstick the row and a second agent can claim it — duplicate work,
// FK contention on run_log, the works. This tool lets the caller push
// `locked_until` forward by another TTL window without touching anything
// else on the row.
//
// Ownership check: only the original claimant (`queue.claimed_by ==
// agent_token_id`) can extend. Every other case errors out — already
// acked, never claimed, claimed by someone else — so retries don't
// silently steal locks across agents.

import { db } from '@lucidindex/db/client'
import { queue } from '@lucidindex/db/schema'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import env from '../env.js'
import { ToolError } from './index.js'

export const extendQueueLockInputShape = {
  queue_item_id: z.string().uuid(),
}

const extendQueueLockArgs = z.object(extendQueueLockInputShape)

export type ExtendQueueLockArgs = z.infer<typeof extendQueueLockArgs> & {
  agentTokenId: string
}

export async function extendQueueLock(
  args: ExtendQueueLockArgs,
): Promise<{ ok: true; lock_expires_at: string }> {
  const ttlSec = env.MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC

  const rows = await db
    .select({
      id: queue.id,
      claimedBy: queue.claimedBy,
      ackedAt: queue.ackedAt,
    })
    .from(queue)
    .where(eq(queue.id, args.queue_item_id))
    .limit(1)

  if (rows.length === 0) {
    throw new ToolError('queue_item_not_found', `Queue item ${args.queue_item_id} not found.`)
  }
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const q = rows[0]!

  if (q.ackedAt !== null) {
    throw new ToolError('queue_item_already_acked', 'Queue item has already been acknowledged.')
  }
  if (q.claimedBy !== args.agentTokenId) {
    throw new ToolError(
      'queue_item_not_claimed_by_caller',
      'This queue item is claimed by a different agent.',
    )
  }

  const updated = await db
    .update(queue)
    .set({ lockedUntil: sql`now() + make_interval(secs => ${ttlSec})` })
    .where(eq(queue.id, q.id))
    .returning({ lockedUntil: queue.lockedUntil })

  // biome-ignore lint/style/noNonNullAssertion: just-updated single row
  const lockExpiresAt = updated[0]!.lockedUntil
  if (!lockExpiresAt) {
    // Defensive: lockedUntil is set in the same UPDATE, but the type is
    // nullable so TypeScript wants the guard.
    throw new ToolError('internal_error', 'Lock extension did not return a new expiry.')
  }
  return { ok: true, lock_expires_at: lockExpiresAt.toISOString() }
}
