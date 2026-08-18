/**
 * Settings → Targets list view (RSC) — rebuilt on shadcn (Phase 2).
 */

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddTargetDialog } from './_components/AddTargetDialog'
import { EditTargetDialog } from './_components/EditTargetDialog'
import { PauseResumeButton } from './_components/PauseResumeButton'
import {
  CADENCE_PRESETS,
  type CadencePreset,
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
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b flex items-center justify-between gap-4">
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
                <TableHead className="w-10">
                  <span className="sr-only">Edit</span>
                </TableHead>
                <TableHead>Label</TableHead>
                <TableHead>URL / handle</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((row) => (
                <TargetTableRow
                  key={row.id}
                  row={row}
                  cadencePresets={CADENCE_PRESETS}
                  promptTemplates={promptTemplates}
                  promptTemplatesAvailable={promptTemplatesAvailable}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function TargetTableRow({
  row,
  cadencePresets,
  promptTemplates,
  promptTemplatesAvailable,
}: {
  row: TargetRow
  cadencePresets: ReadonlyArray<CadencePreset>
  promptTemplates: ReadonlyArray<{ id: string; slug: string }>
  promptTemplatesAvailable: boolean
}) {
  return (
    <TableRow>
      <TableCell className="w-10">
        <EditTargetDialog
          row={row}
          cadencePresets={cadencePresets}
          promptTemplates={promptTemplates}
          promptTemplatesAvailable={promptTemplatesAvailable}
        />
      </TableCell>
      <TableCell className="font-semibold">{row.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground max-w-[260px]">
        <span className="block truncate" title={row.urlOrHandle}>
          {row.urlOrHandle}
        </span>
      </TableCell>
      <TableCell>{row.cadence}</TableCell>
      <TableCell className="font-mono text-xs">{row.promptTemplateSlug ?? '—'}</TableCell>
      <TableCell>
        {row.active ? (
          <Badge variant="secondary" className="text-emerald-600">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Paused
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <LastRunCell row={row} />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
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
