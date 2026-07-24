// cron sidecar — entrypoint.
//
// Phase 4 (#48 scaffold + #49/#50/#51/#52) shipped:
//
//   - heartbeat   → proves the sidecar is alive + DB-reachable (#48)
//   - scheduler   → re-enqueue due `targets`, collapse missed ticks   (#49)
//   - reaper      → release `queue` rows whose `locked_until` expired (#50)
//   - hwm_reset   → clear `high_water_mark` for unpaused targets       (#51)
//
// Phase 7 (#72/#75/#76) adds:
//
//   - retention_purge → daily 03:00; roll articles off the dashboard at
//                       6d, delete (except starred) at 6mo, drop hero
//                       image files alongside the row delete.
//   - local_backup    → nightly 02:00; pg_dump (custom format) + tar of
//                       hero images into BACKUP_DIR. 14-day retention
//                       sweep on BACKUP_DIR's own files.
//   - off_site_backup → nightly 02:30 (after local_backup); rclone copy
//                       the latest local backup to an admin-configured
//                       remote, using credentials decrypted from the
//                       settings singleton.
//
// All seven follow the same envelope (insert in-flight cron_runs row →
// run job body → update with status/details), per #52. The shared
// `runJob()` helper in src/lib/run-job.ts owns that envelope.
//
// Scheduling: the four "heartbeat-style" jobs (heartbeat, scheduler,
// reaper, hwm_reset) run on `* * * * *` (every minute). Each opens its own
// connection from the postgres-js pool (`max: 10` in @lucidindex/db/client)
// and the four queries are tiny enough that hammering the same minute
// boundary is fine.
//
// The Phase 7 jobs run on explicit absolute schedules:
//   - 02:00 local_backup
//   - 02:30 off_site_backup  (timed to follow local_backup, not chained)
//   - 03:00 retention_purge
// They are scheduled via separate cron expressions (NOT chained
// programmatically). If local_backup runs long, off_site_backup picks up
// the most recent files it can find.
//
// Runs as a separate Node container from apps/web and apps/mcp-dashboard;
// shares Postgres via @lucidindex/db. No HTTP surface — cron is internal-
// only, nothing connects to it.

import { db } from '@lucidindex/db/client'
import { cronRuns } from '@lucidindex/db/schema'
import cron, { type ScheduledTask } from 'node-cron'
import env from './env.js'
import { runHwmReset } from './jobs/hwm-reset.js'
import { runLocalBackup } from './jobs/local-backup.js'
import { runOffSiteBackup } from './jobs/off-site-backup.js'
import { runReaper } from './jobs/reaper.js'
import { runRetentionPurge } from './jobs/retention-purge.js'
import { runScheduler } from './jobs/scheduler.js'
import { logger } from './logger.js'

logger.info('cron_sidecar_starting', { tz: env.CRON_TIMEZONE, node_env: env.NODE_ENV })

