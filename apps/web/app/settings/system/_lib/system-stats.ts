/**
 * Server-only data helpers for Settings → System (#77).
 *
 * The page renders four read-only blocks; each function below feeds one of
 * them. All queries are bound to `cron_runs` / `queue` / `articles` and
 * return plain JSON-friendly shapes — no Date objects in the return type
 * (we ISO-string them before they cross the React server-component boundary
 * so the client tree doesn't need to know about Date serialization).
 *
 *   - `getCronJobsSummary()`        — last success / last failure / 24h rates per job.
 *   - `getQueueDepth()`             — count of unacked queue rows.
 *   - `getSignificanceHistogram()`  — small/medium/large counts + large_pct over the
 *                                     trailing N days. `large_pct > 20` triggers the
 *                                     drift warning on the page.
 *   - `getDifficultyHistogram()`    — easy/medium/hard counts + percentages, same window.
 *
 * Auth is handled one level up by `apps/web/app/settings/layout.tsx` —
 * every `/settings/*` route is gated to authenticated admins. These helpers
 * deliberately do not re-check; they assume a trusted caller.
 *
 * The histogram windows default to 30 days because that's the spec'd
 * drift-detection window in #77 and matches the magazine-vibe weekly cadence
 * we want admins to be looking at. They're parameterized for any future
 * "show me the last 7 days" knob without needing a second helper.
 *
 * Performance notes:
 *   - The cron-runs summary uses FILTER aggregations to compute four scalar
 *     facts per job in a single GROUP BY pass over the index on
 *     `(job, started_at DESC)`.
 *   - The queue depth is a partial-index lookup (`acked_at IS NULL`) — O(1)
 *     for the cardinality we ever expect (single-digit thousands).
 *   - The histograms are unindexed scans of the trailing 30-day slice of
 *     `articles`; if that table grows unbounded we'd add a filtered index
 *     on `(created_at)`. For v0.1 it's fine.
 */

import { db } from '@lucidindex/db/client'
import { asc, isNull, sql } from '@lucidindex/db/query'
import { queue, targets } from '@lucidindex/db/schema'

// ---------------------------------------------------------------------------
// Cron jobs summary
// ---------------------------------------------------------------------------

/**
 * The fixed list of jobs the System page renders, in display order.
 *
 * Why a static list and not `SELECT DISTINCT job FROM cron_runs`:
 *   We want the table to render every known job — including ones that have
 *   never run yet, so the admin sees "no runs" rather than an empty row
 *   silently disappearing from the surface. Adding a new cron job is a
 *   one-line addition here.
 */
export const KNOWN_CRON_JOBS = [
  'scheduler',
  'reaper',
  'hwm_reset',
  'retention_purge',
  'local_backup',
  'off_site_backup',
  'heartbeat',
] as const

export type KnownCronJob = (typeof KNOWN_CRON_JOBS)[number]

export type CronJobSummary = {
  job: KnownCronJob
  /** ISO timestamp of the most recent succeeded run, or null. */
  lastSuccessAt: string | null
  /** ISO timestamp of the most recent failed run, or null. */
  lastFailureAt: string | null
  /** Successful runs in the trailing 24h. */
  successes24h: number
  /** Failed runs in the trailing 24h. */
  failures24h: number
  /**
   * Pretty string for the table: "12/12 (100%)" or "—" when no runs.
   * Computed here so the view layer can stay declarative.
   */
  successRate24h: string
}

type CronRunsAggRow = {
  job: string
  // postgres-js can return TIMESTAMPTZ as either a Date or an ISO string
  // depending on the type-parser setup; drizzle's raw `db.execute()` does
  // NOT coerce these values back to Date the way the typed query builder
  // does. Accept both shapes and normalize at the boundary below.
  last_success: Date | string | null
  last_failure: Date | string | null
  s_24h: number | string
  f_24h: number | string
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  // Already an ISO-ish string from the driver. `new Date(...)` round-trips
  // it to a canonical ISO 8601 with `Z` suffix so the formatter renders
  // consistently regardless of the driver's exact wire format.
  return new Date(value).toISOString()
}

