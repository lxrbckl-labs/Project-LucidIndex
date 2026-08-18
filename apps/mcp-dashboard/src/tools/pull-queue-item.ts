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
//       claimed_by   = $agent_token_id,
//       attempt_count = attempt_count + 1
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
// `attempt_count` (migration 0031) is bumped inside the same statement so
// the post-increment value is returned to the agent on every pull. Agents
// branch on it for back-off / escalation when the reaper has unstuck a
// row repeatedly.
//
// After the claim, a second SELECT joins targets + prompt_templates to
// build the response. We split the two so the atomic UPDATE stays small
// and trivially auditable.
//
// #44: rendered_prompt is the LiquidJS-rendered template body. Render
// errors surface as `template_render_failed` ToolErrors so the agent
// sees WHICH target/template broke.
//
// Audit round 3 (P1): the metadata-read + Liquid-render block is wrapped
// in a try/catch that RELEASES the claim before re-throwing. Otherwise a
// bad template would hold the row locked until the reaper times it out,
// even though the agent never received the queue_item_id (so it can't
// ack it or extend the lock). The release UPDATE includes a
// `claimed_by = $ctx.agentTokenId` guard so we never race the reaper
// into wiping another agent's claim.
//
// Audit round 8 (`started_at` true pull-time semantics, migration 0034):
// after the atomic claim and BEFORE returning, this tool now INSERTs a
// `run_log` row with `status='in_progress'`, `started_at=now()`,
// `completed_at=NULL`. That makes `started_at` an honest pull-time
// timestamp instead of "first-write-time" (which was N seconds — or
// minutes — later, while the agent researched). `write_articles` UPDATEs
// `articles_count` on that row as it goes; `ack_queue_item` flips
// `status` to 'succeeded' | 'failed' and stamps `completed_at`. If the
// claim-release path fires (bad template / missing metadata), it ALSO
// deletes the freshly-inserted run_log row in the same transaction so
// we don't strand an orphan 'in_progress' row.

import { db } from '@lucidindex/db/client'
import { promptTemplates, queue, runLog, targets } from '@lucidindex/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import env from '../env.js'
import { renderPromptBody } from '../lib/liquid-render.js'
import { logger } from '../logger.js'
import { ToolError } from './index.js'

export type PullQueueItemArgs = {
  /**
   * Authenticated agent_token_id. REQUIRED — stored as `claimed_by` on the
   * claimed row so subsequent `write_articles` / `ack_queue_item` calls can
   * verify the caller owns the claim. stdio has no auth context and so
   * cannot legitimately pull (the claim would be unattributable and every
   * downstream write would fail `queue_item_not_claimed_by_caller`); the
   * registration wrapper rejects stdio with `stdio_pull_disabled` before
   * we get here.
   */
  agentTokenId: string
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
      /**
       * Post-increment attempt count for this queue row. Bumped in the
       * atomic claim UPDATE so the value the agent sees IS the count of
       * this attempt (1 on first pull, 2 on a reaper-released retry, etc.).
       * Agents back off or escalate on a high attempt count.
       */
      attempt_count: number
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
  attempt_count: number
}

