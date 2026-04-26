// cron sidecar — entrypoint.
//
// Phase 4 scaffold (#48). This boots node-cron and registers a single
// heartbeat job that writes a `cron_runs` row every minute. The point of
// the heartbeat is twofold:
//   1. Prove the sidecar boots, can talk to Postgres, and can write the
//      `cron_runs` audit table. The Phase 7 Settings → System dashboard
//      will surface `last_tick_at` per job; an empty list means the
//      sidecar isn't running.
//   2. Establish the per-job tick pattern (insert started/completed
//      timestamps, status, freeform jsonb details). Subsequent Phase 4
//      tickets register their jobs alongside this one and reuse the
//      pattern. See TODOs below.
//
// Runs as a separate Node container from apps/web and apps/mcp-store;
// shares Postgres via @lucidindex/db. No HTTP surface — cron is internal-
// only, nothing connects to it.

import { db } from '@lucidindex/db/client'
import { cronRuns } from '@lucidindex/db/schema'
import cron from 'node-cron'
import env from './env.js'
import { logger } from './logger.js'

logger.info('cron_sidecar_starting', { tz: env.CRON_TIMEZONE, node_env: env.NODE_ENV })

// Heartbeat job — every minute. Future tickets register more jobs alongside
// this one (see TODOs below). The job is intentionally trivial: write a
// `cron_runs` row tagged `heartbeat` with status='succeeded'. If the DB is
// unreachable, we log the error AND attempt a `failed` row so the dashboard
// surfaces the outage; the second insert is best-effort and swallowed.
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

// TODO(#49): scheduler — sweep `targets` where `next_due_at <= now()` and
//   re-enqueue (collapse missed ticks; one queue row per target regardless
//   of how many cadences slipped while the sidecar was down).
// TODO(#50): dead-lock reaper — release `queue` rows whose `locked_until`
//   has passed back to the unlocked pool so a fresh agent can claim them.
// TODO(#51): pause/unpause HWM hard-reset — when the operator flips
//   `targets.paused = true` then false, optionally reset
//   `high_water_mark` so the next pull sees a clean slate.
// (#52: `cron_runs` writes for every job tick — pattern established here.)

logger.info('cron_sidecar_listening', { jobs: ['heartbeat'] })

let shuttingDown = false
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('cron_sidecar_shutting_down', { signal })
  // node-cron v4: stop() halts future ticks; in-flight ticks are allowed
  // to finish naturally (we don't await — the process exits below and the
  // postgres-js pool closes its sockets, which the running insert will
  // either complete or have rolled back by Postgres).
  Promise.resolve(heartbeatTask.stop())
    .catch((err) => {
      logger.error('cron_sidecar_stop_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
