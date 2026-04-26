// cron sidecar — entrypoint.
//
// Phase 4 (#48 scaffold + #49/#50/#51/#52). Boots node-cron and registers
// every recurring job that keeps the system honest:
//
//   - heartbeat   → proves the sidecar is alive + DB-reachable (#48)
//   - scheduler   → re-enqueue due `targets`, collapse missed ticks   (#49)
//   - reaper      → release `queue` rows whose `locked_until` expired (#50)
//   - hwm_reset   → clear `high_water_mark` for unpaused targets       (#51)
//
// All four follow the same envelope (insert in-flight cron_runs row →
// run job body → update with status/details), per #52. The shared
// `runJob()` helper in src/lib/run-job.ts owns that envelope.
//
// Scheduling: every job runs on `* * * * *` (every minute). We don't stagger
// the start seconds — each job opens its own connection from the postgres-js
// pool (`max: 10` in @lucidindex/db/client) and the four queries are tiny
// enough that hammering the same minute boundary is fine. If we ever ship
// heavier jobs (e.g. backups, retention) we can stagger via separate cron
// expressions then.
//
// Runs as a separate Node container from apps/web and apps/mcp-store;
// shares Postgres via @lucidindex/db. No HTTP surface — cron is internal-
// only, nothing connects to it.

import { db } from '@lucidindex/db/client'
import { cronRuns } from '@lucidindex/db/schema'
import cron, { type ScheduledTask } from 'node-cron'
import env from './env.js'
import { runHwmReset } from './jobs/hwm-reset.js'
import { runReaper } from './jobs/reaper.js'
import { runScheduler } from './jobs/scheduler.js'
import { logger } from './logger.js'

logger.info('cron_sidecar_starting', { tz: env.CRON_TIMEZONE, node_env: env.NODE_ENV })

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
  },
  { timezone: env.CRON_TIMEZONE, name: 'heartbeat' },
)

// ---------------------------------------------------------------------------
// Scheduler (#49) — sweep due targets and re-enqueue (collapse missed ticks).
// ---------------------------------------------------------------------------
const schedulerTask = cron.schedule(
  '* * * * *',
  async () => {
    await runScheduler()
  },
  { timezone: env.CRON_TIMEZONE, name: 'scheduler' },
)

// ---------------------------------------------------------------------------
// Reaper (#50) — release queue rows whose locked_until has passed.
// ---------------------------------------------------------------------------
const reaperTask = cron.schedule(
  '* * * * *',
  async () => {
    await runReaper()
  },
  { timezone: env.CRON_TIMEZONE, name: 'reaper' },
)

// ---------------------------------------------------------------------------
// HWM reset (#51) — clear high_water_mark for unpaused targets.
// ---------------------------------------------------------------------------
const hwmResetTask = cron.schedule(
  '* * * * *',
  async () => {
    await runHwmReset()
  },
  { timezone: env.CRON_TIMEZONE, name: 'hwm_reset' },
)

const allTasks: ScheduledTask[] = [heartbeatTask, schedulerTask, reaperTask, hwmResetTask]

logger.info('cron_sidecar_listening', {
  jobs: ['heartbeat', 'scheduler', 'reaper', 'hwm_reset'],
})

let shuttingDown = false
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('cron_sidecar_shutting_down', { signal })
  // node-cron v4: stop() halts future ticks; in-flight ticks are allowed
  // to finish naturally (we don't await — the process exits below and the
  // postgres-js pool closes its sockets, which the running insert will
  // either complete or have rolled back by Postgres).
  Promise.all(allTasks.map((t) => Promise.resolve(t.stop()).catch(() => {})))
    .catch((err) => {
      logger.error('cron_sidecar_stop_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