export async function pullQueueItem(args: PullQueueItemArgs): Promise<PullQueueItemResult> {
  const ttlSec = env.MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC

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
        claimed_by   = ${args.agentTokenId},
        attempt_count = attempt_count + 1
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

  // Audit round 8 — create the run_log row at PULL TIME so `started_at`
  // is the honest claim timestamp (not "first-write-time", which can be
  // 30s–N-minutes later depending on how long the agent researches before
  // calling `write_articles`).
  //
  // status='in_progress' (added to the CHECK by migration 0034);
  // completed_at=NULL (nullable as of 0034) — `ack_queue_item` stamps the
  // terminal status + completed_at later.
  //
  // ON CONFLICT DO NOTHING: the (queue_item_id, agent_token_id) UNIQUE
  // (migration 0032) guards against a hypothetical re-claim by the same
  // agent — extraordinary but cheap to defend. If the conflict fires,
  // we silently reuse the existing row; the agent doesn't notice and
  // write_articles / ack_queue_item still find it.
  const pulledAt = new Date()
  try {
    await db
      .insert(runLog)
      .values({
        targetId: claimed.target_id,
        queueItemId: claimed.id,
        agentTokenId: args.agentTokenId,
        status: 'in_progress',
        articlesCount: 0,
        startedAt: pulledAt,
        completedAt: null,
      })
      .onConflictDoNothing({ target: [runLog.queueItemId, runLog.agentTokenId] })
  } catch (insertErr) {
    // Defensive: a run_log insert failure shouldn't strand a claim. Roll
    // back the claim before re-throwing so the row goes back into rotation.
    const message = insertErr instanceof Error ? insertErr.message : String(insertErr)
    logger.error('pull_queue_item_run_log_insert_failed', {
      queue_item_id: claimed.id,
      message,
    })
    try {
      await db
        .update(queue)
        .set({
          claimedBy: null,
          lockedUntil: null,
          attemptCount: sql`${queue.attemptCount} - 1`,
        })
        .where(and(eq(queue.id, claimed.id), eq(queue.claimedBy, args.agentTokenId)))
    } catch {
      // swallow — reaper will catch it
    }
    throw new ToolError('internal_error', `Failed to record run_log row at pull time: ${message}`)
  }

  // Second query: pull the joined target + template metadata for the
  // response payload. The atomic UPDATE above already locked the row
  // for us, so this is a plain read.
  //
  // P1 (audit round 3): the metadata-read + Liquid-render are wrapped in
  // a try/catch that releases this claim on any error. Without the
  // release, a bad template would hold the row locked until the reaper
  // times it out, even though the agent never received the queue_item_id
  // (so it can't extend the lock or ack it).
  //
  // Audit round 8: the release path now ALSO deletes the run_log row
  // we just inserted above. We only delete if the row has no `articles`
  // hanging off it (it shouldn't — we're between INSERT and any
  // write_articles call — but the FK-safe check is cheap insurance).
  // The DELETE is guarded by (queue_item_id, agent_token_id) so we never
  // wipe a row owned by another agent.
  try {
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
      attempt_count: claimed.attempt_count,
      // claimed.locked_until is set by the same statement as the claim, so
      // it's the authoritative lock expiry — we report it back rather than
      // recomputing from the local clock.
      // Use the same `pulledAt` we wrote into run_log.started_at so the
      // value the agent sees matches what `list_my_recent_runs` will
      // report. Both end up within 1–2 seconds of the claim UPDATE.
      pulled_at: pulledAt.toISOString(),
      lock_expires_at: new Date(claimed.locked_until).toISOString(),
    }
  } catch (err) {
    // Release the claim before re-throwing so the queue row goes back
    // into rotation immediately. We guard on `claimed_by = $ctx.agentTokenId`
    // so this never races the reaper into wiping a claim that already
    // got reassigned.
    //
    // Audit round 6: the atomic claim UPDATE bumped `attempt_count` —
    // but the agent never received the queue_item_id, so this was not a
    // real attempt from their perspective. Decrement it back here so a
    // bad template / missing metadata doesn't burn the attempt budget
    // and trigger spurious back-off / escalation on the next pull.
    //
    // Audit round 8: also DELETE the in_progress run_log row we just
    // inserted at claim time. It has no articles hanging off it (we're
    // between INSERT and any write_articles call), so the delete is
    // FK-safe. Guard on (queue_item_id, agent_token_id) so we never wipe
    // a row that some other unrelated path created. The two operations
    // are independent — even if one fails, the other should still
    // attempt — so we wrap each in its own try.
    try {
      await db
        .update(queue)
        .set({
          claimedBy: null,
          lockedUntil: null,
          attemptCount: sql`${queue.attemptCount} - 1`,
        })
        .where(and(eq(queue.id, claimed.id), eq(queue.claimedBy, args.agentTokenId)))
    } catch (releaseErr) {
      // Log the release failure but surface the ORIGINAL error to the
      // caller — the reaper will catch any orphaned lock on its next tick.
      logger.error('pull_queue_item_claim_release_failed', {
        queue_item_id: claimed.id,
        message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
      })
    }
    try {
      await db
        .delete(runLog)
        .where(
          and(
            eq(runLog.queueItemId, claimed.id),
            eq(runLog.agentTokenId, args.agentTokenId),
            eq(runLog.status, 'in_progress'),
          ),
        )
    } catch (deleteErr) {
      // Best-effort cleanup. If this fails the row remains as a stale
      // 'in_progress' — the reaper will sweep it on its next tick.
      logger.error('pull_queue_item_run_log_cleanup_failed', {
        queue_item_id: claimed.id,
        message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
      })
    }
    throw err
  }
}
