// `pull_queue_item` — claim the next due queue row.
//
// STUB-quality implementation. The flow is:
//   1. SELECT the oldest unacked-and-unlocked row (or one whose lock expired).
//   2. UPDATE its `claimed_by` and `locked_until`.
//   3. Join in the target + prompt_template fields and return the contract.
//
// TODO(#42): replace the SELECT-then-UPDATE with `FOR UPDATE SKIP LOCKED` so
// concurrent agents can't double-claim the same row. The stub here is
// trivially racy under concurrency.
//
// TODO(#44): `rendered_prompt` currently returns the raw template body.
// #44 wires Liquid rendering against the target metadata + per-template
// variables.

import { db } from '@lucidindex/db/client'
import { promptTemplates, queue, targets } from '@lucidindex/db/schema'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import env from '../env.js'

export type PullQueueItemArgs = {
  /** Authenticated agent_token_id, if any. Stored as `claimed_by` on the row. */
  agentTokenId: string | null
}

export type PullQueueItemResult =
  | {
      queue_item_id: string
      target_id: string
      url_or_handle: string
      label: string
      prompt_template_id: string
      rendered_prompt: string
      high_water_mark: unknown
      cadence: string
      cross_source_n: number
      pulled_at: string
      lock_expires_at: string
    }
  | { queue_item_id: null }

export async function pullQueueItem(args: PullQueueItemArgs): Promise<PullQueueItemResult> {
  const now = new Date()
  const lockExpires = new Date(now.getTime() + env.MCP_QUEUE_LOCK_TTL_SEC * 1000)

  // Find the next eligible row. Eligible = not yet acked AND (no claim OR
  // claim's lock has expired). Order by enqueued_at so we hand out FIFO,
  // priority desc as a tie-breaker.
  // TODO(#42): replace with FOR UPDATE SKIP LOCKED atomic claim-lock
  const candidate = await db
    .select({
      id: queue.id,
      targetId: queue.targetId,
      promptTemplateId: targets.promptTemplateId,
      urlOrHandle: targets.urlOrHandle,
      label: targets.label,
      cadence: targets.cadence,
      highWaterMark: targets.highWaterMark,
      crossSourceN: promptTemplates.crossSourceN,
      promptBody: promptTemplates.body,
    })
    .from(queue)
    .innerJoin(targets, eq(queue.targetId, targets.id))
    .innerJoin(promptTemplates, eq(targets.promptTemplateId, promptTemplates.id))
    .where(and(isNull(queue.ackedAt), or(isNull(queue.lockedUntil), lte(queue.lockedUntil, now))))
    .orderBy(sql`${queue.priority} desc`, queue.enqueuedAt)
    .limit(1)

  if (candidate.length === 0) {
    return { queue_item_id: null }
  }

  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const row = candidate[0]!

  await db
    .update(queue)
    .set({
      claimedBy: args.agentTokenId,
      lockedUntil: lockExpires,
    })
    .where(eq(queue.id, row.id))

  return {
    queue_item_id: row.id,
    target_id: row.targetId,
    url_or_handle: row.urlOrHandle,
    label: row.label,
    prompt_template_id: row.promptTemplateId,
    // TODO(#44): replace raw template body with Liquid-rendered output
    rendered_prompt: row.promptBody,
    high_water_mark: row.highWaterMark ?? null,
    cadence: row.cadence,
    cross_source_n: row.crossSourceN,
    pulled_at: now.toISOString(),
    lock_expires_at: lockExpires.toISOString(),
  }
}
