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
import { runLog, targets } from '@lucidindex/db/schema'
import { and, desc, eq } from 'drizzle-orm'
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
    status: 'succeeded' | 'failed'
    articles_count: number
    failure_reason: string | null
    started_at: string
    completed_at: string
  }[]
}

export async function listMyRecentRuns(
  input: ListMyRecentRunsArgs,
): Promise<ListMyRecentRunsResult> {
  const limit = input.limit ?? DEFAULT_LIMIT

  const where = input.target_id
    ? and(eq(runLog.agentTokenId, input.agentTokenId), eq(runLog.targetId, input.target_id))
    : eq(runLog.agentTokenId, input.agentTokenId)

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
    })
    .from(runLog)
    .leftJoin(targets, eq(runLog.targetId, targets.id))
    .where(where)
    .orderBy(desc(runLog.completedAt))
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
      // run_log.status is CHECK-constrained to ('succeeded' | 'failed'),
      // so this cast is safe.
      status: r.status as 'succeeded' | 'failed',
      articles_count: r.articlesCount,
      failure_reason: r.failureReason,
      started_at: r.startedAt.toISOString(),
      completed_at: r.completedAt.toISOString(),
    })),
  }
}
