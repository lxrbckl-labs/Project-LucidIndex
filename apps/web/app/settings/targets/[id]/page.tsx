/**
 * Settings → Targets → Edit (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TargetForm } from '../_components/TargetForm'
import {
  CADENCE_PRESETS,
  getTarget,
  hasAnyPromptTemplates,
  listPromptTemplateOptions,
} from '../_lib/targets-repo'

export const dynamic = 'force-dynamic'

export default async function EditTargetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [target, promptTemplates, templatesAvailable] = await Promise.all([
    getTarget(id),
    listPromptTemplateOptions(),
    hasAnyPromptTemplates(),
  ])
  if (!target) notFound()

  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit target</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/targets">&larr; Back to targets</Link>
      </Button>

      <TargetForm
        mode="edit"
        targetId={target.id}
        initial={{
          label: target.label,
          urlOrHandle: target.urlOrHandle,
          cadence: target.cadence,
          promptTemplateId: target.promptTemplateId,
          active: target.active,
        }}
        cadencePresets={CADENCE_PRESETS}
        promptTemplates={promptTemplates}
        promptTemplatesAvailable={templatesAvailable}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
            Cron-managed (read-only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <ReadOnlyRow label="Next due">
              {target.nextDueAt.toISOString().replace('T', ' ').slice(0, 19)}
            </ReadOnlyRow>
            <ReadOnlyRow label="Last run">
              {target.lastRunAt
                ? target.lastRunAt.toISOString().replace('T', ' ').slice(0, 19)
                : '—'}
            </ReadOnlyRow>
            <ReadOnlyRow label="Last status">{target.lastRunStatus ?? '—'}</ReadOnlyRow>
            <ReadOnlyRow label="Last failure reason">
              {target.lastRunFailureReason ?? '—'}
            </ReadOnlyRow>
            <ReadOnlyRow label="Created">
              {target.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
            </ReadOnlyRow>
            <ReadOnlyRow label="Updated">
              {target.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
            </ReadOnlyRow>
          </dl>
          <p className="text-xs text-muted-foreground mt-3">
            These fields are written by the cron sidecar (Phase 4) and the agent runtime (Phase 3).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{children}</dd>
    </>
  )
}
