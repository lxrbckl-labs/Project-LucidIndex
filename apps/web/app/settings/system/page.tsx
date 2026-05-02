/**
 * Settings → System (#77) — operational read-outs, rebuilt on shadcn (Phase 2).
 *
 * Four sections, all server-rendered:
 *   1. Cron jobs   — last success / last failure / 24h rate per job.
 *   2. Queue depth — single-number outstanding-work count.
 *   3. 30-day histograms — significance + difficulty side-by-side.
 *   4. Drift warning — fires when `large` > threshold. Shows Copy-prompt island.
 */

import { requireAdmin } from '@lucidindex/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

  const [cronJobs, queueDepth, significance, difficulty] = await Promise.all([
    getCronJobsSummary(),
    getQueueDepth(),
    getSignificanceHistogram(30),
    getDifficultyHistogram(30),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cron run history, queue depth, and calibration drift read-outs.
        </p>
      </div>

      {/* Drift warning — at the top so a calibration regression can't be missed. */}
      {significance.driftWarning && <DriftWarningPanel histogram={significance} />}

      {/* ── Section 1: Cron jobs ── */}
      <CronJobsSection rows={cronJobs} />

      {/* ── Section 2: Queue depth ── */}
      <QueueSection depth={queueDepth} />

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
    <Card>
      <CardHeader>
        <CardTitle>Cron jobs</CardTitle>
        <CardDescription>Per-job last success, last failure, and 24h success rate.</CardDescription>
      </CardHeader>
      <CardContent data-testid="cron-jobs-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Last success</TableHead>
              <TableHead>Last failure</TableHead>
              <TableHead>24h success rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.job} data-testid={`cron-row-${row.job}`}>
                <TableCell className="font-mono text-xs">{row.job}</TableCell>
                <TableCell className="text-sm">{formatTimestamp(row.lastSuccessAt)}</TableCell>
                <TableCell
                  className={
                    row.lastFailureAt ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'
                  }
                >
                  {formatTimestamp(row.lastFailureAt)}
                </TableCell>
                <TableCell className="text-sm">{row.successRate24h}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Queue depth panel
// ---------------------------------------------------------------------------

function QueueSection({ depth }: { depth: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Queue</CardTitle>
      </CardHeader>
      <CardContent data-testid="queue-depth-panel">
        <p className="text-sm">
          Queue depth:{' '}
          <span className="font-semibold" data-testid="queue-depth-value">
            {depth}
          </span>{' '}
          {depth === 1 ? 'item' : 'items'} waiting
        </p>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>30-day distribution</CardTitle>
        <CardDescription>
          {significance.total} article{significance.total === 1 ? '' : 's'} in the last{' '}
          {significance.windowDays} days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Significance bars */}
          <div data-testid="significance-histogram">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Significance
            </h3>
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
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Difficulty
            </h3>
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
      </CardContent>
    </Card>
  )
}

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
        <span className="font-mono text-xs">{label}</span>
        <span className="text-xs text-muted-foreground">
          <span data-testid={`${testid}-count`}>{count}</span>
          {' · '}
          <span data-testid={`${testid}-pct`}>{pct}%</span>
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full">
        <div
          className={`h-2 rounded-full ${emphasize ? 'bg-destructive' : 'bg-foreground'}`}
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
    <Alert variant="destructive" data-testid="drift-warning-panel">
      <AlertTitle id="drift-heading">Calibration drift detected</AlertTitle>
      <AlertDescription>
        <p className="text-sm mb-4">
          <code>large</code> is at{' '}
          <span className="font-semibold" data-testid="drift-large-pct">
            {histogram.largePct}%
          </span>{' '}
          of articles in the last {histogram.windowDays} days (target: ~10%, threshold:{' '}
          {LARGE_DRIFT_THRESHOLD_PCT}%). The agent is over-rating articles as significant — nudge
          the standing prompt below into your templates to recalibrate.
        </p>
        <CopyStandingPrompt text={DRIFT_STANDING_PROMPT} />
        <p className="mt-4 text-xs">
          Paste this into your{' '}
          <Link href="/settings/templates" className="underline hover:opacity-80">
            template
          </Link>{' '}
          as a standing prompt and let it ride for a week.
        </p>
      </AlertDescription>
    </Alert>
  )
}
