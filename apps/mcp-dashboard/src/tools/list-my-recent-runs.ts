// `list_my_recent_runs` — return the calling agent's recent run_log
// entries (P2 / audit round 3).
//
// Lets an agent self-reflect after a session: "what did I just do?". Filters
// on `run_log.agent_token_id = ctx.agentTokenId` so each token only sees its
// own history.
//
// Requires HTTP transport with bearer auth — there's no way to filter to
// "this caller" over stdio (no auth context).

import { db } from '@lucidindex/db/client'
import { queue, runLog, targets } from '@lucidindex/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const listMyRecentRunsInputShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Page size. 1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}.`),
  target_id: z
    .string()
    .uuid()
    .optional()
    .describe('Optional target filter — only return runs for this target.'),
}

const args = z.object(listMyRecentRunsInputShape)

export type ListMyRecentRunsArgs = z.infer<typeof args> & {
  agentTokenId: string
}

export type ListMyRecentRunsResult = {
  runs: {
    id: string
    target_id: string
    target_label: string
    queue_item_id: string
    /**
     * `in_progress` was added in migration 0034 / audit round 8 — it
     * surfaces here for runs whose queue item the agent has claimed but
     * has not yet acked (between pull_queue_item and ack_queue_item).
     * Terminal values stay `succeeded` | `failed`.
     */
    status: 'in_progress' | 'succeeded' | 'failed'
    articles_count: number
    failure_reason: string | null
    started_at: string
    /**
     * Nullable: in_progress runs (post-pull / pre-ack) have no
     * completion timestamp yet. Becomes a non-null ISO string once
     * `ack_queue_item` flips the status to a terminal value.
     */
    completed_at: string | null
    /**
     * Mirror of `queue.attempt_count` for this run's queue row at the
     * time the run completed. Surfaced so agents reviewing their own
     * history can spot flapping rows (high attempt counts indicate the
     * reaper repeatedly released the claim) without a second tool call.
     * Audit round 7.
     */
    attempt_count: number
  }[]
}

export async function listMyRecentRuns(
  input: ListMyRecentRunsArgs,
): Promise<ListMyRecentRunsResult> {
  const limit = input.limit ?? DEFAULT_LIMIT

  const where = input.target_id
    ? and(eq(runLog.agentTokenId, input.agentTokenId), eq(runLog.targetId, input.target_id))
    : eq(runLog.agentTokenId, input.agentTokenId)

  // Inner-join on `queue` is safe: every run_log row references a queue
  // row via the non-null FK (run_log.queue_item_id → queue.id), so the
  // inner join never drops rows. We pick up `attempt_count` from the
  // queue row at read-time; the reaper does not reset it, so the value
  // is monotonically non-decreasing across retries for the same row.
  const rows = await db
    .select({
      id: runLog.id,
      targetId: runLog.targetId,
      targetLabel: targets.label,
      queueItemId: runLog.queueItemId,
      status: runLog.status,
      articlesCount: runLog.articlesCount,
      failureReason: runLog.failureReason,
      startedAt: runLog.startedAt,
      completedAt: runLog.completedAt,
      attemptCount: queue.attemptCount,
    })
    .from(runLog)
    .leftJoin(targets, eq(runLog.targetId, targets.id))
    .innerJoin(queue, eq(runLog.queueItemId, queue.id))
    .where(where)
    // ORDER BY coalesce(completed_at, started_at) DESC so in_progress
    // rows (completed_at = NULL post-0034) sort next to their pull time
    // and stay visible at the top of the list while the run is active.
    // Without the coalesce, NULLs sort LAST under Postgres's default
    // and active runs would vanish off the bottom.
    .orderBy(desc(sql`coalesce(${runLog.completedAt}, ${runLog.startedAt})`))
    .limit(limit)

  return {
    runs: rows.map((r) => ({
      id: r.id,
      target_id: r.targetId,
      // leftJoin can technically yield a null label if the target row
      // was deleted out from under the run — defensive coalesce keeps
      // the return shape stable.
      target_label: r.targetLabel ?? '',
      queue_item_id: r.queueItemId,
      // run_log.status is CHECK-constrained to
      // ('in_progress' | 'succeeded' | 'failed') as of migration 0034,
      // so this cast is safe.
      status: r.status as 'in_progress' | 'succeeded' | 'failed',
      articles_count: r.articlesCount,
      failure_reason: r.failureReason,
      started_at: r.startedAt.toISOString(),
      // Nullable as of migration 0034 — in_progress runs have no
      // completion timestamp yet. Surface null directly so consumers can
      // detect active runs without re-checking `status`.
      completed_at: r.completedAt ? r.completedAt.toISOString() : null,
      attempt_count: r.attemptCount,
    })),
  }
}
