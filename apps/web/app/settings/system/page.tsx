/**
 * Settings → System (#77) — operational read-outs for the running stack.
 *
 * Four sections, all server-rendered:
 *
 *   1. Cron jobs       — last success / last failure / 24h success rate per
 *                        known job. Failed timestamps are emphasized in red.
 *   2. Queue depth     — single-number outstanding-work count.
 *   3. 30-day histograms — significance and difficulty side-by-side, each
 *                        showing the small/medium/large (or easy/medium/hard)
 *                        breakdown by count + percentage.
 *   4. Drift warning   — fires when `large` exceeds 20% of the last 30 days
 *                        of articles. Surfaces the standing-prompt nudge as
 *                        copyable text and links over to Settings → Templates.
 *
 * Auth: the parent settings layout (`/settings/layout.tsx`) gates everything
 * under `/settings/*` to authenticated admins. We don't re-check here — but
 * we DO defensively call `requireAdmin()` and redirect to /settings/login
 * if for some reason the layout was bypassed (matches the other sub-panels).
 *
 * Why a server component:
 *   All four blocks render once per request from `cron_runs`, `queue`, and
 *   `articles`. There's no client-side mutation surface — the page is a
 *   read-out, not a form — so a client tree would just be wasted bytes.
 *   The single client island is the Copy button on the drift warning.
 *
 * `dynamic = 'force-dynamic'` keeps Next from trying to cache or prerender
 * this — the underlying tables change every cron tick.
 */

import { requireAdmin } from '@lucidindex/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CopyStandingPrompt } from './_components/CopyStandingPrompt'
import {
  type CronJobSummary,
  type DifficultyHistogram,
  DRIFT_STANDING_PROMPT,
  getCronJobsSummary,
  getDifficultyHistogram,
  getQueueDepth,
  getSignificanceHistogram,
  LARGE_DRIFT_THRESHOLD_PCT,
  type SignificanceHistogram,
} from './_lib/system-stats'

export const dynamic = 'force-dynamic'

/**
 * `2026-04-26 14:30 UTC` — same shape the off-site-backup status panel
 * uses, so the two surfaces feel consistent. Returns the em-dash glyph
 * for null inputs so empty cells in the table read as "no data" instead
 * of an empty cell.
 */
