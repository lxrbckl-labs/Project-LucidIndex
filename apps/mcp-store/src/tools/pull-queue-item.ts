// `pull_queue_item` — claim the next due queue row.
//
// Atomic claim-lock (#42). The classic SELECT-then-UPDATE flow has a race:
// two concurrent pullers can both observe an unclaimed row, then both
// UPDATE it. PostgreSQL's `FOR UPDATE SKIP LOCKED` is the canonical fix —
// the inner SELECT row-locks the candidate, so a second concurrent
// transaction's SELECT silently passes that row over and picks the next
// one.
//
// drizzle-orm 0.45.x does not expose `SKIP LOCKED` ergonomically through
// its query builder, so this tool drops to raw SQL via `db.execute(sql\`\`)`.
// The implementation is one statement:
//
//   UPDATE queue
//   SET locked_until = now() + interval '<TTL>',
//       claimed_by   = $agent_token_id
//   WHERE id = (
//     SELECT id FROM queue
//     WHERE acked_at IS NULL
//       AND (locked_until IS NULL OR locked_until < now())
//     ORDER BY priority DESC, enqueued_at ASC
//     LIMIT 1
//     FOR UPDATE SKIP LOCKED
//   )
//   RETURNING *;
//
// One DB round-trip; row-level locks are held only for the duration of
// the UPDATE; concurrent pullers cleanly skip past whatever row another
// transaction has just claimed.
//
// After the claim, a second SELECT joins targets + prompt_templates to
// build the response. We split the two so the atomic UPDATE stays small
// and trivially auditable.
//
// #44: rendered_prompt is the LiquidJS-rendered template body. Render
// errors surface as `template_render_failed` ToolErrors so the agent
// sees WHICH target/template broke.

import { db } from '@lucidindex/db/client'
import { promptTemplates, queue, targets } from '@lucidindex/db/schema'
import { eq, sql } from 'drizzle-orm'
import env from '../env.js'
import { renderPromptBody } from '../lib/liquid-render.js'
import { ToolError } from './index.js'

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
      target_description: string | null
      target_social_url: string | null
      target_photo_url: string | null
      prompt_template_id: string
      rendered_prompt: string
      high_water_mark: unknown
      cadence: string
      cross_source_n: number
      pulled_at: string
      lock_expires_at: string
    }
  | { queue_item_id: null }

type ClaimedRow = {
  id: string
  target_id: string
  enqueued_at: Date
  claimed_by: string | null
  locked_until: Date
  priority: number
  acked_at: Date | null
}

export async function pullQueueItem(args: PullQueueItemArgs): Promise<PullQueueItemResult> {
  const ttlSec = env.MCP_QUEUE_LOCK_TTL_SEC

  // ATOMIC CLAIM-LOCK (#42). The interval expression uses `make_interval`
  // so we can parameterize the seconds count — Postgres won't accept a
  // bound parameter inside an `interval '<literal>'` syntax.
  //
  // The inner SELECT's FOR UPDATE SKIP LOCKED is what makes this safe
  // under contention: two concurrent pullers either pick different rows
  // or one returns null (queue empty after the other claimed the only
  // candidate). No double-claims possible.
  const claimResult = await db.execute<ClaimedRow>(sql`
    UPDATE queue
    SET locked_until = now() + make_interval(secs => ${ttlSec}),
        claimed_by   = ${args.agentTokenId}
    WHERE id = (
      SELECT id FROM queue
      WHERE acked_at IS NULL
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY priority DESC, enqueued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `)

  // drizzle-orm's postgres-js execute returns the row array directly.
  const rows = claimResult as unknown as ClaimedRow[]
  if (rows.length === 0) {
    return { queue_item_id: null }
  }

  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const claimed = rows[0]!

  // Second query: pull the joined target + template metadata for the
  // response payload. The atomic UPDATE above already locked the row
  // for us, so this is a plain read.
  const meta = await db
    .select({
      promptTemplateId: targets.promptTemplateId,
      urlOrHandle: targets.urlOrHandle,
      label: targets.label,
      description: targets.description,
      socialUrl: targets.socialUrl,
      photoUrl: targets.photoUrl,
      cadence: targets.cadence,
      highWaterMark: targets.highWaterMark,
      crossSourceN: promptTemplates.crossSourceN,
      promptBody: promptTemplates.body,
    })
    .from(queue)
    .innerJoin(targets, eq(queue.targetId, targets.id))
    .innerJoin(promptTemplates, eq(targets.promptTemplateId, promptTemplates.id))
    .where(eq(queue.id, claimed.id))
    .limit(1)

  if (meta.length === 0) {
    // Target or prompt_template was deleted (or FK-broken) between claim
    // and read — should never happen given the FK constraints, but guard
    // anyway. Return a recognizable error rather than crashing.
    throw new ToolError(
      'queue_item_metadata_missing',
      `Queue item ${claimed.id} has no joinable target/prompt_template metadata.`,
    )
  }
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const m = meta[0]!

  // #44: render the Liquid template. Pass through any render error as a
  // tool error so the agent can distinguish "template broken" from
  // "internal_error".
  let renderedPrompt: string
  try {
    renderedPrompt = await renderPromptBody(m.promptBody, {
      creator_name: m.label,
      target_url: m.urlOrHandle,
      high_water_mark: m.highWaterMark ?? null,
      cadence: m.cadence,
      cross_source_n: m.crossSourceN,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ToolError(
      'template_render_failed',
      `Liquid render failed for prompt_template_id=${m.promptTemplateId}: ${reason}`,
    )
  }

  return {
    queue_item_id: claimed.id,
    target_id: claimed.target_id,
    url_or_handle: m.urlOrHandle,
    label: m.label,
    target_description: m.description,
    target_social_url: m.socialUrl,
    target_photo_url: m.photoUrl,
    prompt_template_id: m.promptTemplateId,
    rendered_prompt: renderedPrompt,
    high_water_mark: m.highWaterMark ?? null,
    cadence: m.cadence,
    cross_source_n: m.crossSourceN,
    // claimed.locked_until is set by the same statement as the claim, so
    // it's the authoritative lock expiry — we report it back rather than
    // recomputing from the local clock.
    pulled_at: new Date().toISOString(),
    lock_expires_at: new Date(claimed.locked_until).toISOString(),
  }
}