/**
 * One pass over `cron_runs` per call: a single GROUP BY job, with FILTER
 * aggregations for the four facts the table needs. Jobs that have never
 * run still appear in the result with all-zero / null fields.
 */
export async function getCronJobsSummary(): Promise<CronJobSummary[]> {
  const rows = await db.execute<CronRunsAggRow>(sql`
    SELECT
      job,
      MAX(started_at) FILTER (WHERE status = 'succeeded') AS last_success,
      MAX(started_at) FILTER (WHERE status = 'failed')    AS last_failure,
      COUNT(*) FILTER (
        WHERE started_at > now() - interval '24 hours' AND status = 'succeeded'
      ) AS s_24h,
      COUNT(*) FILTER (
        WHERE started_at > now() - interval '24 hours' AND status = 'failed'
      ) AS f_24h
    FROM cron_runs
    GROUP BY job
  `)

  // Index by job name so we can build a row for every known job below,
  // including ones that have never written a cron_runs entry.
  const byJob = new Map<string, CronRunsAggRow>()
  for (const r of rows) byJob.set(r.job, r)

  return KNOWN_CRON_JOBS.map((job) => {
    const row = byJob.get(job)
    if (!row) {
      return {
        job,
        lastSuccessAt: null,
        lastFailureAt: null,
        successes24h: 0,
        failures24h: 0,
        successRate24h: '—',
      }
    }
    const successes = Number(row.s_24h ?? 0)
    const failures = Number(row.f_24h ?? 0)
    const total = successes + failures
    const successRate24h =
      total === 0 ? '—' : `${successes}/${total} (${Math.round((successes / total) * 100)}%)`
    return {
      job,
      lastSuccessAt: toIsoString(row.last_success),
      lastFailureAt: toIsoString(row.last_failure),
      successes24h: successes,
      failures24h: failures,
      successRate24h,
    }
  })
}

// ---------------------------------------------------------------------------
// Queue depth
// ---------------------------------------------------------------------------

/**
 * Returns the count of queue rows that haven't been acked yet — i.e. units
 * of work currently outstanding (claimed, locked, or unclaimed). Acked
 * rows are kept (NO DELETIONS) so a plain count(*) would mis-represent the
 * live depth; we filter on `acked_at IS NULL` which hits the partial index
 * `queue_locked_until_unacked_idx`.
 */
export async function getQueueDepth(): Promise<number> {
  const rows = await db.execute<{ depth: number | string }>(sql`
    SELECT count(*)::int AS depth FROM queue WHERE acked_at IS NULL
  `)
  // Driver may return BIGINT-shaped scalars as strings; coerce defensively.
  return Number(rows[0]?.depth ?? 0)
}

// ---------------------------------------------------------------------------
// Queue items
// ---------------------------------------------------------------------------

export type QueueItem = {
  id: string
  targetLabel: string | null
  enqueuedAt: Date
  claimedAt: Date | null
  lockedUntil: Date | null
  priority: number
}

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

/**
 * Returns up to 100 unacked queue rows (acked_at IS NULL), joined to `targets`
 * for the label, ordered oldest-first. In mock mode returns an empty array —
 * there's no in-memory queue to inspect, and the depth is already mocked as 0.
 */
export async function getQueueItems(): Promise<QueueItem[]> {
  if (MOCK_MODE) return []

  const rows = await db
    .select({
      id: queue.id,
      targetLabel: targets.label,
      enqueuedAt: queue.enqueuedAt,
      claimedBy: queue.claimedBy,
      lockedUntil: queue.lockedUntil,
      priority: queue.priority,
    })
    .from(queue)
    .leftJoin(targets, sql`${targets.id} = ${queue.targetId}`)
    .where(isNull(queue.ackedAt))
    .orderBy(asc(queue.enqueuedAt))
    .limit(100)

  return rows.map((r) => ({
    id: r.id,
    targetLabel: r.targetLabel ?? null,
    enqueuedAt: r.enqueuedAt,
    // The schema stores claimedBy (agent token UUID) but not a claimedAt
    // timestamp. We use lockedUntil as the claimed-time proxy: if an agent
    // holds a lock, the row is "claimed". null = still pending.
    claimedAt: r.lockedUntil != null ? r.lockedUntil : null,
    lockedUntil: r.lockedUntil,
    priority: r.priority,
  }))
}

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

