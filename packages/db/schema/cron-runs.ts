import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Audit log of every scheduled-job tick (scheduler, reaper, purge, local_backup, off_site_backup, ...).
 *
 * Design notes:
 * - `status` is constrained via a CHECK constraint (not a Postgres enum) to keep
 *   future status additions a single-line migration instead of an `ALTER TYPE`.
 * - `completed_at = NULL` means the run is in-flight or crashed mid-run; the reaper
 *   uses this column to spot stuck jobs.
 * - `details` is freeform jsonb so the System dashboard can surface counts /
 *   error messages without us pre-committing to a schema.
 */
export const cronRuns = pgTable(
  'cron_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status').notNull(),
    details: jsonb('details'),
  },
  (t) => [
    // Fast lookup for "last tick per job" on the System dashboard.
    index('cron_runs_job_started_at_idx').on(t.job, t.startedAt.desc()),
    check('cron_runs_status_check', sql`${t.status} in ('succeeded', 'failed')`),
  ],
)
