// `list_targets` — return all targets for cross-reference + ops visibility.
//
// Read-only. Originally just a "does this author already exist" lookup
// (description/social_url/photo_url presence flags). Audit round 3 (P1)
// expanded the projection to expose scheduling + last-run state so agents
// can see WHEN a target is due next, WHAT happened on its last run, and
// whether the target is currently active — useful both for cross-reference
// and for agents that want to back off on a target whose last run failed.
//
// Hidden / paused targets are still listed — agents may need to know
// about them to avoid creating accidental duplicates.

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { asc } from 'drizzle-orm'

export type TargetSummary = {
  id: string
  label: string
  url_or_handle: string
  has_description: boolean
  has_social_url: boolean
  has_photo_url: boolean
  /** Free-form cadence string (named preset like `daily`, or a cron expression). */
  cadence: string
  /** ISO timestamp of the most recent run, or null if the target has never run. */
  last_run_at: string | null
  /** 'succeeded' | 'failed' | null (null = never run). */
  last_run_status: 'succeeded' | 'failed' | null
  /** Reason for the last failure, or null. */
  last_run_failure_reason: string | null
  /** ISO timestamp when the scheduler will next re-enqueue this target. */
  next_due_at: string
  /** Whether the target is currently active in the scheduler. */
  active: boolean
}

export async function listTargets(): Promise<{ targets: TargetSummary[] }> {
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      urlOrHandle: targets.urlOrHandle,
      description: targets.description,
      socialUrl: targets.socialUrl,
      photoUrl: targets.photoUrl,
      cadence: targets.cadence,
      lastRunAt: targets.lastRunAt,
      lastRunStatus: targets.lastRunStatus,
      lastRunFailureReason: targets.lastRunFailureReason,
      nextDueAt: targets.nextDueAt,
      active: targets.active,
    })
    .from(targets)
    .orderBy(asc(targets.label))

  return {
    targets: rows.map((r) => ({
      id: r.id,
      label: r.label,
      url_or_handle: r.urlOrHandle,
      has_description: r.description !== null,
      has_social_url: r.socialUrl !== null,
      has_photo_url: r.photoUrl !== null,
      cadence: r.cadence,
      last_run_at: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      // `last_run_status` is a free-form text column constrained to
      // ('succeeded' | 'failed' | null) via a CHECK, so the narrowing
      // here is safe.
      last_run_status: (r.lastRunStatus as 'succeeded' | 'failed' | null) ?? null,
      last_run_failure_reason: r.lastRunFailureReason,
      next_due_at: r.nextDueAt.toISOString(),
      active: r.active,
    })),
  }
}