// ---------------------------------------------------------------------------
// Graceful-shutdown state (audit round 9).
//
// `inFlight` tracks the number of cron job bodies currently executing.
// node-cron's `stop()` halts FUTURE ticks but does not interrupt or
// await a tick that's already in flight — so without our own counter
// the SIGTERM path would `process.exit(0)` mid-job, ripping the
// postgres-js socket out from under a half-finished INSERT and
// leaving a dangling cron_runs row (no completed_at).
//
// `runTracked()` wraps every scheduled callback: increment on entry,
// decrement in finally, swallow exceptions (the job bodies have their
// own error handling — we just need the counter to balance even on
// throw).
//
// `shuttingDown` short-circuits new ticks once the signal arrives, so
// even though node-cron's `stop()` is best-effort, we never start a
// new job body after the drain begins.
// ---------------------------------------------------------------------------
let shuttingDown = false
let inFlight = 0
async function runTracked(name: string, fn: () => Promise<void>): Promise<void> {
  if (shuttingDown) {
    logger.debug('cron_tick_skipped_shutting_down', { job: name })
    return
  }
  inFlight++
  try {
    await fn()
  } catch (err) {
    // Job bodies already log their own failures via runJob() — this
    // catch only exists so a throw doesn't unbalance `inFlight`. Keep
    // the message in case a job grows a code path that bypasses
    // runJob().
    logger.error('cron_tick_unhandled_error', {
      job: name,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    inFlight--
  }
}

// ---------------------------------------------------------------------------
// Heartbeat job (#48) — every minute, write a `cron_runs` row tagged
// 'heartbeat' to prove the sidecar boots and can talk to Postgres. The
// Phase 7 Settings → System dashboard surfaces `last_tick_at` per job; an
// empty heartbeat list means the sidecar isn't running.
//
// The heartbeat predates the shared `runJob()` envelope and uses a single
// combined insert (completed_at = now) on success, plus a best-effort
// `failed` row on DB failure. Both shapes are valid — cron_runs.completed_at
// is nullable. Future tickets can normalize if it ever matters.
// ---------------------------------------------------------------------------
const heartbeatTask = cron.schedule(
  '* * * * *',
  async () => {
    await runTracked('heartbeat', async () => {
      const startedAt = new Date()
      try {
        await db.insert(cronRuns).values({
          job: 'heartbeat',
          startedAt,
          completedAt: new Date(),
          status: 'succeeded',
          details: { note: 'scaffold heartbeat' },
        })
        logger.debug('heartbeat_tick')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('heartbeat_failed', { error: message })
        // Best-effort failure record — DB is the surface the dashboard
        // reads, so we try to leave a marker even when the DB is flaky.
        // If THIS insert also throws, swallow it: stderr already carries
        // the structured error above.
        await db
          .insert(cronRuns)
          .values({
            job: 'heartbeat',
            startedAt,
            completedAt: new Date(),
            status: 'failed',
            details: { error: message },
          })
          .catch(() => {
            /* swallow — DB is the failure surface */
          })
      }
    })
  },
  { timezone: env.CRON_TIMEZONE, name: 'heartbeat' },
)

// ---------------------------------------------------------------------------
// Scheduler (#49) — sweep due targets and re-enqueue (collapse missed ticks).
// ---------------------------------------------------------------------------
const schedulerTask = cron.schedule(
  '* * * * *',
  async () => {
    await runTracked('scheduler', runScheduler)
  },
  { timezone: env.CRON_TIMEZONE, name: 'scheduler' },
)

// ---------------------------------------------------------------------------
// Reaper (#50) — release queue rows whose locked_until has passed.
// ---------------------------------------------------------------------------
const reaperTask = cron.schedule(
  '* * * * *',
  async () => {
    await runTracked('reaper', runReaper)
  },
  { timezone: env.CRON_TIMEZONE, name: 'reaper' },
)

// ---------------------------------------------------------------------------
// HWM reset (#51) — clear high_water_mark for unpaused targets.
// ---------------------------------------------------------------------------
const hwmResetTask = cron.schedule(
  '* * * * *',
  async () => {
    await runTracked('hwm_reset', runHwmReset)
  },
  { timezone: env.CRON_TIMEZONE, name: 'hwm_reset' },
)

// ---------------------------------------------------------------------------
// Retention purge (#72) — daily at 03:00. See jobs/retention-purge.ts.
// ---------------------------------------------------------------------------
const retentionPurgeTask = cron.schedule(
  '0 3 * * *',
  async () => {
    await runTracked('retention_purge', runRetentionPurge)
  },
  { timezone: env.CRON_TIMEZONE, name: 'retention_purge' },
)

// ---------------------------------------------------------------------------
// Local backup (#75) — nightly at 02:00. See jobs/local-backup.ts.
// ---------------------------------------------------------------------------
const localBackupTask = cron.schedule(
  '0 2 * * *',
  async () => {
    await runTracked('local_backup', runLocalBackup)
  },
  { timezone: env.CRON_TIMEZONE, name: 'local_backup' },
)

// ---------------------------------------------------------------------------
// Off-site backup (#76) — nightly at 02:30, AFTER local_backup completes
// at ~02:00 (independently scheduled, not chained). See jobs/off-site-
// backup.ts.
// ---------------------------------------------------------------------------
const offSiteBackupTask = cron.schedule(
  '30 2 * * *',
  async () => {
    await runTracked('off_site_backup', runOffSiteBackup)
  },
  { timezone: env.CRON_TIMEZONE, name: 'off_site_backup' },
)

const allTasks: ScheduledTask[] = [
  heartbeatTask,
  schedulerTask,
  reaperTask,
  hwmResetTask,
  retentionPurgeTask,
  localBackupTask,
  offSiteBackupTask,
]

logger.info('cron_sidecar_listening', {
  jobs: [
    'heartbeat',
    'scheduler',
    'reaper',
    'hwm_reset',
    'retention_purge',
    'local_backup',
    'off_site_backup',
  ],
})

// ---------------------------------------------------------------------------
// Shutdown drain (audit round 9).
//
// node-cron's `stop()` halts FUTURE ticks but does not interrupt or
// wait on a tick that's already running. Previously the .finally()
// fired `process.exit(0)` immediately after the stop() Promise
// resolved, which meant a long-running job (local_backup spawns
// pg_dump, off_site_backup invokes rclone) would be SIGKILL'd
// mid-operation when the orchestrator's grace window expired.
//
// New flow:
//   1. flip shuttingDown — `runTracked` short-circuits any tick that
//      lands AFTER the flag flips (race window between cron firing
//      and our wrapper checking the flag).
//   2. stop() every task so node-cron stops scheduling new ticks.
//   3. poll `inFlight` until zero or 30s elapses. Backups can take
//      minutes legitimately; we pick a 30s budget that matches the
//      mcp-dashboard sidecar's drain budget so docker-compose's stop
//      grace (10s default, 30s typical) catches both.
//   4. process.exit(0).
//
// A second signal during the drain is logged but does NOT abort the
// drain. Operators who need to hard-kill can use SIGKILL.
// ---------------------------------------------------------------------------
const SHUTDOWN_DRAIN_MS = 30_000
const SHUTDOWN_DRAIN_POLL_MS = 100
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    logger.warn('cron_sidecar_shutdown_signal_during_drain', { signal })
    return
  }
  shuttingDown = true
  logger.info('cron_sidecar_shutting_down', { signal, in_flight: inFlight })
  // node-cron v4: stop() halts future ticks; in-flight ticks finish
  // naturally and we wait for them below via the inFlight poll.
  await Promise.all(allTasks.map((t) => Promise.resolve(t.stop()).catch(() => {}))).catch((err) => {
    logger.error('cron_sidecar_stop_error', {
      error: err instanceof Error ? err.message : String(err),
    })
  })
  const deadline = Date.now() + SHUTDOWN_DRAIN_MS
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, SHUTDOWN_DRAIN_POLL_MS).unref())
  }
  if (inFlight > 0) {
    logger.warn('cron_sidecar_shutdown_drain_timeout', {
      in_flight: inFlight,
      drain_ms: SHUTDOWN_DRAIN_MS,
    })
  } else {
    logger.info('cron_sidecar_shutdown_drain_complete')
  }
  process.exit(0)
}
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
