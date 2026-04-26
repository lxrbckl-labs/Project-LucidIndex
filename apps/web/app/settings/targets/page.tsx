/**
 * Settings → Targets list view (RSC).
 *
 * Pulls the full target list directly from the DB (server-side) and renders
 * a simple table with the human-supplied fields plus the cron-managed
 * `last_run_*` columns when present.
 *
 * Functional-only styling — Phase 5 (#56) layers the Visual Identity on top
 * of every Settings panel in one pass. Sticking to plain Tailwind that
 * matches the rest of the Phase 1 settings shell.
 *
 * The Pause / Resume button is a tiny client component (`PauseResumeButton`)
 * because it has to fire a `fetch()` and refresh the route. Everything else
 * on this page is server-rendered.
 */

import Link from 'next/link'
import { PauseResumeButton } from './_components/PauseResumeButton'
import { listTargets, type TargetRow } from './_lib/targets-repo'

export const dynamic = 'force-dynamic'

export default async function TargetsPanelPage() {
  const targets = await listTargets()

  return (
    <div className="max-w-[960px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <div className="flex items-baseline justify-between gap-4">
        <h1
          className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          Targets
        </h1>
        <Link
          href="/settings/targets/new"
          className="shrink-0 inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
        >
          New target
        </Link>
      </div>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />
      <p className="text-sm text-neutral-600 leading-relaxed mb-8">
        Sources LucidIndex crawls. Cadence and the prompt template are read by the cron sidecar
        (Phase 4) — paused targets are skipped.
      </p>

      {targets.length === 0 ? <EmptyState /> : <TargetsTable rows={targets} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="border border-dashed border-neutral-300 px-6 py-12 text-center">
      <p className="text-sm text-neutral-600 mb-4">No targets yet.</p>
      <Link
        href="/settings/targets/new"
        className="inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
      >
        Add your first target
      </Link>
    </div>
  )
}

function TargetsTable({ rows }: { rows: TargetRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <Th>Label</Th>
            <Th>URL / handle</Th>
            <Th>Cadence</Th>
            <Th>Template</Th>
            <Th>Active</Th>
            <Th>Last run</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-neutral-200 align-top">
              <Td className="font-semibold">{row.label}</Td>
              <Td className="font-mono text-xs text-neutral-700 max-w-[260px]">
                <span className="block truncate" title={row.urlOrHandle}>
                  {row.urlOrHandle}
                </span>
              </Td>
              <Td>{row.cadence}</Td>
              <Td className="font-mono text-xs">{row.promptTemplateSlug ?? '—'}</Td>
              <Td>
                <span
                  className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${
                    row.active ? 'bg-emerald-500' : 'bg-neutral-300'
                  }`}
                  aria-hidden="true"
                />
                <span className="align-middle">{row.active ? 'Active' : 'Paused'}</span>
              </Td>
              <Td>
                <LastRunCell row={row} />
              </Td>
              <Td className="text-right whitespace-nowrap">
                <Link
                  href={`/settings/targets/${row.id}`}
                  className="text-sm font-semibold underline hover:opacity-70 mr-4"
                >
                  Edit
                </Link>
                <PauseResumeButton id={row.id} active={row.active} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LastRunCell({ row }: { row: TargetRow }) {
  if (!row.lastRunAt) return <span className="text-neutral-400">—</span>
  const status = row.lastRunStatus ?? 'unknown'
  const when = row.lastRunAt.toISOString().replace('T', ' ').slice(0, 16)
  return (
    <div className="text-xs">
      <div>{when}</div>
      <div className={status === 'failed' ? 'text-red-600' : 'text-neutral-600'}>{status}</div>
      {row.lastRunFailureReason ? (
        <div className="text-neutral-500 truncate max-w-[200px]" title={row.lastRunFailureReason}>
          {row.lastRunFailureReason}
        </div>
      ) : null}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 font-semibold ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 ${className}`}>{children}</td>
}