function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`
}

export default async function SystemPanelPage() {
  const session = await requireAdmin()
  if (!session) {
    redirect('/settings/login')
  }

  // Parallel-fetch all four read-outs. Each helper is a single Postgres
  // round trip; running them concurrently keeps the page TTFB tight.
  const [cronJobs, queueDepth, significance, difficulty] = await Promise.all([
    getCronJobsSummary(),
    getQueueDepth(),
    getSignificanceHistogram(30),
    getDifficultyHistogram(30),
  ])

  return (
    <div className="max-w-[760px]">
      {/* Page header — same editorial treatment as the other Settings panels. */}
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 7</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        System
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />

      {/* Drift warning — at the top so a calibration regression can't be
          missed by an admin who only glances at the page. */}
      {significance.driftWarning ? <DriftWarningPanel histogram={significance} /> : null}

      {/* ── Section 1: Cron jobs ── */}
      <CronJobsSection rows={cronJobs} />

      <div className="mb-10 h-px w-full bg-neutral-100" />

      {/* ── Section 2: Queue depth ── */}
      <QueueSection depth={queueDepth} />

      <div className="mb-10 h-px w-full bg-neutral-100" />

      {/* ── Section 3: 30-day distribution ── */}
      <DistributionSection significance={significance} difficulty={difficulty} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cron jobs table
// ---------------------------------------------------------------------------

function CronJobsSection({ rows }: { rows: CronJobSummary[] }) {
  return (
    <section aria-labelledby="cron-heading" className="mb-10">
      <h2 id="cron-heading" className="text-base font-semibold text-black mb-3">
        Cron jobs
      </h2>
      <div className="overflow-x-auto" data-testid="cron-jobs-table">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-4 font-medium">Job</th>
              <th className="py-2 pr-4 font-medium">Last success</th>
              <th className="py-2 pr-4 font-medium">Last failure</th>
              <th className="py-2 font-medium">24h success rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.job}
                className="border-b border-neutral-100"
                data-testid={`cron-row-${row.job}`}
              >
                <td className="py-2 pr-4 font-mono text-xs text-black">{row.job}</td>
                <td className="py-2 pr-4 text-neutral-700">{formatTimestamp(row.lastSuccessAt)}</td>
                {/* Failed timestamps in muted red — the only color in this
                    otherwise B&W shell, used sparingly to draw the eye. */}
                <td
                  className={`py-2 pr-4 ${row.lastFailureAt ? 'text-red-700' : 'text-neutral-400'}`}
                >
                  {formatTimestamp(row.lastFailureAt)}
                </td>
                <td className="py-2 text-neutral-700">{row.successRate24h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Queue depth panel
// ---------------------------------------------------------------------------

function QueueSection({ depth }: { depth: number }) {
  return (
    <section aria-labelledby="queue-heading" className="mb-10">
      <h2 id="queue-heading" className="text-base font-semibold text-black mb-3">
        Queue
      </h2>
      <div
        className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm"
        data-testid="queue-depth-panel"
      >
        Queue depth:{' '}
        <span className="font-semibold text-black" data-testid="queue-depth-value">
          {depth}
        </span>{' '}
        {depth === 1 ? 'item' : 'items'} waiting
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Significance + difficulty histograms (side-by-side)
// ---------------------------------------------------------------------------

function DistributionSection({
  significance,
  difficulty,
}: {
  significance: SignificanceHistogram
  difficulty: DifficultyHistogram
}) {
  return (
    <section aria-labelledby="dist-heading" className="mb-10">
      <h2 id="dist-heading" className="text-base font-semibold text-black mb-1">
        30-day distribution
      </h2>
      <p className="text-xs text-neutral-500 mb-4">
        {significance.total} article{significance.total === 1 ? '' : 's'} in the last{' '}
        {significance.windowDays} days.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Significance bars */}
        <div data-testid="significance-histogram">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">Significance</h3>
          <HistogramBar
            label="small"
            count={significance.small}
            pct={significance.smallPct}
            testid="sig-small"
          />
          <HistogramBar
            label="medium"
            count={significance.medium}
            pct={significance.mediumPct}
            testid="sig-medium"
          />
          <HistogramBar
            label="large"
            count={significance.large}
            pct={significance.largePct}
            testid="sig-large"
            emphasize={significance.driftWarning}
          />
        </div>

        {/* Difficulty bars */}
        <div data-testid="difficulty-histogram">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">Difficulty</h3>
          <HistogramBar
            label="easy"
            count={difficulty.easy}
            pct={difficulty.easyPct}
            testid="diff-easy"
          />
          <HistogramBar
            label="medium"
            count={difficulty.medium}
            pct={difficulty.mediumPct}
            testid="diff-medium"
          />
          <HistogramBar
            label="hard"
            count={difficulty.hard}
            pct={difficulty.hardPct}
            testid="diff-hard"
          />
        </div>
      </div>
    </section>
  )
}

/**
 * One row of the histogram: text label + count/% on the right, and a
 * proportionally-filled bar underneath. `emphasize` swaps the bar fill to
 * a darker tone — used for the `large` row when drift is firing, so the
 * culprit is visually obvious next to the warning panel above.
 */
function HistogramBar({
  label,
  count,
  pct,
  testid,
  emphasize = false,
}: {
  label: string
  count: number
  pct: number
  testid: string
  emphasize?: boolean
}) {
  return (
    <div className="mb-3" data-testid={testid}>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-mono text-xs text-black">{label}</span>
        <span className="text-xs text-neutral-600">
          <span data-testid={`${testid}-count`}>{count}</span>
          {' · '}
          <span data-testid={`${testid}-pct`}>{pct}%</span>
        </span>
      </div>
      <div className="h-2 w-full bg-neutral-100">
        <div
          className={emphasize ? 'h-2 bg-red-700' : 'h-2 bg-black'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drift warning panel
// ---------------------------------------------------------------------------

function DriftWarningPanel({ histogram }: { histogram: SignificanceHistogram }) {
  return (
    <section
      aria-labelledby="drift-heading"
      className="mb-10 border border-neutral-300 bg-white px-5 py-4"
      data-testid="drift-warning-panel"
    >
      <h2 id="drift-heading" className="text-base font-semibold text-black mb-2">
        Calibration drift detected
      </h2>
      <p className="text-sm text-neutral-700 mb-4">
        <code>large</code> is at{' '}
        <span className="font-semibold" data-testid="drift-large-pct">
          {histogram.largePct}%
        </span>{' '}
        of articles in the last {histogram.windowDays} days (target: ~10%, threshold:{' '}
        {LARGE_DRIFT_THRESHOLD_PCT}%). The agent is over-rating articles as significant — nudge the
        standing prompt below into your templates to recalibrate.
      </p>
      <CopyStandingPrompt text={DRIFT_STANDING_PROMPT} />
      <p className="mt-4 text-xs text-neutral-500">
        Paste this into your{' '}
        <Link href="/settings/templates" className="underline hover:text-black">
          template
        </Link>{' '}
        as a standing prompt and let it ride for a week.
      </p>
    </section>
  )
}