/**
 * Threshold that fires the "calibration drift" warning on the System page.
 * The target distribution for `significance` reserves `large` for the top
 * ~10% of articles; we warn when the trailing-30d ratio crosses 20%, i.e.
 * double the calibration target. This is locked-in spec for #77 — do not
 * make it configurable per-deploy in this PR.
 */
export const LARGE_DRIFT_THRESHOLD_PCT = 20

export type SignificanceHistogram = {
  small: number
  medium: number
  large: number
  total: number
  smallPct: number
  mediumPct: number
  largePct: number
  /** True when `largePct > LARGE_DRIFT_THRESHOLD_PCT`. */
  driftWarning: boolean
  /** The window used by the query, echoed back to the view. */
  windowDays: number
}

export type DifficultyHistogram = {
  easy: number
  medium: number
  hard: number
  total: number
  easyPct: number
  mediumPct: number
  hardPct: number
  windowDays: number
}

type GroupedCountRow = { bucket: string; n: number | string }

/**
 * Group-by-significance count for the trailing N days. Buckets that don't
 * appear in the result (e.g. no `large` articles in the window) are zero-filled.
 */
export async function getSignificanceHistogram(days = 30): Promise<SignificanceHistogram> {
  const rows = await db.execute<GroupedCountRow>(sql`
    SELECT significance AS bucket, count(*)::int AS n
    FROM articles
    WHERE created_at > now() - (${days}::int || ' days')::interval
    GROUP BY significance
  `)

  const counts: Record<string, number> = { small: 0, medium: 0, large: 0 }
  for (const r of rows) counts[r.bucket] = Number(r.n)

  const small = counts.small ?? 0
  const medium = counts.medium ?? 0
  const large = counts.large ?? 0
  const total = small + medium + large

  // Avoid divide-by-zero on a fresh install — show 0% across the board.
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100))
  const smallPct = pct(small)
  const mediumPct = pct(medium)
  const largePct = pct(large)

  return {
    small,
    medium,
    large,
    total,
    smallPct,
    mediumPct,
    largePct,
    driftWarning: largePct > LARGE_DRIFT_THRESHOLD_PCT,
    windowDays: days,
  }
}

/**
 * Group-by-difficulty count for the trailing N days. Symmetric in shape to
 * the significance histogram, minus the drift warning (we don't have a
 * spec'd target distribution for difficulty yet).
 */
export async function getDifficultyHistogram(days = 30): Promise<DifficultyHistogram> {
  const rows = await db.execute<GroupedCountRow>(sql`
    SELECT difficulty AS bucket, count(*)::int AS n
    FROM articles
    WHERE created_at > now() - (${days}::int || ' days')::interval
    GROUP BY difficulty
  `)

  const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 }
  for (const r of rows) counts[r.bucket] = Number(r.n)

  const easy = counts.easy ?? 0
  const medium = counts.medium ?? 0
  const hard = counts.hard ?? 0
  const total = easy + medium + hard

  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

  return {
    easy,
    medium,
    hard,
    total,
    easyPct: pct(easy),
    mediumPct: pct(medium),
    hardPct: pct(hard),
    windowDays: days,
  }
}

/**
 * Standing-prompt nudge text that appears in the drift-warning block. Pulled
 * out as a constant so the test/copy assertion has a single source of truth.
 */
export const DRIFT_STANDING_PROMPT =
  'Rate conservatively — `large` is reserved for the top ~10% of articles.'
