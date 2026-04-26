// Shared `cron_runs` discipline (#52).
//
// Every scheduled job in the sidecar follows the same envelope:
//
//   1. INSERT a `cron_runs` row with status='succeeded' (placeholder),
//      completed_at=NULL, details=NULL — this acts as an "in-flight"
//      breadcrumb so the System dashboard can spot stuck jobs.
//   2. Run the job body, which returns a `details` jsonb payload.
//   3. UPDATE the row: completed_at=now, status=succeeded, details=<payload>.
//
// On error: UPDATE the row to status='failed', details={ error: <message> },
// log a structured error line, and SWALLOW the throw — the sidecar must keep
// running. If the bookkeeping UPDATE itself throws (Postgres flaky), we log
// and swallow that too; stderr already carries the original failure.
//
// The heartbeat job (apps/cron/src/server.ts) predates this helper; it does
// a single combined insert with completed_at=now at the end. Both shapes are
// consistent with the cron_runs schema (completed_at is nullable). Future
// migrations can normalize if it ever matters.

import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { cronRuns } from '@lucidindex/db/schema'
import { logger } from '../logger.js'

export type JobName = 'heartbeat' | 'scheduler' | 'reaper' | 'hwm_reset'

export type JobDetails = Record<string, unknown>

/**
 * Run a job body inside a `cron_runs` envelope. The body returns the details
 * payload to record; thrown errors become a `failed` row + structured log.
 *
 * The caller never re-throws — this helper is the outermost catch for every
 * scheduled tick.
 */
export async function runJob(job: JobName, body: () => Promise<JobDetails>): Promise<void> {
  const startedAt = new Date()

  // 1. Insert the in-flight breadcrumb. We use status='succeeded' as the
  //    placeholder — the dashboard can detect "in flight" by completed_at
  //    being NULL. This avoids needing a third status enum value.
  let rowId: string | undefined
  try {
    const inserted = await db
      .insert(cronRuns)
      .values({ job, startedAt, status: 'succeeded', details: null })
      .returning({ id: cronRuns.id })
    rowId = inserted[0]?.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('cron_run_insert_failed', { job, error: message })
    // No row to update — bail. The sidecar continues; the dashboard will see
    // the job as silent until the next tick succeeds.
    return
  }

  if (!rowId) {
    logger.error('cron_run_insert_returned_no_id', { job })
    return
  }

  // 2. Run the body.
  try {
    const details = await body()
    await db
      .update(cronRuns)
      .set({ completedAt: new Date(), status: 'succeeded', details })
      .where(eq(cronRuns.id, rowId))
    logger.debug('cron_job_tick', { job, ...details })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('cron_job_failed', { job, error: message })
    // 3. Best-effort failure record — swallow if it also throws so the
    //    sidecar process doesn't crash.
    await db
      .update(cronRuns)
      .set({
        completedAt: new Date(),
        status: 'failed',
        details: { error: message },
      })
      .where(eq(cronRuns.id, rowId))
      .catch(() => {
        /* swallow — DB is the failure surface */
      })
  }
}
