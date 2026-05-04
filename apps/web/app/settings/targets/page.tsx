/**
 * Settings → Targets list view (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddTargetDialog } from './_components/AddTargetDialog'
import { PauseResumeButton } from './_components/PauseResumeButton'
import {
  CADENCE_PRESETS,
  hasAnyPromptTemplates,
  listPromptTemplateOptions,
  listTargets,
  type TargetRow,
} from './_lib/targets-repo'

export const dynamic = 'force-dynamic'

export default async function TargetsPanelPage() {
  const [targets, promptTemplates, promptTemplatesAvailable] = await Promise.all([
    listTargets(),
    listPromptTemplateOptions(),
    hasAnyPromptTemplates(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Targets</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Sources LucidIndex crawls. Cadence and the prompt template are read by the cron sidecar
            (Phase 4) — paused targets are skipped.
          </p>
        </div>
        <AddTargetDialog
          cadencePresets={CADENCE_PRESETS}
          promptTemplates={promptTemplates}
          promptTemplatesAvailable={promptTemplatesAvailable}
        />
      </div>

      <Separator />

      {targets.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-12 text-center">
          <div>
            <p className="font-semibold">No targets yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a source to start filing articles.
            </p>
          </div>
          <AddTargetDialog
            cadencePresets={CADENCE_PRESETS}
            promptTemplates={promptTemplates}
            promptTemplatesAvailable={promptTemplatesAvailable}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>URL / handle</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((row) => (
                <TargetTableRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function TargetTableRow({ row }: { row: TargetRow }) {
  return (
    <TableRow>
      <TableCell className="font-semibold">{row.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground max-w-[260px]">
        <span className="block truncate" title={row.urlOrHandle}>
          {row.urlOrHandle}
        </span>
      </TableCell>
      <TableCell>{row.cadence}</TableCell>
      <TableCell className="font-mono text-xs">{row.promptTemplateSlug ?? '—'}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              row.active ? 'bg-emerald-500' : 'bg-muted-foreground/30'
            }`}
            aria-hidden="true"
          />
          {row.active ? 'Active' : 'Paused'}
        </span>
      </TableCell>
      <TableCell>
        <LastRunCell row={row} />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button variant="ghost" size="sm" asChild className="mr-2">
          <Link href={`/settings/targets/${row.id}`}>Edit</Link>
        </Button>
        <PauseResumeButton id={row.id} active={row.active} />
      </TableCell>
    </TableRow>
  )
}

function LastRunCell({ row }: { row: TargetRow }) {
  if (!row.lastRunAt) return <span className="text-muted-foreground">—</span>
  const status = row.lastRunStatus ?? 'unknown'
  const when = row.lastRunAt.toISOString().replace('T', ' ').slice(0, 16)
  return (
    <div className="text-xs">
      <div>{when}</div>
      <div className={status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
        {status}
      </div>
      {row.lastRunFailureReason ? (
        <div
          className="text-muted-foreground truncate max-w-[200px]"
          title={row.lastRunFailureReason}
        >
          {row.lastRunFailureReason}
        </div>
      ) : null}
    </div>
  )
}
